# Detection Pipeline Migration Analysis

## 0. Scope and Evidence Rules

이 문서는 CarrotMangaTranslator의 staged automatic workflow에서 Detection을 source와 read-only local artifact(model 파일, run artifact `hayai-regions.json` 214개, library, 로그)로 추적한 결과다. 구현, benchmark, 설치, 실행은 하지 않았다. 기존 문서, production code, renderer spike도 수정하지 않았다.

- **[FACT]** source 또는 local artifact에서 직접 확인
- **[INFERENCE]** 도출했으나 runtime 검증 없음
- **[UNKNOWN]** 확인 불가
- **[RECOMMENDATION — USER DECISION REQUIRED]** 제안

선행 문서 약어: OCR, TR(translation), INP(inpainting), CORE(core data model), RLC(renderer library census).

### 0.1 선행 문서 정정 (source 재확인 결과)

| 주제 | 기존 기록 | 재확인 [FACT] |
|---|---|---|
| `recognitionBboxes` / `recognitionSegments` | OCR §2.2·§8, INP §4, CORE §4·§7에서 detection → OCR → typography/erase-scale로 흐르는 입력으로 기술 | **현재 production에서 생성되지 않는다.** `recognitionBboxes`는 dialogue fragment rejoin(`TEXT_FRAGMENT_REJOIN_ENABLED = false`, `hayaiRegionGeometry.ts`)과 dialogue 간 merge(`shouldPreserveDistinctDialogueRegions`는 dialogue끼리 항상 true를 반환해 merge하지 않음)에서만 생긴다. Hayai는 `recognitionBboxes`가 2개 이상일 때만 `recognitionSegments`를 만든다. local 확인: 214개 page artifact에서 `dialogueFragmentMerges 0`, `dialogueOverlapMerges 0`, `recognitionBboxes`를 가진 region 0/1,231. library 1,230 block 중 `recognitionBboxes` 0, `recognitionSegments` 0. **코드 경로는 있으나 휴면 상태다** |
| erase prepass의 `bubbleLayout` 영속 | INP §9, CORE §3: "순차 모드에서는 prepass가 채운 `bubbleLayout`이 erase 결과와 함께 저장" | **저장되지 않는다.** `runBubbleLayoutMaskPrepass`(`jobs/bubbleLayoutJob.ts:141`)가 대상 block의 layout 상태를 `restoreLayout`으로 캡처하고, `eraseWorkflowPage`가 `applyInpaintingLayoutStates(result.page, prepass.restoreLayout)`로 복원한다(`pageWorkflowImages.ts`). 영속 `bubbleLayout`은 layout stage만 만든다 |
| `sourceDirection` | OCR/CORE: "detect(기본값)" | detection은 방향을 넘기지 않는다. `overlayItemToBlock`에서 `item.direction`이 없으면 `"horizontal"`이다(`pipeline/overlayItems.ts:67`). 따라서 **모든 detection block의 `sourceDirection`이 `horizontal`**이다(local 1,230/1,230). 세로 원문이 대부분인 일본 만화에서도 그렇다 |

## 1. Production Detection Flow [FACT]

| # | 단계 | 함수/module | input → output | 좌표계 | side effect / 영속 |
|---|---|---|---|---|---|
| 1 | stage 진입 | `executeWorkflowStage` → `executeWorkflowDetection` (`pageWorkflowRuntime.ts`). timing은 **`ocr` bucket**으로 측정 | page, plan | — | — |
| 2 | skip 판정 | `detectWorkflowBlocks` (`pageWorkflowOcr.ts:24`) | block이 있고 overwrite가 아니면 skip. `pageWorkflow.emptyDetectionKey`가 현재 key와 같으면 skip | — | — |
| 3 | prepass 진입 | `prepareHayaiRegions(options)` (`textDetection/hayaiRegionPrepass.ts`) | `options.imagePath = page.imagePath`(**원본**) | — | — |
| 4 | detector 경계 | `detectPageTextRegions` (`textDetection/pageTextRegionDetector.ts`) → `ensureKoharuLayoutAssets` → `detectKoharuPageLayout` | dataRoot, imagePath, DirectML 요청 | — | model 다운로드/검증(최초) |
| 5 | decode | `loadPageImage` (`inpainting/imageIO.ts`): Electron `nativeImage.createFromPath` → `createFromBuffer` → `decodeFallback`(detection 경로에서는 전달하지 않음) | 파일 → NativeImage | 원본 px | — |
| 6 | 전처리 | `prepareComicDetectorImage` (`bubbleLayout/preprocess.ts`): `resize(1152×1152, "best")` → BGRA→RGB → /255 → ImageNet mean/std → CHW float32 | → `[1,3,1152,1152]` | 1152² (종횡비 무시 stretch) | — |
| 7 | 추론 | `runNativeDetector` → `getKoharuLayoutSession` → `session.run({input}, ["dets","labels","masks"])` (`bubbleLayout/detector.ts`). macOS는 `wasm-worker` | tensor → raw outputs | model 정규화 좌표 | session cache |
| 8 | 출력 해석 | `parseKoharuLayoutOutputs` (`bubbleLayout/outputs.ts`) | → `ComicPageDetection[]` {label, box, score, mask logits 288²} | box: 원본 px, mask: 288² grid | 출력 tensor dispose |
| 9 | 후처리 | `buildHayaiRegionManifest` (`textDetection/hayaiRegionGeometry.ts:131`, "sealed v11 geometry policy") | → manifest {dialogueRegions, effectRegions, diagnostics} | 원본 px | — |
| 10 | 기록 | manifest를 `outputDir/hayai-regions.json`에 저장 | | | **run artifact(영속)** |
| 11 | block 생성 | `overlayItemToBlock` + `workflowOrigin` 부착 (`pageWorkflowOcr.ts`) | dialogue region → block. effect region → `soundEffectReview.regions` | bbox: `normalized_1000` | page state |
| 12 | page 저장 | `executeWorkflowPage` → `savePageWorkflowResultUnlocked` | `blocks`, `blockOrder`, `analysisStatus:"idle"`, checkpoint/completion 초기화, `soundEffectReview` | | chapter.json 전체 rewrite(INP §7) |

**기타 경로 [FACT]**
- **non-workflow Hayai 경로**(`translationRuntimePort.collectOcrHints`의 `prepareHayaiRegionStage`): 같은 `prepareHayaiRegions`를 쓴다. staged workflow는 detect stage에서 이미 block을 만든다.
- **anime-text-yolo**(`textDetection/animeText*`): Paddle 경로의 grouping evidence용이다. staged Hayai workflow에서는 해제(`releaseIdleResources`)만 호출된다.
- **legacy RT-DETR**: `constants.ts`의 주석대로 fallback 없이 완전히 대체됐다.
- **수동 region crop, sound-effect translation job**: 별도 기능이다.

## 2. Runtime / Model Inventory

| 항목 | 값 | 근거 |
|---|---|---|
| Model | KoharuLayout RF-DETR segmentation 2XL, HF `ShiniShiho/koharu-layout-rfdetr-seg-2xl-1152-onnx` @ `bfbbd4e5…`, 파일 `rfdetr-seg-2xlarge.onnx` | [FACT] `bubbleLayout/constants.ts` |
| 무결성 | SHA-256 `7cc10d43…d351`, 148,442,003 B. `ensureRemoteFile`로 크기와 hash 검증 | [FACT] `bubbleLayout/assets.ts` |
| 입력 | `input` float32 `[1,3,1152,1152]` | [FACT] |
| 출력 | `dets [1,300,4]`(cx,cy,w,h 정규화), `labels [1,300,5]`(logit. 앞 4개를 sigmoid), `masks [1,300,288,288]`(instance mask logit) | [FACT] `outputs.ts` shape assert |
| label/threshold | text 0.25, onomatopoeia 0.2, bubble 0.5, panel 0.5 | [FACT] |
| Runtime | `onnxruntime-node` 1.27.0(in-process native addon). packaged build는 `resources/o`에서 staged 로드(`runtimeSupport/nativeOnnxRuntime.ts`). macOS는 `onnxruntime-web` 1.27.0 WASM worker | [FACT] |
| Provider 선택 | Windows `["dml","cpu"]`, 그 외 `["cpu"]`(`session.ts` `resolveKoharuProviderPreference`). **CUDA EP 선택지 없음** | [FACT] |
| 설치된 native binary | `onnxruntime-node/bin/napi-v6/win32/x64`: `onnxruntime.dll`, `DirectML.dll`, `dxcompiler.dll`, `dxil.dll`. `linux/x64`: `libonnxruntime.so.1` + binding(CPU) | [FACT] local `node_modules` |
| Session cache | module 수준 `Map<key, Promise<Session>>`. key = model path + provider(+ DML: GPU preference, backend, index) | [FACT] |
| Local 실행 evidence | 로그 `KoharuLayout execution provider ready {provider:"dml", adapter:"NVIDIA GeForce RTX 5070 Ti", dedicatedVideoMemory ≈16GB}` 35건(repo). `execution provider unavailable` 0건 | [FACT] |
| Local model 파일 | 두 data root 모두 `models/bubble-layout/koharu-layout-rfdetr-seg-2xl-1152/rfdetr-seg-2xlarge.onnx`(148,442,003 B) + sha/meta sidecar | [FACT] |

**Linux provider 후보 [INFERENCE/UNKNOWN]**
- CPU는 현재 코드와 설치 binary로 가능해 보인다.
- CUDA EP는 `onnxruntime-node` Linux 패키지에 CUDA provider 라이브러리가 없고 코드도 선택하지 않는다. 사용하려면 별도 설치와 코드 변경이 필요하다. 가능 여부는 **[UNKNOWN]**이다.
- Python `onnxruntime-gpu` 등 다른 경로도 선택지다.

## 3. Image Decode / Preprocessing

- **[FACT]** raster: detect stage는 `page.imagePath`(원본)를 쓴다. `detectKoharuPageLayout`의 주석은 "Callers must pass the original page image, not an inpainted derivative"다. 후속 prepass와 layout도 `request.page.imagePath`(원본)로 검출한다(§8).
- **[FACT]** Electron 사용: decode(`nativeImage.createFromPath/Buffer`), resize(`image.resize`), bitmap 추출(`toBitmap`, BGRA)
- **[FACT]** 크기는 `getSize()`의 원본 크기다. 0이면 예외를 던진다. 출력 box는 원본 크기로 역변환한다.
- **[FACT]** resize는 1152×1152 고정 **stretch**다. padding(letterbox)이 없다. 종횡비는 model이 정규화 좌표로 처리한다.
- **[FACT]** normalization: /255 후 ImageNet mean/std. channel은 RGB이고 CHW planar다.
- **[UNKNOWN]** EXIF orientation: HayaiOCR는 PIL `exif_transpose`를 적용한다(OCR §8.1). `nativeImage`의 EXIF 처리 여부는 source로 확인되지 않았다. 회전 EXIF가 있는 JPEG에서 detector 좌표와 OCR crop이 어긋날 가능성은 검증되지 않았다.
- **[FACT]** 큰 이미지: 입력 tensor가 고정 크기라 추론 비용은 page 크기와 무관하다. decode/resize 비용과 buffer 크기는 원본 크기에 비례한다. local page는 최대 2082×2880이다.
- **[INFERENCE] Linux 대체 경계**
  - `nativeImage` 의존은 "decode + bilinear 계열 resize + BGRA bitmap" adapter뿐이다.
  - 알고리즘(`convertBgraBitmapToRgbChw` 이후)은 순수 TS다.
  - 대체 decoder/resizer(예: sharp, image-rs, PIL)로 바꾸면 resize 보간 차이 때문에 결과가 미세하게 달라질 수 있다. 영향은 **[UNKNOWN]**이다.

## 4. Raw Model Output

| 출력 | 내용 | production 해석 | 운명 |
|---|---|---|---|
| `dets` | 300 query × 정규화 cx,cy,w,h | 원본 px `[x1,y1,x2,y2]`로 변환하고 clamp. 폭/높이 ≤ 0이면 제거 | box는 후처리 입력. 원시값은 버림 |
| `labels` | 300 × 5 logit | 앞 4 class에 sigmoid를 적용하고 최대값의 class를 고른다. class별 threshold 미만은 제거. 5번째 logit은 사용하지 않는다 | score는 `detectorConfidence`(region별 member 최대값)로 영속 |
| `masks` | 300 × 288×288 logit | 통과한 detection만 복사(detection당 약 331KB float32). `logit ≥ 0`으로 이진화 | **영속하지 않음.** 후처리와 subdivision에만 쓰고 버린다 |

- **[FACT]** 정렬: score 내림차순, 같으면 labelId 오름차순. 이후 prefix id(`T001`, `F…`, `B…`, `P…`)를 부여한다.
- **[FACT]** 영속되는 것:
  - region bbox(padding·cut 반영, 소수 3자리 반올림)
  - `detectorConfidence`
  - subdivision box
  - `sourceDetectionIds`(manifest와 run artifact에만. block의 `workflowOrigin`에는 없음)

## 5. Detection Postprocessing (`buildHayaiRegionManifest`)

**[FACT] 단계** (`hayaiRegionGeometry.ts`, 2,063줄, threshold 상수 약 60개):

1. `prepareDetections`
   - mask를 이진화한다.
   - text는 `trimTextMaskOutliers`(quantile), `trimDetectorUnsupportedTextMaskTail`, `trimPageSpanningVerticalTextTail`로 정리한다.
   - mask box를 page 좌표로 바꾸고 centroid를 구한다.
2. `trimBorrowedTextMaskTails`: 이웃 text mask에서 빌려온 꼬리를 제거한다.
3. label별로 분리한다: text / bubble / panel / onomatopoeia
4. `rejectBroadSparseText`: 넓고 희박한 text proposal을 제거한다(`rejectedDialogueCount`).
5. `assignTextToBubbles`: mask containment 기반으로 text를 bubble에 연결한다(≥0.55).
6. `isolateDisjointChildCompositeMasks`: 합성 proposal을 child mask 기준으로 분리한다.
7. `buildDialogueRegions`
   - 같은 bubble(또는 둘 다 bubble 밖)이면서 **중복** text끼리만 DisjointSet으로 묶는다.
   - fragment pair는 기록하지만 rejoin은 **비활성**이다.
   - region = member mask box의 union + padding 5px
8. `buildEffectRegions`: onomatopoeia를 grouping한다. text와 중복되면 제외하고, panel 관계를 본다.
9. `rectifyOverlaps`
   - 겹치는 region 사이에서 lossless cut을 찾는다.
   - dialogue는 cut이 없으면 **병합하지 않고 보존**한다(`ownershipSkips`).
   - effect는 병합한다.
10. `mergeDialogueFragments`: rejoin 비활성이므로 no-op
11. dialogue마다 `planHayaiOcrSubdivision`(§7)
12. `finalizeRegions`
    - bbox 상단 y 오름차순, 같으면 **오른쪽 끝 x 내림차순**으로 정렬한다(= 읽기 순서 근사).
    - `id = index+1`, `regionId = D001…/FX001…`

**[FACT/local] diagnostics 합계** (run artifact 214 page):
- dialogue region 1,231개(page당 median 6, 최대 20)
- effect region 1,136개(median 4, 최대 26)
- `dialogueOverlapCuts 7`, `dialogueOwnershipSkips 24`, `rejectedDialogueCount 1`
- `effectOverlapMerges 35`, `effectOverlapCuts 51`, `rejectedEffectCount 1,181`

**[FACT] 기록되지 않는 것**
- 읽기 방향 인식(세로/가로)
- 회전
- 글자 방향

## 6. Block Creation and Defaults

**[FACT]** `detectWorkflowBlocks`는 dialogue region마다 다음 입력으로 `overlayItemToBlock`을 호출한다.
- 입력: `{id: region.id, type:"nonsolid", textRole:"ordinary", jp:"", ko:"", bbox: normalized_1000, confidence}`
- 결과를 `textDisplayMode:"translation-only"`와 `workflowOrigin`으로 덮는다.

| 필드 | 값 | 출처 |
|---|---|---|
| `id` | `${pageId}-${detectionId}-block-${n}`. `detectionId = randomUUID()` per detect 실행 | `buildOverlayBlockId` |
| `sourceText` / `translatedText` | `""` | |
| `textRole` | `ordinary` | |
| `sourceDirection` | `horizontal`(direction 미제공) | §0.1 |
| `renderDirection` | ordinary면 `horizontal` 강제 | `resolveInitialRenderDirection` |
| `rotationDeg` | `0`(angle 없음) | |
| `fontSizePx` | `estimateBlockFontSizePx("...", bbox)` → `applySizeOptions`(format defaults) | `resolveOverlayFontSizePx` |
| `lineHeight 1.18`, `textAlign center`, `textColor #111111`, `outlineColor #ffffff`, `autoFitText true`, `backgroundColor`/`opacity`(editor chrome) | 상수 → `blockFormatDefaults`로 덮어씀(`wordBreak` 등) | |
| perspective/curve/warp/effect | 설정하지 않음 | |
| `workflowOrigin` | `geometryKey`, `recognitionBboxes`, `ocrSubdivision`, `initialFontSize/Family/Style` | `pageWorkflowOcr.ts` |

**[INFERENCE] 왜 detection이 presentation 기본값을 만드는가**
- Carrot의 `overlayItemToBlock`은 원래 번역 모델 출력(overlay item: bbox + jp/ko + direction + fontSize)을 block으로 바꾸는 공용 함수다. detection도 이 함수를 재사용한다.
- 따라서 이는 detection algorithm의 책임이 아니라 **공용 block 생성 경로를 재사용한 결과**다.
- detection 고유 산출물은 bbox, score, subdivision뿐이다.
- Rover에서는 DetectionResult와 presentation 기본값을 분리할 수 있어 보인다.

## 7. Recognition Geometry

| 필드 | 생성 | 좌표계 | 개수 | 생성 안 되는 조건 | 소비 |
|---|---|---|---|---|---|
| `recognitionBboxes` | dialogue fragment rejoin과 region merge에서만 | 원본 px | 2–8(Hayai 검증) | **현재 항상**(rejoin off, dialogue merge 없음) | OCR 첫 판독 crop, Hayai `recognitionSegments`, typography, erase-scale |
| `ocrSubdivision` | `planHayaiOcrSubdivision` (`hayaiOcrSubdivision.ts`) | 원본 px(manifest 단계에서 bbox로 clip) | 2–8 | bbox가 가로로 넓음(h < w), mask column band 2개 미만, `recognitionBboxes` 있음 | OCR crop 계획만 |
| `geometryKey` | `workflowRegionKey(page, block)` | hash | 1 | — | subdivision 재사용 판정, erase region key, stage key |
| `sourceDetectionIds` | manifest | id 문자열 | 1+ | — | manifest와 effect review. block에는 없음 |
| `detectorConfidence` | member 최대 score | 0–1 | 1 | — | `block.confidence` → translation previous pass(TR §3.3) |

**[FACT] subdivision 알고리즘 (세로 다열, 오른쪽→왼쪽)**
1. region bbox 안의 288² mask cell을 column profile로 만든다.
2. 상위 90% peak의 30%를 넘는 column band를 찾는다(최소 3 cell).
3. band를 최대 8개 group으로 묶고, 각 group의 세로 범위를 box로 만든다(3px padding, bbox로 clip).
4. `segments.reverse()`로 **오른쪽→왼쪽** 순서로 만든다.
5. mode 판정: median column 폭 × `hayaiResizeScale(bbox)`(SigLIP2 naflex 256 patch budget)이 patch 16px보다 작으면 `preemptive`(처음부터 분할 판독), 아니면 `retry`(whole read 실패 시 1회 분할 재판독).

**[FACT/local]** library 1,230 block 중 `ocrSubdivision` retry 556, preemptive 3. chapter 46e79bc1은 subdivision이 하나도 없다. 검출 당시 코드 버전 차이로 추정한다 [INFERENCE]. 개수 분포는 2–8개다.

**[FACT] stale 규칙**
- geometry(bbox)가 바뀌면 `geometryKey`가 달라져 저장된 subdivision을 OCR manifest에서 쓰지 않는다(`manifestForBlocks`).
- erase region key도 바뀌어 erase 대상이 된다.
- 번역 stage key도 geometry를 포함한다.

## 8. Detector Mask Lifecycle — 3회 호출 검증

| | A. Detection stage | B. Erase prepass | C. Layout stage |
|---|---|---|---|
| 호출 경로 | `prepareHayaiRegions` → `detectPageTextRegions` → `detectKoharuPageLayout` | `runBubbleLayoutMaskPrepass` → `runBubbleLayoutPostprocess` → runner `runPage` → `detectOriginalPageLayoutUncached` | `layoutWorkflowPage` → `runBubbleLayoutPostprocess` → 동일 |
| 조건 | detect stage 실행 | `model==="flux-klein" && plan.bubbleLayout && stages.includes("layout")` | `plan.bubbleLayout` |
| model | 동일 KoharuLayout ONNX | 동일 | 동일 |
| 입력 raster | `page.imagePath` | `request.page.imagePath`(원본) | `request.page.imagePath`(원본) |
| decodeFallback | 없음 | `context.decodeImage` | `context.decodeImage` |
| 전처리/raw output | 동일 함수 | 동일 | 동일 |
| provider | session cache에 따름 | 동일(단 translation이 dispose하면 재생성) | 동일 |
| 후처리 | `buildHayaiRegionManifest` | `processDetectedBubbleLayouts`(paddingRatio 0, `sharedOwnershipGapPx 0`, best-effort) + **typography segmentation(raw detections 전달)** | `processDetectedBubbleLayouts`(사용자 paddingRatio, required) |
| 필요한 output subset | text/bubble/panel/onomatopoeia box + mask | bubble + text mask, text/onomatopoeia instance mask(erase mask) | bubble + text mask |
| cache | 없음 | runner-local `detectionsByOriginalPath` | 새 runner(`workflowBubbleRunner(context)`를 호출마다 생성) |
| 결과 영속 | manifest(run artifact), block geometry | 없음(`restoreLayout`) | `bubbleLayout`, `renderBbox` |

- **[FACT]** 세 호출의 model, 입력 raster, 전처리가 같다. 같은 provider라면 raw output은 동일할 것으로 기대된다 **[INFERENCE: 결정적 추론 가정. DML과 CPU 사이 수치 차이 가능]**.
- **[FACT]** layout의 `pageRevision`은 원본과 inpainted 파일의 stat hash다(`resolvePageRevision`). 이는 결과 staleness 판정용이고 detector 입력과는 무관하다.
- **[FACT]** 같은 page에서 A, B, C가 모두 실행되면 Koharu 추론은 3회다. B/C 사이의 runner cache는 공유되지 않는다.
- **[FACT/local]** repo 로그에 page별 Koharu 추론 횟수는 기록되지 않는다. session 생성 로그만 있다(INP §6.3).

## 9. Bubble / Layout Detection Relationship

| 개념 | 성격 | 생성 |
|---|---|---|
| text detection, bubble detection, panel, onomatopoeia | **neural** 출력(box + instance mask) | KoharuLayout |
| dialogue region, effect region | deterministic 후처리 | `buildHayaiRegionManifest` |
| recognition region / subdivision | deterministic(mask column profile) | §7 |
| bubble ↔ block 연관, ownership partition | deterministic | `associateComicDetections`, `partitionSharedBubbleOwnership` |
| layout region, bubble slot, `bubbleLayout.regions[].spans` | deterministic(bubble mask 형상 profile) | `bubbleShapeProfileBuilder.buildRegionProfile` |
| `renderBbox` | deterministic(bubble 기반 render 영역 + paddingRatio) | layout runner patch |

- **[FACT]** `bubbleLayout`의 크기
  - region마다 `blockLength / ceil(blockLength/96)` 개, 곧 **최대 약 96개 band**의 span `{blockStart, blockEnd, inlineStart, inlineEnd}`를 저장한다.
  - 값은 반올림하지 않은 비율(JSON에서 15–17자리)이다.
  - 예: `_0411` block 1개에 span 약 76개.
- **[FACT]** CORE §9 수치의 기준은 chapter 592a103c 하나다. `bubbleLayout`이 block 데이터의 약 86%, 파일 전체의 약 44%였다. 다른 chapter나 설정에서 같은 비율이라는 근거는 없다.
- **[FACT]** layout 대상은 `translatedText`가 있는 block뿐이다(`isBubbleLayoutBlockEligible`). **detection 시점에는 계산할 수 없는 조건**이다.

## 10. Sound Effect Detection

| 항목 | [FACT] |
|---|---|
| 검출 | onomatopoeia label → `buildEffectRegions` → manifest `effectRegions` |
| 저장 | detect stage가 `soundEffectReview.regions`(bbox normalized, confidence, sourceDetectionIds)로 page에 저장한다. contract `hayai-regions-v1` |
| staged OCR | `manifestForBlocks`가 `effectRegions: []`로 보낸다. **staged workflow는 effect를 OCR하지 않는다** |
| translation | 대상 아님. prompt의 Hayai 고정 영역 section도 "Standalone sound effects are deliberately excluded… handled by a separate user review layer"라고 밝힌다(TR §3.3) |
| erase | effect region 자체는 대상이 아니다. 단 dialogue block 근처의 onomatopoeia instance mask는 typography segmentation으로 erase mask에 합류할 수 있다(`koharuTypographyMask.ts:52`) |
| renderer | effect review 결과를 번역하거나 적용하면 별도 block/lettering이 된다(수동/별도 job: `jobs/soundEffectTranslation*`) |
| local | effect region: chapter별 173, 3, 156, 648, 156. 모두 review 대기 데이터로 남아 있다 |

[RECOMMENDATION — USER DECISION REQUIRED] 초기 Rover Core에서 effect region은 "검출 결과 보존만 하고 처리하지 않음" 또는 "완전 제외" 중에서 선택할 수 있다. 현재 자동 pipeline 결과물에는 effect 번역이 없다.

## 11. Detection Overwrite / Rerun Semantics

**[FACT]**
- detect는 block이 있으면 skip한다. `overwrite`에 `detect`가 있으면 `blocks`를 **통째로 새 배열로 교체**한다.
  - 새 id에는 새 `randomUUID`가 들어간다. **기존 block id는 유지되지 않는다.** bbox가 같아도 새 block이 된다.
- 교체로 사라지는 것:
  - `sourceText`, `translatedText`
  - 서식(typography)
  - `bubbleLayout`/`renderBbox`
  - `workflowOrigin`
  - 수동 편집 전부
  - `translationCheckpoint`, `translationCompletion`
- 유지되는 page 필드: `inpaintedImagePath`, `inpaintMaskPath`, `erasedWorkflowRegions`
  - `erasedWorkflowRegions`는 옛 block id를 key로 쓰므로 새 block은 전부 erase 대상이 된다.
  - erase는 `preserveExistingInpainting:true`라서 **기존 inpainted image 위에 다시 지운다.**
- receipt: 각 stage key가 geometry hash를 포함하므로 이후 stage가 모두 재실행 대상이 된다.
- stale save guard(`savePageWorkflowResultUnlocked`의 revision/updatedAt 비교)는 동시 편집을 막는다. overwrite 자체를 막지는 않는다.

[RECOMMENDATION — USER DECISION REQUIRED] 대안 후보:
- (a) DetectionResult를 versioned artifact로 저장하고, block은 detection id와 매칭해 downstream 결과를 carry-over한다(IoU 기반).
- (b) 재검출은 새 detection version을 만들고 사용자가 채택한다.
- (c) 현행처럼 destructive replace를 유지한다.

## 12. Detection Input Contract

- **[FACT] 알고리즘 입력**
  - 원본 raster(decode 가능 형식)
  - model 경로(검증된 ONNX)
  - provider 선호
  - 원본 width/height(decode 결과)
- **[FACT] Carrot 추가 입력**
  - `dataRoot`(asset 경로)
  - DirectML adapter 선택(`graphicsGpuPreference`, `computeGpuIndex`, backend)
  - `signal`, progress callback
  - `plan.overwrite`, `emptyDetectionKey`, `blockFormatDefaults`(block 생성용)
- **[INFERENCE]** `{imagePath, width?, height?, modelRef, provider}` 정도로 충분해 보인다. 후처리 파라미터는 코드 상수다(v11 sealed policy).

## 13. Detection Output Contract

| 구분 | 필드 | 근거 consumer |
|---|---|---|
| **MINIMUM REQUIRED** | image size, dialogue regions[{order, bbox(px), score}] | OCR manifest, translation candidate, erase mask, renderer rect(TR, INP, RLC) |
| **QUALITY SUPPORT** | `ocrSubdivision`(retry/preemptive), region 순서 규칙, (휴면) `recognitionBboxes` | OCR crop(OCR §2) |
| QUALITY SUPPORT(후속 재사용 시) | raw detections: label, box, score, 288² mask logit 또는 이진 mask | erase typography segmentation, bubble layout(§14) |
| **DEBUG / REPRODUCIBILITY** | model id/revision/hash, provider, `diagnostics`, `sourceDetectionIds`, effect regions | 현재 run artifact와 로그 |
| **CARROT-SPECIFIC** | block 기본 서식, `workflowOrigin.initialFont*`, `textDisplayMode`, `soundEffectReview` contract, editor chrome | block 생성 경로 |

## 14. Downstream Dependency Matrix [FACT]

| Detection output | OCR | Translation | Typography | Erase | Layout | Renderer |
|---|---|---|---|---|---|---|
| bbox | crop/manifest | candidate rect, overlap 매핑 | 추정 입력 | sourceRect, padding, window | bubble 연관 | `renderBbox ?? bbox` |
| confidence | — | previous pass 문구 | — | — | — | — |
| recognitionBboxes(휴면) | 첫 판독 crop | — | typography hints | erase-scale(병렬) | — | — |
| ocrSubdivision | crop 계획 | — | — | — | — | — |
| geometryKey / region key | subdivision 재사용 | stage key | — | erase 대상, stage key | — | — |
| detector mask(비영속) | subdivision 계획 시점에만 | — | — | **재검출**로 대체 | **재검출**로 대체 | — |
| bubble regions(비영속) | — | — | — | 재검출 | 재검출 → `bubbleLayout` | `bubbleLayout` 경유 |
| effect regions | (workflow에서는 없음) | — | — | 재검출 mask 일부 | — | 별도 job |
| blockOrder / region 순서 | manifest id=index+1 | candidate id=index+1 | — | — | — | 그리는 순서 |
| sourceDirection(항상 horizontal) | — | prompt profile 없음 | 추정 방향 | erase-scale 축 | — | source-size probe 방향 |

## 15. Runtime Lifecycle / Resource Ownership

[FACT] timeline(순차 모드):

```
detect stage (page 순차): Koharu session 생성(1회, DML) → page마다 decode·추론·후처리
ocr prepare:              releaseDetectorResources → Koharu session dispose → HayaiOCR(CUDA child)
translate (page마다):     releaseDetectorResources(no-op 또는 dispose) → 원격 endpoint
erase (page마다):         Flux acquire(CUDA) + prepass에서 Koharu session 재생성(DML) → 추론
layout (page마다):        Koharu(새 runner, session은 cache 재사용)
```

- **[FACT] 병렬 모드**(openai-api 전용)
  - translation lane이 page마다 Koharu session을 dispose한다.
  - erase lane의 prepass가 다시 만든다.
  - repo 로그에서 run 1336145f는 session 생성 27회/erase 44 page, run 10409ed7은 8회/34 page였다(INP §6.3).
  - Flux(CUDA)와 Koharu(DML)는 erase lane 안에서 교대로 같은 GPU를 쓴다.
- **[FACT]** DML device lost 시 같은 입력을 CPU session으로 재실행한다. 해당 DML key를 `unavailableProviderKeys`로 표시해 이후 page는 CPU를 쓴다. 다음 dispose 때 표시가 초기화된다.
- **[FACT]** `disposeCachedKoharuLayoutSessions`는 disposal barrier로, 진행 중인 run이 끝난 뒤 release한다.

## 16. Performance / Page-count Scaling

| 항목 | 분류 | 근거 |
|---|---|---|
| model/session reload | BOUNDED(stage 안) / 병렬 모드에서는 page 간 반복 재생성 | [FACT] |
| session cache | BOUNDED(key당 1개) | [FACT] |
| decoded image / resized bitmap / CHW tensor(1152²×3×4B ≈ 15.9MB) | PER-PAGE TEMPORARY | [FACT] 함수 지역 |
| raw output tensor(masks 300×288²×4B ≈ 99.5MB) | PER-PAGE TEMPORARY | [FACT] parse 후 dispose |
| detection masks(통과분 × 331KB) | PER-PAGE TEMPORARY. runner cache에서는 prepass/layout runner 수명 동안 유지 | [FACT] runner는 page마다 생성 |
| `hayai-regions.json` run artifact | GROWS(page당 1개) | [FACT] |
| chapter.json(blocks, soundEffectReview) | GROWS | [FACT] CORE §9 |
| detector input 크기 | BOUNDED(1152² 고정). decode 비용은 원본 크기에 비례 | [FACT] |
| queue/promise | BOUNDED(session run tail 직렬화) | [FACT] `withKoharuSessionLease` |
| 누적 저하 | UNKNOWN | 측정 없음 |

## 17. Existing Logs / Runtime Evidence

- **[FACT]** detection 전용 시간은 기록되지 않는다.
  - detect stage 시간은 `page-timing.ocrMs` bucket에 OCR batch 분배 시간과 합산된다(`executeWorkflowStage`의 `measureWorkflowStage(…, "ocr")`).
  - run 1336145f(49 page, 1280×1791, RTX 5070 Ti DML, 병렬 모드): `ocrMs` median 1,475ms(290–1,850), page index와의 Spearman −0.08(`page-timing` 로그 재분석)
  - detection과 OCR을 분리할 수 없다.
- **[FACT]** region 수와 크기는 run artifact로 확인된다(§5). page 크기 분포: 1280×1791(126), 2082×2880(74) 등
- **[FACT]** 실패 기록: `execution provider unavailable` 0건, bubble layout `skipped/failed` 로그 0건(repo와 설치 앱 로그)
- `page-timing.totalMs`는 run 경과 시간에 가까운 값이라 detection 분석에 쓰지 않았다(INP §14).

## 18. Failure / Recovery

| 사건 | 처리 [FACT] |
|---|---|
| model 다운로드/검증 실패 | `ensureRemoteFile` 예외 → detect stage 실패 |
| session 생성 실패(provider) | 다음 provider로 이동(Windows DML → CPU), `logWarn`. **CPU fallback은 warning만 남는다**. 전부 실패하면 AggregateError |
| DML device lost | 같은 입력을 CPU로 재실행. CPU도 실패하면 AggregateError |
| decode 실패, 크기 0 | 예외 |
| 출력 shape/유한성 위반 | 예외 |
| empty detection | dialogue 0개 → blocks `[]`. receipt status `empty` + `emptyDetectionKey` 기록. 이후 stage는 대상 없음 |
| region 과다 | 상한 없음(query 300 한계). OCR 정규화 80개 상한(OCR §8.2) |
| 취소 | `runOptions.terminate`, 출력 dispose, AbortError |
| prepass 실패(B) | best-effort: 경고 후 stale layout만 정리하고 erase는 bubble constraint 없이 계속한다(**silent 품질 저하**) |
| layout 실패(C) | required: 예외 → layout step 실패 |

- **[FACT]** empty detection(`empty`)과 실제 실패(`failed`)는 receipt에서 구분된다.
- **[INFERENCE]** 단, 검출이 약해 일부 대사를 놓친 경우는 구분할 수 없다.

## 19. Platform Coupling

| Coupling | 위치 | 분류 |
|---|---|---|
| KoharuLayout ONNX model | HF pin + sha | **PORTABLE** |
| 후처리(v11 geometry, subdivision, bubble association/profile) | `hayaiRegionGeometry.ts`, `hayaiOcrSubdivision.ts`, `bubbleLayout/*` | **PORTABLE**(순수 TS) |
| 출력 parse, 전처리 수식 | `outputs.ts`, `convertBgraBitmapToRgbChw` | **PORTABLE** |
| Electron `nativeImage` decode/resize | `imageIO.ts`, `preprocess.ts` | **REPLACE**(image library) |
| DirectML adapter 조회, DML EP | `windowsDirectMlAdapter.ts`, `session.ts` | **REPLACE**(Linux: CPU/CUDA EP) |
| `onnxruntime-node` native addon | `nativeOnnxRuntime.ts` | **ADAPTABLE**(Linux CPU binary 존재) |
| ORT-web WASM worker(macOS) | `wasmWorker*` | DROP(Linux) |
| appPaths/dataRoot asset 경로 | `assets.ts` | **ADAPTABLE** |
| Python / Rust / PowerShell / managed installer | detection 경로에 없음 | — |

## 20. Linux RoverCMT Boundary

[RECOMMENDATION — USER DECISION REQUIRED] 후보 구조(확정 아님):

```
Page raster ─→ Image decode/resize adapter (1152² RGB) ─→ Koharu ONNX adapter (ORT, CPU|CUDA)
          ─→ RawDetections {label, box, score, mask(288²)}  ──┬─→ Dialogue/Effect postprocessor (v11) ─→ DetectionResult
                                                             ├─→ (optional) Bubble layout builder (after translation)
                                                             └─→ (optional) Erase typography segmentation
```

| 질문 | 근거 |
|---|---|
| ONNX model을 그대로 쓸 수 있는가 | 가능성이 높다 [INFERENCE]. 표준 ONNX이고 입출력 계약이 명시적이다 |
| `onnxruntime-node`를 계속 쓸 이유 | 후처리가 TS라서 in-process가 가장 적은 변경이다. Linux CPU binary도 이미 있다. CUDA가 필요하면 추가 검증이 필요하다 |
| Python ORT | 전처리/후처리를 옮기거나 IPC가 필요하다. HayaiOCR가 Python이라 한 worker에 합칠 수는 있다 [INFERENCE] |
| Rust/C++ adapter | 필요성의 근거는 없다 |
| image decode 교체 | 경계가 명확하다(§3). resize 보간 차이의 영향은 검증이 필요하다 |
| mask artifact 저장 가치 | 3회 추론(§8)과 subdivision 재계산을 피할 수 있다. 대신 page당 detection 수 × 331KB(float) 또는 1/4(이진, 1B/cell) 저장 비용이 든다 |
| erase/layout에서 재사용 | §23 참조 |

## 21. Existing Tests

| 파일 | 범위 | 종류 |
|---|---|---|
| `bubbleDetectorCore.test.ts` | model pin, BGRA→CHW, abort, sigmoid/threshold/box/mask parse, shape 거부, 연관 | UNIT |
| `bubbleOnnxRuntime.test.ts`(20) | DML device-lost CPU 재실행, lease/cancel, pinned download, provider 선호, 재시도 | MOCK(ORT mock) |
| `bubbleDetectorBackend.test.ts`, `bubbleWasmRuntime.test.ts` | backend 선택, WASM | MOCK |
| `bubbleFitGateOnnxWasmBenchmark.test.ts` | 실제 artifact가 있을 때 Python ORT CPU와 비교(`skipIf`) | REAL MODEL(조건부, fit gate model) |
| `hayaiOcrSubdivision.test.ts` | subdivision | UNIT |
| `soundEffectReview.test.ts`(약 10건) | `buildHayaiRegionManifest`를 합성 detection으로 검증(effect 32개 이상, 세로 column 분리 등) | UNIT |
| `bubbleLayoutFacade/PageProcessor/Region*/Mask*` | bubble layout 후처리 | UNIT/MOCK |
| `pageWorkflowAdapters.test.ts`, `translationRuntimePort.test.ts` | detection → OCR 연결, detector release 순서 | MOCK |
| `windowsDirectMlAdapter.test.ts`, `directMlAdapterPolicy.test.ts` | DML adapter | UNIT |

- **[FACT]** `hayaiRegionGeometry.ts` 전용 테스트 파일은 없다. 약 60개 threshold의 v11 policy는 `soundEffectReview.test.ts`의 일부 case와 `scripts/font-size-ai-lab/replay-koharu-geometry.cjs`(Electron 필요, 수동 replay)로만 확인된다.
- **[FACT]** 실제 Koharu layout ONNX 추론 테스트는 vitest에 없다.
- **[INFERENCE] Rover 재사용 가능**: bubbleDetectorCore(parse/전처리), subdivision, soundEffectReview의 manifest case
- **[INFERENCE] 새로 필요**: 실제 model 추론 smoke, Windows run artifact 대비 manifest 동등성 비교

## 22. Linux Runtime Smoke Test Plan (미실행)

| 단계 | INPUT | MEASUREMENT | SUCCESS | ARTIFACT |
|---|---|---|---|---|
| S0 environment | Linux host | OS/glibc/Node/ORT/CPU/GPU | 기록 완료 | env.json |
| S1 model/hash | ONNX 파일 | sha256, bytes | `7cc10d43…`, 148,442,003 B 일치 | hash log |
| S2 single image CPU | 기존 page 원본 1개(chapter 592a103c) | session 생성/추론 시간, 출력 shape | `dets/labels/masks` shape 일치, 예외 없음 | raw output 요약(json) |
| S3 Windows artifact 비교 | 같은 page의 기존 `hayai-regions.json` | region 수, bbox IoU, 순서, score 차이 | dialogue 수 동일, bbox IoU ≥ 기준(사용자 결정), 순서 동일 | diff report |
| S4 recognition geometry | 같은 입력 | `ocrSubdivision` mode/개수/box | Windows와 동일하거나 차이 목록화 | diff report |
| S5 multi-page | 10–20 page | page별 시간, region 수 | 전부 성공 | jsonl |
| S6 memory/session reuse | S5 | RSS 추이, session 1회 생성 | 누적 증가 없음(관찰) | rss log |
| S7 CUDA 후보(선택) | CUDA EP 가능 환경 | CPU 대비 시간, 결과 차이 | 결과 동등성 | report |

decode는 Electron 없이 portable library로 한다. resize 차이가 S3/S4 차이의 원인인지 분리하려면 Windows 쪽 CHW 입력을 dump해 비교하는 선택 단계를 두는 것이 좋다 [INFERENCE].

## 23. Repeated Koharu Inference — Reuse Feasibility

| 재사용 대상 | 판정 | 근거 |
|---|---|---|
| A의 raw detections(label, box, score, mask) → B/C의 detector 호출 대체 | **POSSIBLY REUSABLE** | [FACT] 같은 model, 원본 raster, 전처리. [UNKNOWN] provider가 다를 때(DML↔CPU 전환 후) 수치 차이. model/원본 hash/provider를 key로 두면 의미 변화는 없어 보인다 [INFERENCE] |
| A의 dialogue/effect regions → B/C 입력 | **MUST RECOMPUTE**(파생) | B/C는 region이 아니라 raw bubble/text mask와 현재 block(번역 여부, 수동 bbox)을 쓴다 |
| B의 bubble 결과 → C | **MUST RECOMPUTE**(파생) | paddingRatio(0 vs 사용자 값), sharedOwnershipGap, failureMode, 대상 block이 다르다 |
| B의 raw detections → C | **POSSIBLY REUSABLE** | 같은 원본 raster이고 runner만 다르다. 현재 runner cache가 stage 사이에 공유되지 않는 것은 구조적 이유다 |
| layout 결과 전체를 detection 시점에 계산 | **MUST RECOMPUTE** | eligibility가 `translatedText` 존재를 요구한다(§9). render direction과 padding은 이후에 정해진다 |
| subdivision 재계산 | SAFE TO REUSE(현재도 geometryKey가 같으면 재사용) | [FACT] |
| 원본이 아닌 inpainted image 기반 재검출 필요 여부 | 해당 없음 | [FACT] 세 호출 모두 원본을 쓴다 |

후보 구조(개념): `DetectionArtifact { sourceImageSha256, modelSha256, provider, preprocessVersion, detections[{label, box, score, maskRef(288² binary or logits)}] }`. 저장 형식과 크기(이진 mask 83KB/detection, logits 331KB/detection)는 결정 사항이다.

## 24. Recommended Migration Boundary

[RECOMMENDATION — USER DECISION REQUIRED]

| 대상 | 분류 |
|---|---|
| Koharu ONNX model(pin, hash) | KEEP |
| ONNX Runtime | ADAPT(Linux CPU 우선, CUDA는 검증 후) |
| image decode/resize | ADAPT(portable library로 교체, 동등성 검증) |
| 출력 parse, v11 후처리, subdivision | KEEP(테스트 보강 필요) |
| recognition geometry(`recognitionBboxes`) | UNDECIDED(현재 휴면. 유지 또는 제거) |
| detector raw mask | UNDECIDED(artifact 보존 여부) |
| effect region | UNDECIDED(보존만 / 제외) |
| Carrot block defaults(`overlayItemToBlock`) | ADAPT(Detection output과 presentation defaults 분리 후보) |
| runtime manager/asset downloader | ADAPT(검증된 파일 경로 입력으로 단순화) |
| DirectML-specific code, WASM worker | DROP INITIALLY(Linux) |
| anime-text-yolo, legacy RT-DETR | DROP INITIALLY |

## 25. Open Decisions for User

1. **detector raw mask 보존**
   - FACTS: 3회 추론, mask 비영속, 크기(§23).
   - TRADE-OFF: 저장량 vs 추론 시간/일관성.
   - OPTIONS: 보존(logit/이진) / 비보존.
2. **Koharu 결과 cache 범위**
   - FACTS: B/C runner cache가 분리되어 있다.
   - OPTIONS: page 단위 artifact / run 단위 메모리 / 없음.
3. **sound effect 초기 범위**
   - FACTS: staged workflow는 effect를 처리하지 않지만 검출은 한다.
   - OPTIONS: 보존만 / 제외 / 번역 포함.
4. **detection 재실행 semantics**
   - FACTS: 새 uuid, 전 필드 소실, erase는 inpainted 위에 재수행.
   - OPTIONS: §11 (a)(b)(c).
5. **ONNX runtime 구현 언어**
   - FACTS: 현재 in-process Node. Linux CPU binary 있음. Hayai는 Python.
   - OPTIONS: Node ORT / Python ORT / 기타.
6. **block/presentation 기본값 분리**
   - FACTS: detection이 공용 overlay→block 경로를 재사용한다.
   - OPTIONS: 분리 / 유지.
7. **source direction 기록**
   - FACTS: 모든 block이 `horizontal`. 검출은 방향을 추정하지 않는다(subdivision만 세로 column을 가정).
   - OPTIONS: 현행 / mask 기반 방향 추정 추가 / vision 모델 추정.

## 26. Exact Next Step

우선순위는 다음과 같다(모두 미실행).

1. **Renderer contract-aligned re-comparison**(CORE §18)
   - renderer 결정이 가장 큰 미결정이고, 현재 비교에는 harness 결함이 섞여 있다.
   - detection 결과와는 독립적이다.
2. **Detection Linux smoke S0–S3**
   - 이번 분석에서 새로 제안하는 가장 작은 작업이다.
   - 기존 page 1개를 portable decoder + `onnxruntime-node` CPU로 추론하고, 기존 `hayai-regions.json`과 region 수, bbox, 순서를 비교한다.
   - Windows/Electron 없이 detection core를 재현할 수 있는지 확인하고, resize 보간 차이의 영향을 처음으로 측정한다.
   - OCR Linux smoke(OCR §12)의 입력인 manifest를 Linux에서 만들 수 있는지도 함께 확인한다.
3. OCR Linux smoke: detection smoke 결과 manifest를 입력으로 쓰면 Linux 단독 detect→OCR 연결까지 확인할 수 있다.
4. 20/100 benchmark: detection 시간이 `ocr` bucket에 합산되는 등 계측이 부족하다. 먼저 stage 계측을 추가한 뒤 실행하는 것이 맞다(INP §15).
