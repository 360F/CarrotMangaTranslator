# Core Data Model & Pipeline Contract Analysis

## 0. Scope and Evidence Rules

이 문서는 지금까지의 개별 분석(OCR, Translation, Inpainting, Renderer)을 CarrotMangaTranslator의 end-to-end data flow 하나로 연결한다. 그 위에서 독립 Linux RoverCMT Core가 보존해야 할 최소 데이터 모델과 stage 간 contract를 정리한다.

이번 작업에서 하지 않은 것:
- 구현, migration, benchmark, runtime 실행
- 기존 문서, production code, renderer spike 수정

이번 작업에서 새로 확인한 source는 import, rule/review stage, typography merge, layout, library 저장, renderer spike layout 코드다.

- **[FACT]** source, 기존 분석, library/run artifact에서 직접 확인
- **[INFERENCE]** 도출했으나 runtime 검증 없음
- **[UNKNOWN]** 확인 불가
- **[RECOMMENDATION — USER DECISION REQUIRED]** 제안

기존 문서의 표기는 그대로 인용한다. 인용 약어:

| 약어 | 문서 |
|---|---|
| OCR | `OCR_RUNTIME_MIGRATION_ANALYSIS.md` |
| TR | `TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md` |
| INP | `INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md` |
| RCA | `RENDERER_CANDIDATE_ANALYSIS.md` |
| RFC | `RENDERER_FIXTURE_CENSUS.md` |
| RLC | `RENDERER_LIBRARY_FEATURE_CENSUS.md` |
| RCS | `RENDERER_COMPARISON_SPIKE.md` |

### 0.1 문서 간 충돌과 재확인 결과

| 주제 | 기존 기록 | 재확인 결과 |
|---|---|---|
| stage 저장의 stale 검사 | TR §7.2: `port.save(…, before, …)` semantics **[UNKNOWN]** | **[FACT]** `savePageWorkflowResultUnlocked`(`libraryStore/pageWorkflowMutations.ts:19`)는 파일의 현재 page와 `before`를 `createPageRevision`과 `updatedAt`으로 비교한다. 다르면 "페이지가 변경되어 작업 결과를 저장하지 않았습니다" 예외를 던진다. **stale 저장 guard가 있다** |
| 번역 누락의 silent 여부 | TR §6: 누락 block이 있어도 page가 `completed`, "silent fallback" | **[FACT] 보완**: translate step은 `completed`다. 그러나 **review stage**가 `emptyTranslation` 규칙으로 누락 block을 `pageWorkflow.findings`에 기록한다. local library의 빈 번역 79개가 전부 finding으로 기록됐다(3/3, 8/8, 68/68). 다만 1개 chapter(46e79bc1)는 review가 실행되지 않은 receipt 상태이고 8개가 미표시다. 따라서 **stage 수준에서는 silent, review가 실행되면 finding으로 노출**된다 |
| Skia `_0411` 차이 | RCS §5: Skia 35px/3줄, Playwright 94px/8줄. "quality ranking이 아님" | **[FACT]** 해당 block은 `autoFitText:true`이고 source-match가 아니다. production autofit 상한은 `MAX_AUTOFIT_FONT_SIZE_PX = 256`(`renderer/src/lib/overlayLayout.ts:25`, `resolveAutoFitUpperBound`)이다. spike의 `shared-layout.ts:78`은 상한을 저장된 `block.fontSizePx`(35)로 둔다. **[INFERENCE]** `_0411` 차이의 상당 부분은 Skia backend가 아니라 spike의 layout contract 재구현 차이로 설명될 가능성이 크다(§0.2) |

### 0.2 Renderer decision state

- **사용자 육안 관찰** (source fact가 아니다)
  - Electron reference가 가장 자연스럽다.
  - Playwright는 reference와 매우 유사하다.
  - Skia는 font size와 wrapping이 불안정하고, 특히 `_0411`은 실사용이 어렵다.
- **[FACT]** spike의 두 candidate 모두 source-match 입력 없이 렌더한다.
  - Playwright adapter는 `sourceText:""`, `sourceDirection=renderDirection`을 주입한다(`spikes/renderer-comparison/src/playwright-adapter.cjs` `toProductionBlock`).
  - fixture snapshot에는 `sourceFontFacePx` 등이 없다(RLC §6.1).
  - reference v2는 원본 `chapter.json` page로 렌더했다.
- **[INFERENCE]** 사용자 관찰이 "Skia backend의 한계"인지 "harness contract 차이"인지는 아직 구분되지 않았다. 적어도 `_0411`에는 harness 쪽 원인 후보(autofit 상한)가 source에 있다. renderer 결정 전에 이 차이를 제거한 재비교가 필요하다.

## 1. End-to-End Production Data Flow

기준은 staged page workflow다(`application/pageWorkflowService.ts`, `pageWorkflow/pageWorkflowRuntime.ts`). stage 목록은 `detect → ocr → source-rules → translate → translation-rules → typography → format-rules → erase → layout → review`이고, 이후 export/render는 별도 job이다.

```
User input (zip/folder of images)
  │  [FACT] import: zip은 Rust runner(mgt-import-source-runner), 형식 판별 후 <chapter>/pages/NNN-<pageId>.{png|jpg}
  │         webp → PNG 변환. page {id, name, imagePath, width, height, sourceFileName?}
  ▼
Page(raster file, id, size)
  │  raster path, page size
  ▼
Detection  (Koharu layout ONNX, DirectML/CPU)
  │  blocks[] {id=region.id, bbox(normalized_1000), confidence=detectorConfidence,
  │           type, textRole:"ordinary", textDisplayMode:"translation-only", 서식 기본값,
  │           workflowOrigin{geometryKey, recognitionBboxes?, ocrSubdivision?, initialFont*}}
  │  blockOrder, soundEffectReview.regions(효과음 영역)            ← detector mask는 저장 안 함
  ▼
OCR  (HayaiOCR, Python/PyTorch child)
  │  입력: 원본 raster + manifest(block 순서 id=index+1, pixel bbox, recognitionBboxes, ocrSubdivision)
  │  출력: sourceText(Node sanitize, ≤160자), workflowOrigin.recognitionSegments?, ocrFailure?
  ▼
Source Rules  (사용자 정의 조건부 batch rule; 규칙 없으면 no-op)
  ▼
Translation  (OpenAI 호환 vision endpoint; local evidence 100%)
  │  입력: 원본 raster(base64), 대상 block {id, bbox, sourceText(재sanitize), 기존 번역},
  │        glossary/characters/story memory(최근 6p), 언어
  │  출력: translatedText(+fontRole, visualClusterId). 누락 block은 이전 값 유지
  │  부수효과: story-memory.json, style-guide.json(glossary 자동 병합)
  ▼
Translation Rules  (사용자 rule)
  ▼
Typography  (plan.autoSize/autoFont; raster 글자 크기 추정 + 선택적 font matching)
  │  fontSizePx, fontSizeIntent, sourceFontFacePx, sourceFontSizeConfidence,
  │  sourceFontSizeMethod, autoFitText (+ fontFamily/bold/… when autoFont)
  ▼
Format Rules  (사용자 rule)
  ▼
Erase/Inpainting  (Flux Klein Rust runner + Koharu layout prepass)
  │  입력: inpaintedImagePath ?? imagePath, 대상 block bbox, fontSizePx(padding), bubble prepass
  │  출력: inpaintedImagePath, inpaintMaskPath, maskProvenance, erasedWorkflowRegions
  │  (병렬 모드에서는 translation과 동시에 실행, commit은 translation 후)
  ▼
Layout  (Koharu layout 재검출 + bubble slot 계산)
  │  bubbleLayout, renderBbox, renderBboxSpace (+ natural layout 줄바꿈 선택 시)
  ▼
Review  (Electron render session으로 page를 그리고 검사 rule 실행)
  │  pageWorkflow.findings[{blockId, rule}]  (빈 번역, 원문과 동일, 숫자 불일치 등)
  ▼
Renderer/Export  (별도 job: hidden Electron BrowserWindow + PageArtwork)
     입력: inpaintedImagePath ?? imagePath, blocks(번역, geometry, 서식), font catalog
     출력: 사용자 output directory의 PNG/JPEG(source 형식 보존 모드 등)
```

근거:
- import: `libraryStore/importPageMaterialize.ts:296`
- detection: OCR §2.2, `pageWorkflowOcr.ts:24`
- rule stage: `pageWorkflowRuleExecution.ts`
- typography: `pageWorkflowTypographyMerge.ts`
- erase: INP §1
- layout: `pageWorkflowImages.ts` `layoutWorkflowPage`, `inpainting/bubbleLayoutRunner.ts:254`
- export: RCA §2

**[FACT/local]** chapter.json 5개 모두 page 파일명 확장자와 저장 raster 확장자가 다르다(예: `.jpg` → `.png` 48/49, `.webp` → `.png` 77/77). 이는 import가 원본 bytes를 그대로 두지 않을 수 있음을 뜻한다. 원본 zip entry와 byte가 동일한지는 **[UNKNOWN]**이다.

## 2. Canonical Entity Model

| Entity | Identity | 저장 위치 | 비고 |
|---|---|---|---|
| Work | `id`(uuid) | `library/works/<workId>/work.json`, `style-guide.json` | style guide = glossary/characters/rules |
| Chapter | `id`(uuid), `workId` | `…/chapters/<chapterId>/chapter.json` | 모든 page/block state를 한 파일에 담는다. `story-memory.json` 별도 |
| Page | `id`(uuid), `name`(원본 파일명), `imagePath`(`pages/NNN-<pageId>.ext`) | chapter.json `pages[]`, `pageOrder` | 원본 raster identity는 **경로**뿐이다. content hash 필드는 없다 [FACT: page 필드 목록] |
| Block | `id`(detection region id), page 내 `blockOrder` | chapter.json `pages[].blocks[]` | 요청/stage마다 쓰는 임시 id(`index+1`)와 구분해야 한다 |
| Workflow run | `runId` | `page-workflows/<runId>.json`(request, plan, rules), `runs/<runId>/pages/<pageId>/attempt-N/` | page의 `pageWorkflow.runId`, `planKey`, `steps{stage:{status,inputKey,outputKey,resumeKey,configurationKey}}`, `findings` |
| Stage revision | `workflowStageKey(page, stage)`(stage별 입력 hash), `createPageRevision(page)` | `pageWorkflow.steps` | erase key = geometry, inpaintExcluded, inpaintedImagePath, erasedWorkflowRegions (`shared/pageWorkflowPolicy.ts:35`) |
| Region key | `workflowRegionKey(page, block)` | `workflowOrigin.geometryKey`, `erasedWorkflowRegions[blockId]` | geometry가 바뀌면 OCR subdivision 재사용과 erase 재실행이 무효화된다 |
| Artifact | 파일 경로(uuid suffix) | `inpainted/pattern-<uuid>.png`, `mask/…png`, run artifact | page state가 경로로 참조한다 |
| Model/runtime identity | page state에는 거의 없음 | `bubbleLayout.modelId`, `sourceImageRevision`만 block에 있다. OCR model pin은 run artifact `ocr-bbox-hints.json.model`, translation model은 `result.json.settings/requestSummary`, Flux model은 로그와 mgtmeta | §10 |

- **Rover가 유지해야 할 identity [INFERENCE]**
  - page id
  - block id(영속)
  - 원본 raster identity(hash 권장)
  - stage 입력 revision(재실행 판정용)
  - artifact ↔ page/stage/model 연결
- **Carrot UI/library 때문에 존재하는 identity [FACT]**
  - library lock resource, transaction id, linked workspace, revision store
  - receipt의 `resumeKey`/`planKey`
  - `soundEffectReview` override, 수동 편집 history

## 3. Page Data Lifecycle

| 단계 | 생성/수정되는 page 필드 | artifact | downstream consumer |
|---|---|---|---|
| Import | `id, name, imagePath, width, height, (sourceFileName, sourceRelativePath), analysisStatus, createdAt` | `pages/` raster | 모든 stage |
| Detection | `blocks`(교체), `blockOrder`, `analysisStatus:"idle"`, `translationCheckpoint/translationCompletion` 초기화, `soundEffectReview`(effect region) | `runs/…/hayai-regions.json` | OCR, 이후 전부 |
| OCR | block 필드만 바뀐다. 실패하면 `lastError`와 `analysisStatus` | `workflow-regions.json`, `ocr-bbox-hints.json` | translation, typography, erase-scale |
| Translation | `analysisStatus:"completed"`, `lastError` 제거, block 번역 | `overlay-items.json`, `result.json`, `result.md`, `story-memory.json`, `style-guide.json` | 이후 전부 |
| Typography | block 서식 필드 | — | layout, renderer |
| Erase | `inpaintedImagePath`, `inpaintMaskPath`, `maskProvenance`, `updatedAt`, `erasedWorkflowRegions` (순차 모드: prepass가 바꾼 block 필드 포함) | `inpainted/*.png`, `mask/*.png` | layout(stage key), renderer |
| Layout | block `bubbleLayout`, `renderBbox`, `renderBboxSpace` | — | renderer |
| Review | `pageWorkflow.findings` | — | 사용자 |
| 모든 stage 저장 | `pageWorkflow.steps[stage]`, `updatedAt`, chapter `status`/`updatedAt`, work `updatedAt` | chapter.json 전체 rewrite | 재실행 판정 |
| Export | page state 변화 없음 | 사용자 output directory | — |

**[FACT]** detection은 `blocks`를 **통째로 교체**한다. OCR 이후 모든 block 필드도 교체 대상이다. 따라서 detect overwrite는 이전 번역, 서식, layout을 버린다.

## 4. Block Data Lifecycle

범례:
- **P** producer, **C** consumer
- **Pers** 영속(chapter.json)
- **Req** RoverCMT minimal E2E 필수(**[INFERENCE]**)
- **Q** 품질 보조, **U** 현재 자동 pipeline 미사용, **CS** Carrot 전용

| Field | P | C | Pers | Req | 분류 |
|---|---|---|---|---|---|
| `id` | detect | 모든 stage의 merge key | ✓ | ✓ | |
| `bbox`, `bboxSpace` | detect(수동 편집) | OCR manifest, translation candidate, erase mask, renderer 기본 rect | ✓ | ✓ | |
| `confidence` | detect(detector score). translation merge에서는 바뀌지 않음 | previous pass prompt | ✓ | | Q |
| `workflowOrigin.recognitionBboxes` | detect | OCR 첫 판독 crop, erase-scale fallback, typography | ✓ | | Q |
| `workflowOrigin.ocrSubdivision` | detect(detector mask) | OCR preemptive/retry crop | ✓ | | Q |
| `workflowOrigin.recognitionSegments` | OCR | typography(`pageWorkflowTypographyInput.ts:62`), erase-scale(병렬 모드), font matching | ✓ | | Q |
| `workflowOrigin.ocrFailure` | OCR | 사용자. OCR CHECK 실패 | ✓ | | 상태 |
| `workflowOrigin.geometryKey`, `initialFont*`, `fontApplied`, `sizeApplied` | detect, typography | subdivision 재사용 판정, typography overwrite 판정 | ✓ | | CS |
| `sourceText` | OCR(sanitize, ≤160자). 수동 입력 | translation(candidate `ocrText`, previous `jp`), 빈 원문 guard, typography probe, erase-scale 줄 수, renderer source-match probe(`sourceFontSizeMatching`) | ✓ | ✓ | |
| raw OCR text | **없음** | — | ✗ | | §5 |
| `translatedText` | translation(non-empty만 merge), rules | renderer, review | ✓ | ✓ | |
| `textDisplayMode:"translation-only"` | detect | renderer: 빈 번역이면 아무것도 그리지 않음 | ✓ | ✓ | |
| `textRole` | detect(`ordinary`) | renderer source-size fallback, prompt | ✓ | | Q |
| `fontRole`, `fontRoleConfidence`, `visualClusterId` | translation(모델 출력) | renderer autofit role bound(`sign_ui_title`), font matching | ✓ | | Q |
| `fontSizePx` | detect 기본값 → typography | renderer 상한/기본 크기, erase padding·margin·dilation | ✓ | ✓ | |
| `fontSizeIntent`, `sourceFontFacePx`, `sourceFontSizeConfidence`, `sourceFontSizeMethod` | typography | renderer source-match cap과 page median fallback(RLC §6.1) | ✓ | Q(현 corpus 540/603 사용) | |
| `autoFitText` | 서식 기본값 → typography | renderer fit 경로 | ✓ | ✓ | |
| `fontFamily`, `fontWeight`, `bold`, `italic`, 색, outline | 서식 기본값 / typography(autoFont) | renderer | ✓ | 기본값만 필요 | 현 corpus는 default(RLC §4) |
| `lineHeight`, `letterSpacing`, `fontWidthScale`, `wordBreak`, `textAlign` | 서식 기본값 | renderer wrapping/fit | ✓ | ✓(기본값) | |
| `sourceDirection`, `renderDirection`, `layoutIntent` | detect(기본값) | renderer, source-size probe | ✓ | ✓ | 현 corpus 전부 horizontal |
| `bubbleLayout` | layout(Koharu 재검출). 순차 모드는 erase prepass | renderer slot fitting, erase bubble constraint(prepass 결과 사용), layout 대상 판정 | ✓ | Q | chapter.json 최대 비중(§9) |
| `renderBbox`, `renderBboxSpace` | layout | renderer rect(`renderBbox ?? bbox`), source-size geometry 신뢰 판정 | ✓ | Q | |
| `inpaintExcluded` | 사용자 | erase 대상 제외 | ✓ | | CS/manual |
| `rotationDeg` | 기본 0 | renderer | ✓ | | U(identity) |
| `perspectiveTransform`, `curveLayout`, `warpTransform`, `textEffect`, `textGlow`, `generatedLettering`, rich-text markup | 수동 편집 | renderer | 있으면 ✓ | | U(0/603, RLC) |
| `backgroundColor`, `opacity` | 기본값 | editor chrome만 | ✓ | | CS(UI) |
| page `erasedWorkflowRegions[blockId]` | erase | erase 재실행 판정, erase stage key | ✓ | | 상태 |

## 5. Information Loss Audit

| # | 손실 지점 | 확인 | 영향 |
|---|---|---|---|
| 1 | Hayai 원 출력 text → `sanitizeOcrTextForPrompt`(ja noise 제거, glossary omission, control 문자 제거, **160자 절단**) → `sourceText` | [FACT] OCR §8.2, `runtime/prompts/ocr-text.cjs:94-113` | raw OCR은 run artifact `ocr-bbox-hints.json`에만 남는다(`runs/` 보존 기간 동안) |
| 2 | Python `normalize_text`: NFKC, 개행→공백, CJK 사이 공백 제거 | [FACT] OCR §8.2 | 줄 구조 소실. erase-scale 줄 수 fallback이 항상 1 |
| 3 | translation 시 재sanitize | [FACT] TR §3.4 | canonical이 아닌 derived view가 이미 저장돼 있어 이중 변환된다 |
| 4 | raw OCR canonical field 없음 | [FACT] block 필드 목록 | 재번역 시 원 판독을 되살릴 수 없다(run artifact가 없으면) |
| 5 | 번역 누락 block → 이전 값(빈 문자열) 유지, translate `completed` | [FACT] TR §5.3, §6 | review finding으로만 노출(§0.1) |
| 6 | erase는 `translatedText`와 무관하게 대상 선정 | [FACT] INP §10, `pageWorkflowPolicy.ts:71` | 원문이 지워진 빈 영역 |
| 7 | detector mask(말풍선/텍스트 mask) 미저장. subdivision box와 detector score만 남음 | [FACT] `detectWorkflowBlocks`, bubble runner cache는 runner 수명 | 같은 Koharu layout 추론을 detect, erase prepass, layout에서 **page마다 최대 3회** 반복한다. `workflowBubbleRunner(context)`가 호출마다 새 runner와 새 cache를 만든다 [FACT: `pageWorkflowImages.ts`, `bubbleLayoutFacade.ts` `detectionsByOriginalPath`] |
| 8 | 모델 번역 출력 중 `jp`(모델 재판독), geometry, direction, fontSize, confidence는 staged merge에서 버려짐 | [FACT] TR §5.3 | raw는 `result.json` `outputText`에만 남는다 |
| 9 | translation raw response | [FACT] `runs/…/result.json`(prompt, system prompt, outputText, rawResponse, settings) 보존 | run artifact 보존에 의존. chapter.json에는 연결 필드가 없다(run id는 `pageWorkflow.runId`로만 간접 연결) |
| 10 | Flux crop 결과, crop별 변화 통계 | [FACT] 임시 디렉터리는 삭제. 로그에만 요약 | page PNG로 합성된 결과만 남는다 |
| 11 | mask provenance | [FACT] `maskProvenance` 문자열 + union mask PNG | 어느 run/model/block이 어느 pixel을 지웠는지 구분 불가(union) |
| 12 | renderer 입력 재현 | [FACT] export는 chapter.json + 원본/inpainted raster + font catalog로 재현 가능. 단 export 시점의 font file hash, Chromium version, 결과 layout evidence는 저장되지 않는다(RFC §12, RCA) | 결과 PNG 재현성 제한 |
| 13 | 원본 파일 → import 시 확장자/형식 변환 | [FACT/local] §1 | 원본 byte 보존 여부 [UNKNOWN] |
| 14 | translation 요청 대상 선정 `workflowTargetBlocks(translate)`: `sourceText` 비어 있으면 제외 | [FACT] | OCR 실패 block은 번역 입력에서 빠진다(assert가 먼저 막음) |

**[INFERENCE] canonical/derived 분리 가능성**
- `rawOcrText`(canonical) → `translationInputText`(stage view, sanitizer 적용)
- 현재 translation 입력 단계가 이미 sanitize를 다시 하므로, 분리해도 prompt 결과에는 큰 차이가 없어 보인다(TR §3.4).
- `modelTranslationRecord`(raw jp/ko/geometry/confidence)를 artifact로 남기고, `translatedText`는 accepted view로 두는 분리도 가능하다.
- 확정하지 않는다(§17).

## 6. Stage Contract Matrix

"최소"는 Rover minimal E2E에 필요한 것이다[INFERENCE]. "Carrot"은 실제 전체 contract다.

| Stage | INPUT (최소 / Carrot 추가) | OUTPUT | SIDE EFFECT | PERSISTED | MODEL/RUNTIME | DOWNSTREAM |
|---|---|---|---|---|---|---|
| Detection | raster, size / plan overwrite, emptyDetectionKey, blockFormatDefaults | blocks {id, bbox, confidence, recognitionBboxes?, ocrSubdivision?}, effect regions | run artifact `hayai-regions.json` | blocks, blockOrder, soundEffectReview, receipt | Koharu layout ONNX(DML/CPU), `onnxruntime-node`, image decode(Electron `nativeImage`) | 전부 |
| OCR | raster, 대상 block(bbox, subdivision) / page revision, stage key | 판독 text, segments, health | run artifact | sourceText, workflowOrigin, receipt | HayaiOCR v2(PyTorch child) | translation, typography, erase-scale |
| Source Rules | page / 사용자 rule, glossary | 수정된 block | Electron render session(측정) | page | Chromium(Electron) | translation |
| Translation | raster, blocks{id, bbox, sourceText}, 언어 / 기존 번역, glossary, story memory, previous story pages | translatedText(+fontRole 등) | story memory, style guide 자동 병합, run artifact | block 번역, context 파일, receipt | OpenAI 호환 vision endpoint(local evidence) / managed llama-server / Codex | typography, review, renderer |
| Translation Rules | 동일 rule 구조 | 수정된 block | Electron render session | page | Chromium | 이후 |
| Typography | raster, blocks, plan.autoSize/autoFont | 크기/font 필드 | font matching runtime(선택) | block 서식 | raster 추정(`estimatePageSourceFontSizes`) + font matching(선택) | renderer, erase padding |
| Format Rules | rule | 수정된 block | Electron render session | page | Chromium | erase, layout |
| Erase | raster(inpainted 우선), 대상 block bbox, fontSizePx / bubble prepass, erase-scale(병렬), region keys | page PNG, mask PNG | 임시 crop 파일(삭제), Koharu layout 재검출 | inpainted/mask 경로, erasedWorkflowRegions | Flux Klein Rust runner(CUDA), Koharu layout ONNX | layout, renderer |
| Layout | raster, blocks / plan.bubbleLayout, naturalLayout | bubbleLayout, renderBbox | Koharu layout 재검출 | block geometry | Koharu layout ONNX | renderer |
| Review | page | findings | Electron render session | findings | Chromium | 사용자 |
| Renderer/Export | inpainted ?? 원본 raster, blocks, font / output 설정 | 최종 image | hidden BrowserWindow, tile+FFmpeg(대형) | 없음(output dir) | Electron Chromium | — |

- **[FACT]** Source Rules, Translation Rules, Format Rules, Review는 모두 `createPageExportRenderSession`(Electron)으로 page를 실제 렌더한 뒤 규칙을 적용한다(`pageWorkflowRuleExecution.ts`).
- 규칙이 없는 rule stage는 no-op이다.
- local plan 기록에 `format-rules`가 포함된 run은 없다(INP §3의 plan 목록).

## 7. Dependency Graph (필드 단위)

```
bbox ─┬→ OCR manifest crop ─→ sourceText
      ├→ translation candidate rect / overlap fallback 매핑
      ├→ erase mask(sourceRect) / window
      ├→ renderer rect (renderBbox 없을 때)
      └→ region key → ocrSubdivision 재사용, erasedWorkflowRegions, stage keys

recognitionBboxes ─┬→ OCR 첫 판독 crop
                   ├→ typography(workflowOcrHints 경유)
                   └→ erase-scale fallback(병렬 모드)
ocrSubdivision ────→ OCR crop 계획
recognitionSegments ─┬→ typography source-size 추정 입력
                     ├→ erase-scale(ocr-geometry, 병렬 모드) → erase fontSizePx(사본) → mask padding
                     └→ font matching cross-script hints
sourceText ─┬→ translation (candidate ocrText, previous jp) ─→ translatedText
            ├→ 빈 원문 guard (translate 대상 선정, assertWorkflowSource)
            ├→ OCR/translate stage key
            ├→ typography probe, renderer source-match probe(visibleProbe, 8 grapheme 판정)
            └→ erase-scale 줄 수 fallback
translatedText ─┬→ renderer(빈 값이면 미렌더)
                ├→ review(emptyTranslation 등)
                ├→ translate stage key
                └→ (erase는 사용하지 않음)
fontSizePx ─┬→ renderer 기본/상한(autoFit off일 때)
            └→ erase padding(0.18×), window margin(2.8×), dilation(1/7)
sourceFontFacePx/Confidence/Method + fontSizeIntent ─→ renderer source-match cap, page median fallback
bubbleLayout ─┬→ renderer slot fitting
              ├→ erase bubble constraint(prepass 결과, 순차 모드에서 저장)
              ├→ layout 대상 판정(!bubbleLayout)
              └→ renderer source-size geometry 신뢰 판정(isGeneratedBubbleLayout)
renderBbox ─┬→ renderer rect
            └→ source-size 신뢰 판정
inpaintedImagePath ─┬→ renderer/export raster
                    ├→ erase 재실행 입력(preserveExistingInpainting)
                    └→ erase/layout stage key
```

**[INFERENCE] 제거 시 영향**
- `recognitionSegments`를 없애면 OCR 결과, typography 추정, 병렬 erase 크기가 바뀐다. 기본 기능은 유지된다.
- `sourceText`를 없애면 translation이 불가능하다.
- `bubbleLayout`을 없애면 renderer가 rect fitting으로 후퇴하고, erase가 bubble constraint를 잃는다.
- source-match 필드를 없애면 renderer font size가 바뀐다(RLC §6.1, 현 corpus 90%).

## 8. Runtime / GPU Ownership Map

| Runtime | Process | 언어 | GPU/CPU (local) | Load | Lifetime / release | Cache |
|---|---|---|---|---|---|---|
| Koharu layout (detect, erase prepass, layout) | in-process(main) | `onnxruntime-node` | DirectML(RTX 5070 Ti) 또는 CPU | 첫 추론 | module cache. translation page마다 `releaseDetectorResources`로 dispose(OCR §2.2, INP §6.3) | session key당 1개 |
| HayaiOCR | child(Python) | PyTorch | CUDA cu130 | process마다(batch 1회) | batch 종료 시 process 종료. `waitForOcrIdle` | HF cache(디스크) |
| Translation | 원격 HTTP(local evidence) / local llama-server child / Codex | — / C++ | 원격 GPU / local GPU | endpoint session 시작 | `runWholePagePipeline` 1회(= page 1개) 종료 시 dispose. gemma는 server 종료 [INFERENCE: page마다 재기동, TR §9.2] | 원격 server prompt cache |
| Flux Klein | child(Rust runner, JSON-lines) | Candle | CUDA(sm120) | worker 생성 시 1회(local 2.5–10.7초) | 30초 idle TTL. Koharu 전환 시와 GPU OCR 전에 dispose, gemma translation 전에 dispose | pool entry 1 |
| Typography 추정 / font matching | in-process / worker | TS / ONNX(font matching) | CPU/GPU | 선택 | run 단위 dispose | |
| Renderer / rule stage | hidden BrowserWindow | Chromium | GPU compositing 설정에 따름 | session마다 | rule stage마다 session 생성/close | |

**[FACT] 현재 handoff 순서** (순차 모드)
1. OCR 전: `releaseGpuBeforeOcr` → inpainting engine dispose
2. Hayai child 실행 후 종료 대기(`waitForOcrIdle`)
3. translation 시작마다: detector session dispose → grouping evidence dispose → (gemma만) inpainting dispose → endpoint
4. erase: Flux acquire(첫 page), Koharu layout session 재생성
5. layout: Koharu layout

**[FACT] 병렬 모드**(openai-api 전용): translation(원격)과 erase(Flux CUDA + Koharu DML)가 동시에 돌고, translation lane의 detector dispose가 erase lane의 Koharu session을 반복 무효화한다(INP §6.3).

**[INFERENCE] GPU 하나 공유 시 충돌 가능 조합**
- local LLM + Flux: Carrot은 translation 전 Flux 해제로 회피한다.
- HayaiOCR + Flux: OCR 전 해제로 회피한다.
- Koharu DML + Flux CUDA: 병렬 모드에서 같은 GPU를 교대로 쓴다.
- Rover scheduling 정책은 정하지 않는다.

## 9. Persistence and Artifact Model

| 저장물 | 분류 | 재실행 필요 | 재생성 가능 | 비고 |
|---|---|---|---|---|
| `chapter.json` | **canonical** | ✓ | ✗ | page/block/receipt/findings 전부. stage 저장 1회마다 전체 read + durable backup + fsync + rewrite(INP §7) |
| `pages/*`(원본 raster) | canonical | ✓ | ✗ | 형식 변환 가능성(§1) |
| `work.json`, `style-guide.json` | canonical(context) | ✓(translation 품질) | 부분(AI 자동 생성) | glossary 49개 전부 `origin:"ai"`(TR §3.6) |
| `story-memory.json` | canonical(context) | 선택 | 재번역으로 재생성 | |
| `inpainted/*.png` | derived(비쌈) | renderer 필수 | 재erase로 가능(비결정적일 수 있음 [UNKNOWN]) | page당 1개. 참조 수와 일치 |
| `mask/*.png` | derived + 이력(union) | 재erase/retouch | 부분 | |
| `runs/<runId>/…`(OCR/translation artifact) | debug + 유일한 raw 보관 | ✗ | ✗(모델 재실행 필요) | raw OCR과 raw translation의 유일한 사본 |
| `page-workflows/<runId>.json` | run request 기록 | ✗ | ✗ | plan/rules |
| receipts(`pageWorkflow.steps`) | 재실행 제어 | ✓ | — | chapter.json 내부 |
| 로그(`logs/app.log`) | debug | ✗ | ✗ | page-timing, crop 시간 |
| model files, runtime(`models/`, `ocr-runtime/`, `hf-cache/`) | cache | ✓ | 다운로드로 가능 | 해시 sidecar(Flux mgtmeta, Hayai pin) |
| `.transactions/` | 임시 | ✗ | — | 조사 시 0개 |

**[FACT/local] chapter.json 구성** (592a103c, 4.4MB/49p):
- `blocks` 2,268,441 B, 그중 `bubbleLayout` 1,951,023 B(**block 데이터의 약 86%, 파일 전체의 약 44%**)
- `workflowOrigin` 58,867 B, `pageWorkflow` 65,903 B, `soundEffectReview` 38,436 B

`bubbleLayout`이 큰 이유: `regions[].spans[]`에 행 단위 `{blockStart, blockEnd, inlineStart, inlineEnd}`를 수십 개 저장한다(예: `_0411` block 1개에 spans 약 76개).

page당 chapter.json 크기는 83–161 KB다(INP §14). INP의 "약 86%"는 **block 데이터 대비** 비율이고, 파일 전체 대비로는 약 44%다. 기존 문서 요약의 "chapter.json의 약 86%"라는 표현은 이 기준으로 읽어야 한다.

## 10. Reproducibility

| Stage | 기록된 것 | 부족한 것 |
|---|---|---|
| Import | 파일명, 경로 | 원본 content hash, 변환 여부 |
| Detection | `bubbleLayout.modelId`/`sourceImageRevision`(layout 단계), detector score | detect stage model id와 ORT/provider version(로그에만 provider) |
| OCR | run artifact에 model/processor revision pin, 출력 JSON | chapter.json에 연결 없음. runtime version은 설치 marker에만 |
| Translation | `result.json`: prompt, system prompt, settings, model 문자열, raw response, usage | 원격 server binary/version/flag, GGUF hash(경로 문자열뿐), 이미지 hash |
| Typography | `sourceFontSizeMethod:"raster-core-v1"` | font matching model version(사용 시) |
| Erase | 로그: backend, model load, crop 시간. model 파일 mgtmeta(URL rev, sha256) | page state에 model id/hash 없음. runner version, seed/steps(steps=4는 코드 상수) |
| Layout | `bubbleLayout.modelId` | |
| Renderer | 없음 | Chromium/Electron version, font file hash(RFC §12), layout evidence |

**[RECOMMENDATION — USER DECISION REQUIRED] 현실적인 보존 수준 후보**
- L1(최소): stage 결과마다 `{stage, runtimeId, modelId+hash, codeVersion, startedAt, inputRevision}`
- L2: + raw model output artifact 경로(OCR/translation/erase crop 요약)
- L3: + prompt, 이미지 hash, font hash, renderer version(완전 재현 지향)

## 11. Failure Semantics

| 사건 | 현재 전파 | 상태 표현 |
|---|---|---|
| OCR 생성 한도 소진 | `sourceText=""`, `ocrFailure` 기록, page `PageWorkflowPartialFailure` | OCR step `failed`, 이후 stage 건너뜀(`hasFailedDependency`) [FACT] |
| 번역 malformed/parse 실패 | page retry(최대 5) 후 `failed` | translate step `failed`, 이후 stage 건너뜀 [FACT] |
| 번역 block 누락 | 빈 `translatedText` 유지, translate `completed` | **erase 실행**, review finding(review 실행 시) [FACT] |
| erase 일부 incomplete | 부분 결과 저장 + `PartialFailure` | erase step `failed`(부분 결과 영속) [FACT] |
| erase blocksErased=0 | 오류 없이 반환 | erase `completed` [FACT] |
| renderer 실패 | export job 오류 | page state와 무관 [FACT: export는 state를 바꾸지 않음] |
| rule stage 실패 | 예외 → step `failed` | [FACT] |

**[FACT] end-to-end 확인: 번역 누락 → 빈 출력**
1. `mergeWorkflowTranslations`는 non-empty 결과만 반영하고 page는 `completed`(`pageWorkflowTranslation.ts:76`).
2. `workflowTargetBlocks(erase)`는 `translatedText`를 보지 않는다(`pageWorkflowPolicy.ts:71`).
3. local library: 원문은 있고 번역이 빈 block 87개가 전부 `erasedWorkflowRegions`에 있고, page에 `inpaintedImagePath`가 있다(INP §10).
4. renderer: `textDisplayMode==="translation-only"`이고 번역이 비면 content를 렌더하지 않는다(`PageArtwork.tsx` `ArtworkBlock`, RLC 조사).
5. review: `emptyTranslation` finding 기록(§0.1).
6. **[INFERENCE]** 결과물에는 원문도 번역도 없는 빈 말풍선이 나온다. 실제 export image를 눈으로 확인하지는 않았다.

**[INFERENCE] 상태 구분 필요성**
- 현재 stage 상태는 `completed/failed/empty`뿐이다(receipt). SUCCESS와 PARTIAL(누락 block, blocksErased=0)을 구분하지 못한다.
- `empty`는 대상이 없는 경우다.
- SUCCESS / PARTIAL / FAILED / SKIPPED 4단계, 그리고 block 단위 결과 표현이 있으면 위 경로를 명시적으로 다룰 수 있다(§17).

## 12. Performance State Accumulation Map

"증가"는 성능 저하 원인과 같지 않다. 기존 로그에서 erase 누적 저하 증거는 없었다(INP §14). 같은 `page-timing` 로그를 이번에 재분석한 결과, 4개 run의 `translationMs`도 page index와 음의 상관(Spearman −0.29~−0.52)이었다 [FACT: 로그 재분석. 표본 8–44 page].

| 항목 | 분류 | 근거 |
|---|---|---|
| story memory(page 요약) | GROWS | page마다 추가, prompt에는 최근 6p + budget pruning [FACT TR §3.3] |
| glossary / characters | GROWS(자동 병합) | [FACT] |
| translation prompt tokens | BOUNDED(추정) | budget pruning. local max 약 8.8k [FACT] |
| chapter.json 크기 | GROWS(page 수, run 진행 중 bubbleLayout 추가) | [FACT] |
| chapter 저장 1회 비용 | GROWS(파일 크기 비례), 저장 횟수 page×stage → 전체 O(N²) [INFERENCE] | INP §7 |
| bubbleLayout | GROWS | [FACT] |
| deferred erase 결과(병렬) | GROWS(page 객체) | [FACT] INP §7 |
| prepared source-erase map(병렬) | GROWS | [FACT] |
| workflow OCR batch 결과 map(`preparedOcr`) | GROWS(OCR stage 동안 모든 page 결과 보관) | [FACT] `prepareWorkflowOcrBatch` |
| artifact file 수, inpainted PNG, mask | GROWS(디스크, 선형) | [FACT] |
| run artifacts | GROWS | [FACT] |
| receipts / findings | GROWS(chapter.json 내부) | [FACT] |
| logs | GROWS | [FACT] |
| image buffers / decoded images | PER-PAGE TEMPORARY | [FACT] INP §7 |
| Flux runtime cache | BOUNDED | [FACT] |
| Koharu session cache | BOUNDED(반복 재생성) | [FACT] |
| Hayai process | PER-BATCH | [FACT] |
| GPU caches / allocator | UNKNOWN | |
| Node heap / GC | UNKNOWN | |

## 13. Proposed Minimal RoverCMT Core Model

**[RECOMMENDATION — USER DECISION REQUIRED]** 아래는 개념 후보이며 확정이 아니다.

```
Project { id, sourceLanguage, targetLanguage, settingsRef }
Chapter { id, projectId, pageOrder[] , contextRef? }
Page {
  id, index,
  source: { path, sha256, width, height, originalName, format }
  blocks[] (canonical, block order = reading order)
  stageResults: { [stage]: StageResultRef }       // 최신 결과 참조
}
Block {
  id,                              // 영속, 모든 stage의 key
  geometry: { bbox, space, detectorScore, recognitionBoxes?, subdivision? }
  text: { rawOcr?, ocrHealth?, source?(derived view 또는 수동), translation?, translationStatus }
  typography?: { fontSizePx, fontSizeIntent?, sourceFace?{px, confidence, method}, autoFit,
                 family?, direction?, align?, lineHeight?, ... }       // 없으면 renderer 기본값
  layout?: { bubbleLayoutRef?, renderBbox? }       // 큰 slot 데이터는 artifact로 분리 후보
  render?: { rotation?, perspective?, curve?, warp?, effects?, richText? }   // optional 확장
  erase?: { status, regionKey }
}
Artifact { id, pageId, stage, kind(raster|mask|rawModelOutput|layout), path, sha256, producer{model, hash, runtime, version} }
StageResult { pageId, stage, status(SUCCESS|PARTIAL|FAILED|SKIPPED), blockResults{blockId→status/reason},
              inputRevision, artifacts[], timing, producer }
```

설계 원칙 대응:
- **원본 보존**: `source.sha256`, `text.rawOcr`, raw model output은 Artifact로 둔다.
- **derived 재생성**: `text.source`(sanitize view)와 translation input을 stage에서 파생한다.
- **UI/Core 분리**: `backgroundColor`/`opacity`(chrome), revision history, sound-effect review override는 Core 밖에 둔다.
- **model 격리**: producer 정보를 Artifact와 StageResult에 둔다.
- **전체 rewrite 회피**: page 단위 파일, 큰 `bubbleLayout` artifact 분리(§14).
- **partial 명시**: `StageResult.status` + `blockResults`
- **독립 재실행**: `inputRevision`으로 판정한다.
- **미래 vision inference**: `render`/`typography`를 optional 구조로 유지한다. 현재 corpus가 0/603이라는 이유로 제거하지 않는다.

## 14. Candidate Persistence Strategies

**[RECOMMENDATION — USER DECISION REQUIRED]** 비교만 하고 winner를 정하지 않는다.

| 기준 | A. chapter-level JSON(현 Carrot 방식 단순화) | B. page-level JSON + chapter manifest + artifact 파일 | C. SQLite + artifact 파일 |
|---|---|---|---|
| 단순성 | 가장 단순 | 단순 | 중간(schema, migration) |
| crash safety | 파일 단위 atomic rename 필요. 전체 파일 위험 | page 단위 atomic. manifest 일관성 관리 필요 | transaction 내장 |
| partial rerun | 가능하지만 매번 전체 저장 | page/stage 단위로 자연스러움 | 행 단위 |
| 20 vs 100+ page | 저장 1회 비용이 N에 비례(현 구조의 O(N²) 요인) | page 수와 무관 | 무관 |
| 디버깅/가독성 | 좋음(파일 1개) | 좋음(작은 파일) | 도구 필요 |
| migration 복잡도 | Carrot chapter.json과 가장 가까움 | 중간 | 높음 |
| artifact 관리 | 경로 참조 | 경로 + hash | 경로 + hash + 참조 무결성 |
| future UI 호환 | 전체 load | page lazy load | query 용이 |

## 15. Minimal E2E Contract

**[INFERENCE/RECOMMENDATION — USER DECISION REQUIRED]** Carrot의 거대 state 없이 한 흐름을 실행하는 데 필요한 최소 전달 정보:

| 경계 | 최소 전달 | 근거와 상태 |
|---|---|---|
| Input → Detection | raster path, size | [FACT] |
| Detection → OCR | block {id, bbox(px)}, 선택적으로 recognitionBboxes, ocrSubdivision | [FACT] OCR §8.1. subdivision 없이도 동작(품질 차이 [UNKNOWN]) |
| OCR → Translation | 원본 raster, block {id, bbox, sourceText(view)}, 언어 | [FACT] TR §4 |
| Translation → Erase | block {id, bbox, translationStatus} + fontSizePx(padding) | erase는 현재 번역을 보지 않는다. 누락 정책에 따라 status 필요(§17) |
| Erase → Typography/Layout | inpainted raster path | [FACT] layout은 원본 raster로 재검출(`request.page.imagePath` 기준) |
| Typography/Layout → Renderer | block {id, rect(renderBbox ?? bbox), translatedText, fontSizePx, autoFit, lineHeight, wordBreak, align, direction, 색/outline 기본값}, source-match 입력(선택), bubble slot(선택) | [FACT] RLC §6.1: source-match 필드가 없으면 크기가 달라진다 |
| Renderer → Output | PNG, 크기 | [FACT] |

- **[UNKNOWN]** Linux에서 각 runtime의 실제 동작(OCR, TR, INP smoke 계획)
- **[UNKNOWN]** renderer 선택(§0.2)
- **[UNKNOWN]** detection 단독 migration 분석(아직 없음)

## 16. What NOT to Migrate (초기)

| 항목 | 근거 | "현재 미사용"인가 "영구 불필요"인가 |
|---|---|---|
| Electron IPC, UI state, editor chrome(`opacity`, `backgroundColor`) | [FACT] renderer는 export에서 chrome을 무시 | 영구 불필요(Core 범위) |
| Windows managed installer, embedded Python, vcredist, ROCm/ZLUDA/HIP, DirectML adapter | [FACT] OCR/INP §11 | Core에서는 불필요. Linux 대응물은 별도 |
| library transaction/lock/linked workspace/revision store | [FACT] | Rover persistence로 대체 |
| manual editor history, retouch, redaction, sound-effect review override | [FACT] 자동 pipeline 밖 | 현재 미사용. 향후 UI에서 필요할 수 있음 |
| Paddle OCR, fixed-block/group review, Codex erase/translate, Koharu LaMa/AOT | [FACT] staged production 경로 밖 | 현재 미사용 |
| 사용자 정의 rule stage(source/translation/format rules) | [FACT] 규칙 없으면 no-op. local plan에 format-rules 없음 | 현재 미사용 |
| advanced renderer field(rotation, perspective, curve, warp, effect, rich text, custom font, vertical) | [FACT] 0/603(RLC) | **현재 미사용이지만** 향후 vision inference가 채울 수 있다. schema는 optional로 남기는 것을 권장 |
| 서식 기본값 전체 set | [FACT] identity 값뿐 | 기본값 상수로 대체 가능 |

## 17. Open Decisions for User

각 항목은 FACTS / TRADE-OFF / OPTIONS만 적는다.

1. **raw OCR canonical 보존**
   - FACTS: sanitize와 160자 절단 후 저장(§5 #1). translation에서 재sanitize.
   - TRADE-OFF: 저장량과 필드 수 증가 vs 재처리 가능성과 디버깅.
   - OPTIONS: (a) raw + view, (b) view만, (c) raw는 artifact로만.
2. **번역 누락 처리**
   - FACTS: 누락이 completed로 처리되고 review finding으로만 노출(§11).
   - TRADE-OFF: 재요청 비용 vs 빈 출력.
   - OPTIONS: (a) 누락 block만 재요청, (b) PARTIAL 표시 후 진행, (c) page 실패.
3. **erase와 번역의 관계**
   - FACTS: erase는 번역을 보지 않는다. 병렬 모드는 번역 전에 erase한다.
   - TRADE-OFF: 병렬성(시간) vs 빈 말풍선 위험.
   - OPTIONS: (a) 번역 성공 block만 erase, (b) 전부 erase하고 누락은 원문 복원, (c) 현행 유지.
4. **partial failure 정책**
   - FACTS: 상태가 completed/failed/empty뿐이다. blocksErased=0도 completed.
   - OPTIONS: 4단계 상태 + block 결과 / 현행.
5. **persistence 전략**
   - FACTS: 전체 rewrite, backup, fsync, bubbleLayout 비중(§9).
   - OPTIONS: §14 A/B/C.
6. **GPU ownership**
   - FACTS: §8 순서. 병렬 모드의 Koharu session 반복 재생성.
   - OPTIONS: stage 직렬 소유 / 제한적 병렬 / 원격 translation 전제.
7. **Renderer 전략**
   - FACTS: RCS 결과, 사용자 관찰(§0.2), spike contract 차이(§0.1).
   - OPTIONS: Playwright Chromium / contract를 맞춘 뒤 Skia 재평가 / 둘 다 유지.
8. **AI glossary 자동 누적**
   - FACTS: 49/49 `ai`, 자동 병합.
   - OPTIONS: 유지 / 검토 후 반영 / 비활성.
9. **detection 결과 보존**
   - FACTS: 같은 Koharu layout 추론을 page당 최대 3회 수행. mask 미저장.
   - OPTIONS: 결과 artifact 캐시 / 재계산 유지.
10. **reproducibility 수준**: §10 L1–L3

## 18. Exact Next Step

**Renderer contract-aligned re-comparison**(renderer spike의 입력 계약 보정 후 재비교)이 가장 먼저 필요하다고 판단한다. 근거는 다음과 같다.

- **[FACT]** renderer 결정은 production migration의 최대 미결정이다(CURRENT_STATUS).
- **[FACT]** 현재 비교 결과에는 두 가지 contract 결함이 섞여 있다.
  1. 모든 candidate의 source-match 입력 누락(RLC §6.1)
  2. Skia shared-layout의 autofit 상한 차이(§0.1)
- **[INFERENCE]** 사용자가 지적한 `_0411` 차이의 원인을 이 결함과 분리하지 않으면, Skia 기각 여부를 잘못 판단할 수 있다.

대안별 판단:

| 대안 | 판단 |
|---|---|
| Runtime smoke(OCR S0–S4, TR S4, INP §18) | 독립적이고 가치가 높지만 renderer 결정보다 뒤로 미뤄도 된다 |
| Detection analysis | 아직 문서가 없다. §5 #7(3회 재검출) 때문에 필요하지만 migration 경계에 미치는 영향은 renderer보다 작다 [INFERENCE] |
| 20/100 benchmark | 계측 추가(chapter 저장 시간, prepass 시간)가 먼저 필요하다(INP §15). 현재 로그로는 원인을 구분할 수 없다 |

제안하는 작업 범위(미실행):
1. 기존 v2 fixture 8개에 대해 snapshot에 source-match 입력(`sourceText`, `sourceDirection`, `textRole`, `sourceFontFacePx`, `sourceFontSizeConfidence`, `sourceFontSizeMethod`)을 추가한 새 manifest revision을 만든다.
2. Skia shared-layout의 autofit 상한을 production `resolveAutoFitUpperBound`와 같게 맞춘다.
3. Skia와 Playwright를 다시 렌더해 `_0411`을 포함한 layout evidence를 reference와 비교한다.

이 작업은 renderer spike 작업자와 조율이 필요하다. 이번 분석에서는 spike 파일을 수정하지 않았다.
