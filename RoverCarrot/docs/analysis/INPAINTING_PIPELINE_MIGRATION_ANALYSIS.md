# Erase / Inpainting Pipeline Migration Analysis

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M1 Linux Port](../milestones/M1_LINUX_PORT/README.md) — FLUX Klein runner Linux runtime
- [M2 Test Set / Benchmark](../milestones/M2_TEST_SET/README.md) — page 수별 benchmark 설계와 계측
- [M3 Pipelining](../milestones/M3_PIPELINING/README.md) — translation/erase 병렬 경로, GPU handoff
- [M4 Optimization](../milestones/M4_OPTIMIZATION/README.md) — Fast Erase, crop 수, runtime lifecycle, chapter 저장 비용
- [M5 Features](../milestones/M5_FEATURES/README.md) — 장시간 실행에서 커지는 상태

Tracking: [M1 CURRENT](../milestones/M1_LINUX_PORT/CURRENT.md) · [M2 CURRENT](../milestones/M2_TEST_SET/CURRENT.md) · [M3 IDEAS](../milestones/M3_PIPELINING/IDEAS.md) · [M4 IDEAS](../milestones/M4_OPTIMIZATION/IDEAS.md) · [M5 IDEAS](../milestones/M5_FEATURES/IDEAS.md)

## 0. Scope and Evidence Rules

이 문서는 CarrotMangaTranslator의 production staged workflow에서 erase/inpainting 경로를 source와 read-only local artifact(settings, library, run 기록, 로그)로 추적한 결과다. 구현, migration, benchmark, dependency 설치, model 다운로드와 실행은 하지 않았다. Carrot source, library, 기존 문서, renderer 관련 파일도 수정하지 않았다.

표기 규칙:

- **[FACT]** source 또는 local artifact에서 직접 확인했다.
- **[INFERENCE]** 확인된 사실에서 도출했지만 runtime으로 검증하지 않았다.
- **[UNKNOWN]** 이번 조사로 확인할 수 없었다.
- **[RECOMMENDATION — USER DECISION REQUIRED]** 제안이며 사용자 결정이 필요하다.

선행 문서:
- `INITIAL_MIGRATION_ANALYSIS.md` §3.5
- `OCR_RUNTIME_MIGRATION_ANALYSIS.md`
- `TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md`

사용자 관찰인 "page가 많아질수록 erase가 느려지는 것 같다"는 **hypothesis로만** 다룬다.

### 핵심 요약

1. **[FACT]** 실제 production erase는 native Rust/Candle runner(`mgt-flux-klein`)로 **FLUX.2 Klein 4B Q4_K_M GGUF**를 실행한다. runner는 JSON-lines로 통신하는 상주 child process다. 사용자의 두 data root 모두 `flux-klein` + `cuda-native`(sm120 runner) 설정이다.
2. **[FACT]** Flux engine은 30초 idle TTL pool에 캐시된다. local 로그상 run 하나당 worker 기동과 model load는 1회였다(2.5–10.7초). page마다 model이 reload된 흔적은 없다.
3. **[FACT]** 사용자의 full run 대부분은 `experimentalParallelAcceleration` 경로로 실행됐다. 이 경로에서 erase 결과는 **translation lane이 모두 끝날 때까지 메모리에 보관되었다가** 한꺼번에 저장된다.
4. **[FACT/local]** 기존 로그 3개 run에서 page별 `inpaintingMs`와 Flux crop 추론 시간은 page가 진행될수록 증가하지 않았다(§14). 기존 기록만으로는 **erase의 누적 성능 저하 증거가 없다**. 이것이 사용자 관찰을 반박하거나 확인하지는 않는다.
5. **[FACT]** page 수에 따라 증가하는 구조는 source에 있다(§7).
   - stage를 하나 저장할 때마다 `chapter.json` 전체를 읽고, durable backup을 만들고, fsync 후 rewrite한다. `chapter.json`의 약 86%가 `bubbleLayout` 데이터다.
   - 병렬 경로의 deferred erase 결과를 메모리에 보관한다.
   - 병렬 경로에서 Koharu layout ONNX session이 반복 재생성된다.
   - 이들이 실제 병목인지는 **[UNKNOWN]**이다.
6. **[FACT]** erase 대상 선정은 `translatedText`를 보지 않는다. 번역이 누락된 block 87개(translation 분석 §6)가 **모두 원문이 지워진 상태**로 저장되어 있다.

## 1. Production Erase / Inpainting Flow

### 1.1 Stage 순서

- **[FACT] 순차 경로**: stage 순서는 `detect → ocr → source-rules → translate → translation-rules → typography → format-rules → erase → layout → review`이고 stage-major로 실행한다. 따라서 erase는 typography 뒤, layout 앞이다. 모든 page의 앞 stage가 끝난 뒤 erase가 page 순서대로 실행된다(`application/pageWorkflowService.ts` `executeWorkflowChapter`).
- **[FACT] 병렬 경로**(`application/pageWorkflowExperimentalParallel.ts`):
  1. translate 이전 stage를 모두 실행한다.
  2. `executeParallelLanes`에서 **translation lane**(page 순차)과 **erase lane**(page 순차, `computeDeferredErasePages`)을 `Promise.allSettled`로 동시에 실행한다.
  3. 두 lane이 모두 끝나면 `commitDeferredErasePages`가 page마다 erase 결과를 저장한다.
  4. 나머지 stage(typography, layout, …; erase 제외)를 실행한다.
- **[FACT]** 병렬 경로에서는 erase가 translation이나 typography보다 **먼저** 입력을 읽는다. erase mask가 번역문을 쓰지 않으므로(§4) 이 순서가 가능하다.

### 1.2 호출 경로

1. `executeWorkflowStage` → `eraseWorkflowPage(context, page)` (`pageWorkflow/pageWorkflowImages.ts:29`)
   - 병렬 모드에서는 `prepareSourceErasePages`로 조정한 page 사본을 넘긴다(§4.3).
2. `workflowTargetBlocks(page, "erase", plan)` (`shared/pageWorkflowPolicy.ts:71`)
   - 대상은 `!inpaintExcluded`이면서 다음 중 하나에 해당하는 block이다: overwrite, inpainted image 없음, 이전 erase의 region key와 다름.
3. `acquireTimedWorkflowErasure` → `acquireWorkflowErasure`
   - `plan.erasureEngine === "codex"`면 `acquireCodexInpaintingEngine`
   - 아니면 `acquireInpaintingEngine({ model: settings.inpainting.model ?? "flux-klein", fluxBackend, koharuBackend, computeGpuIndex })` (`inpainting/inpaintingEnginePool.ts`)
   - timing bucket은 `preparing`이다.
4. flux-klein이고 `plan.bubbleLayout`이며 layout stage가 포함되면 `runBubbleLayoutMaskPrepass`(`jobs/bubbleLayoutJob.ts`)를 실행한다.
   - Koharu layout ONNX로 말풍선/텍스트 영역을 검출해 bubble constraint, 공유 group, typography segmentation을 만든다.
5. `inpaintPatternPage(prepass.page, { blockIds, inpaintingEngine, preserveExistingInpainting: true, … })` (`inpainting/patternPage.ts:56`)
   - timing bucket은 `inpainting`이다.
   1. `loadPatternWorkingBitmap`: `page.inpaintedImagePath ?? page.imagePath`를 Electron `nativeImage`로 decode해 RGBA bitmap을 만든다.
   2. `buildPatternPageMask` (`inpainting/patternPageMask.ts:37`): page mask, window, window mask, composite mask, validation binding(§5)
   3. `runPatternInpaintingEngine` → `engine.inpaint(bitmap, w, h, mask, windows, opts)` → `runFluxInpaint` (`inpainting/fluxEngineRunner.ts`)
      - window마다 crop을 만들고, crop 입력/마스크 PNG를 임시 run 디렉터리에 쓴다.
      - `FluxWorker.inpaint({input, mask, output, steps:4, strength:1, max_pixels, mask_padding})`
      - 결과 crop을 page bitmap에 합성한다.
   4. `resolvePatternPixelChanges`: block별 window mask 안에서 변경된 pixel 수로 erased/incomplete를 판정한다.
   5. `persistPatternResult`
      - `writePatternInpaintedImage`: `nativeImage.createFromBitmap` → PNG → `<chapter>/inpainted/pattern-<uuid>.png` (`wx`)
      - `persistActualInpaintMask`: 이전 mask와 union해 `<chapter>/mask/…` PNG로 저장
      - 결과 page에 `inpaintedImagePath`, `inpaintMaskPath`, `maskProvenance`, `updatedAt`을 설정
6. `eraseWorkflowPage`가 `erasedWorkflowRegions[blockId] = regionKey`를 기록한다.
   - `incompleteBlockIds`가 있으면 `PageWorkflowPartialFailure`(부분 결과 포함)를 던진다.
   - `finally`에서 `lease.release()`
7. **저장**
   - 순차 경로: `executeWorkflowPage` → `port.save(chapter, before, completeWorkflowReceipt(…))` → `savePageWorkflowResultUnlocked`(§7). **이 시점에 `inpaintedImagePath`가 page state에 반영된다** [FACT].
   - 병렬 경로: `commitDeferredErasePages` → `mergeEarlyEraseResult`가 현재 page에 `inpaintedImagePath`, `inpaintMaskPath`, `maskProvenance`, `erasedWorkflowRegions`만 덮어쓰고 저장한다 [FACT].

### 1.3 Production path와 기타 path

| Path | 구분 | 근거 |
|---|---|---|
| staged workflow erase → Flux Klein (`cuda-native`) | **production. local evidence와 일치** | [FACT] settings `inpainting.model="flux-klein"`, `fluxBackend="cuda-native"`. 로그의 `Flux worker`/crop event |
| Koharu engine (`lama-manga`, `aot-inpainting`) | optional | [FACT] `InpaintingModel` enum. Koharu pool |
| Codex erasure engine (`plan.erasureEngine="codex"`) | optional(원격) | [FACT] `acquireCodexInpaintingEngine`. local plan은 전부 `local` |
| 수동 inpainting selection, retouch, redaction, sound-effect review | manual/UI | [FACT] `inpaintingSelectionJob` 등. staged erase와 별개 |
| Legacy Diffusers Python CPU (`MGT_FLUX_LEGACY_DIFFUSERS_CPU`), `python-rocm` | diagnostic/legacy | [FACT] `fluxAssets/workerLaunch.ts` |

## 2. Erase vs Inpainting 역할 분리 (source 기준)

| 역할 | 위치 | 비고 |
|---|---|---|
| text region detection | detect stage의 Koharu layout(OCR 문서). erase 안에서는 bubble prepass의 Koharu layout 재검출 | [FACT] |
| erase target selection | `workflowTargetBlocks(…, "erase")` + `isPatternInpaintingBlockEligible`(bbox 유효, `inpaintExcluded` 아님) | [FACT] |
| mask generation | `buildPatternPageMask` → `mergeFluxRegionMask` / `mergePatternDetectionMask` | [FACT] §5 |
| mask expansion / padding | `resolvePatternRegionPaddingPx`, `resolvePatternWindowMarginPx`, `resolvePatternDilationRadius` (`inpainting/maskGeometry.ts:131-153`), `buildExclusivePaddedWindowMasks`, runner `mask_padding` | [FACT] |
| text removal = inpainting inference | Flux runner(crop 단위) | [FACT] |
| output composition | `fluxEngineRunner`가 crop 결과를 composite mask, feather, constraint로 page bitmap에 합성 | [FACT] |
| output validation | crop 단위로 변화 없음 탐지(`summarizeFluxCropChange`), block 단위로 window 내 `changedPixels > 0`(`resolvePatternPixelChanges`) | [FACT] |

**[FACT]** Carrot의 "erase" stage는 다음을 모두 포함한다.
- bubble prepass 재검출
- mask 생성
- 모델 추론
- 합성
- 검증
- page 전체 PNG와 mask PNG 저장
- `erasedWorkflowRegions` 기록

## 3. Runtime / Backend Inventory

| Backend | 사용 | Model / format | Runtime | GPU | Platform coupling | Process / lifecycle |
|---|---|---|---|---|---|---|
| **Flux Klein `cuda-native`** | **production(local evidence)** | FLUX.2 Klein 4B `flux-2-klein-4b-Q4_K_M.gguf`(2,604,311,104 B, HF `unsloth/FLUX.2-klein-4B-GGUF` rev pin) + VAE `FLUX.2-small-decoder` safetensors(249,521,340 B). sha256 sidecar | Rust `mgt-flux-klein`(candle 0.9.2 fork, koharu-ml git pin, `cudarc` dynamic loading). 배포는 SM arch별 `…-win-x64.zip`(GitHub release `flux-runners-cuda12.9-r3`) | CUDA 12.9 runtime DLL을 preload | Windows zip/exe, `cudart64_12.dll` 등 DLL 이름 하드코딩(`src/main.rs`) | 상주 child process(JSON-lines stdin/stdout). engine당 worker 1개(lazy). model은 process 시작 시 1회 load |
| Flux `cpu-native` | optional | 동일 model | `mgt-flux-klein-cpu.exe`(release `flux-runners-cpu-win-x64-r1`) | 없음 | Windows zip | 동일 |
| Flux `metal-native` | macOS | 동일 | runner metal feature | Metal | macOS | 동일 |
| Flux `zluda-native`, `cuda-sm75-experimental` | optional | 동일 | ZLUDA / SM75 FP16 | AMD / 구형 NVIDIA | Windows | 동일 |
| Flux `python-cpu` / `python-rocm` | legacy/diagnostic | Diffusers | Python managed runtime(`flux-klein-python-worker.py`) | ROCm/CPU | Windows embedded Python | child process |
| Koharu `lama-manga` / `aot-inpainting` | optional | `lama-manga.safetensors`, AOT `model.safetensors`(HF pin) | Rust `mgt-koharu-inpaint-runner`(candle) | CUDA/ZLUDA/Metal/CPU | Windows exe(repo `tools/`) | Koharu pool, 30초 idle TTL |
| Codex | optional | 원격 OpenAI image edit | Codex app-server | 원격 | 외부 protocol | run마다 작업 디렉터리 |
| Bubble prepass (Koharu layout ONNX) | production 보조(`bubbleLayout` plan) | Koharu layout ONNX | `onnxruntime-node` | Windows DirectML(`dml`) 또는 CPU | `windowsDirectMlAdapter` | module 수준 session cache(§6) |

**[FACT] Local evidence**
- 두 `settings.json` 모두 `inpainting.model="flux-klein"`, `fluxBackend="cuda-native"`다.
- 두 data root 모두 `models/inpainting/flux-klein-4b/`(위 두 파일)와 `mgt-flux-klein-runtime/{mgt-flux-cuda12.9, mgt-flux-klein-sm120}`을 갖고 있다.
- 로그의 GPU adapter는 `NVIDIA GeForce RTX 5070 Ti`(16GB)이고, Koharu layout은 `dml` provider였다.
- page-workflows 기록 20개 모두 `erasureEngine:"local"`, `bubbleLayout:true`다. erase를 포함한 full run 15개 중 9개가 `experimentalParallelAcceleration:true`다.

## 4. Input Contract

### REQUIRED [FACT]

- page `imagePath`(원본). 재실행이면 `inpaintedImagePath`가 작업 입력이 된다(`preserveExistingInpainting:true`).
- page 크기: decode한 bitmap 크기가 기준이다.
- 대상 block의 `id`, `bbox`(+`bboxSpace`), `inpaintExcluded`
- block `fontSizePx`: padding, margin, dilation 계산에 쓴다(`maskGeometry.ts`).
- model/runtime 선택(`inpainting.model`, `fluxBackend`, `computeGpuIndex`)

### OPTIONAL / QUALITY SUPPORT [FACT]

- bubble prepass 결과: `bubbleLayoutConstraintBlockIds`, `sharedInpaintGroupIdsByBlock`, `typographySegmentation`
- block `bubbleLayout`: prepass가 채운다.
- **병렬 모드에서만** `prepareSourceErasePage`(`pageWorkflow/sourceEraseScale.ts`)가 block `fontSizePx`를 source 글자 크기 추정값으로 바꾼 page 사본을 erase에 넘긴다.
  - 추정 우선순위: `measured`(raster-core-v1, confidence ≥ 0.5) → `page-peer` median → `ocr-geometry`(`workflowOrigin.recognitionSegments`의 cross-axis median, 없으면 `recognitionBboxes`) → `source-bbox`(bbox cross-axis ÷ `sourceText` 줄 수) → legacy
  - legacy `fontSizePx`의 0.75–1.3배로 clamp한다.
  - `prepareSourceErasePages`는 `stage==="erase" && plan.experimentalParallelAcceleration`일 때만 실행된다(`pageWorkflowRuntime.ts:121`).
- **[INFERENCE]** 따라서 OCR의 `recognitionSegments`/`recognitionBboxes`와 `sourceText` 줄 수는 mask geometry에 직접 쓰이지 않는다. 병렬 모드에서만 **padding/margin/dilation 크기(`fontSizePx`)**를 통해 간접적으로 영향을 준다.
  - 순차 모드에서는 typography 결과로 정해진 `fontSizePx`가 쓰인다.
  - Hayai `sourceText`는 개행이 공백으로 정규화되어 있으므로 `source-bbox` 경로의 줄 수는 1이 된다(OCR 문서 §9).

### 사용하지 않음 [FACT]

- `translatedText`: erase 대상 선정과 mask에 쓰이지 않는다(§10에서 결과를 다룸).

### CARROT-SPECIFIC

- `erasedWorkflowRegions`와 region key, workflow receipt
- `translationCompletion`(`shouldUseOriginalPatternImage`)
- `maskProvenance` 합성 규칙
- inpainting revision store, manual/retouch mask union
- `decodeFallback`(runtime image decode), appPaths 기반 model/runtime 경로

## 5. Mask Generation

**[FACT]** `buildPatternPageMask(mode)`의 mode 선택:
- Flux engine이거나 `typographySegmentation`이 있으면 `flux-region`
- Codex면 `codex-region`
- 그 외는 `glyph`

**Flux 경로의 block별 처리:**

1. `sourceRect = bboxToPixelRect(block.bbox)`
   - **기하 기준은 block bbox다.** `recognitionSegments`를 직접 쓰지 않는다.
2. `supportRect = expandRect(sourceRect, padding)`
   - padding = `clamp(max(2, round(max(w,h)·0.04), round(fontSizePx·0.18)), 2, 14)` px
3. bubble constraint가 있으면(prepass): bubble mask, 곧 layout region("green region")이 권위다.
   - 공유 group이면 `detectPatternTextWindowMask`의 검출 텍스트로 확장한다.
   - 주석에 따르면 OCR 사각형과 union하지 않는다. 연결된 말풍선의 이웃 침범을 막기 위해서다.
4. bubble constraint가 없으면: `mergePatternDetectionMask`(원본 pixel 기반 text mask, 필요시 Otsu) + `mergeLegacyFluxRegionMask(supportRect, …)`
5. `resolvePatternFluxCompositePlan`: model mask, composite mask, feather, hard constraint(bubble)
6. page mask에 병합하고 window를 확장한다.
   - window margin = `clamp(max(96, round(max(w,h)·0.32), round(fontSizePx·2.8)), 96, 240)` px
7. `coalesceSharedConstrainedWindows`: 공유 bubble window를 병합한다.

**[FACT] runner 전달 전 변환:**
- `buildExclusivePaddedWindowMasks`: window 간 배타, `maskPaddingPx`
- crop 계획: context px, 1,048,576 px(=1MP) 상한(로그 `maxPixels`), 필요시 tiling
- crop 입력/mask PNG 파일 → runner

**[FACT] 해상도와 경계:**
- mask는 원본 page 해상도의 `Uint8Array`(pixel당 1 byte)다.
- 모든 rect는 page 경계로 clamp한다(`expandRect`).
- 저장 mask는 이전 page mask와 union한 PNG다.

**[INFERENCE] 재사용 가능성:**
- PORTABLE: `maskGeometry.ts`, `patternTextMask.ts`, `patternPageMask.ts`, `rasterMasks.ts`, `pageMaskComposite.ts`, `patternFluxCompositePlan.ts`는 bitmap/rect 연산만 한다(Electron import 없음).
- 교체 필요: 입력 bitmap decode와 PNG encode(`nativeImage`).
- 그 밖에 Koharu layout(ONNX Runtime)에 의존하는 prepass가 있다.

## 6. Inpainting Runtime Lifecycle

### 6.1 Engine과 worker

- **[FACT]** `acquireFluxInpaintingEngine`(`inpainting/fluxEnginePool.ts`)은 module 수준 `LeasedIdleResourcePool`(`runtimeSupport/leasedIdleResource.ts`)에서 lease를 받는다.
  - cache key: backend, GPU index, CUDA uuid, compute capability, sm75 flag, runtime/model/runRoot 경로
  - 같은 key이고 healthy면 재사용한다.
  - key가 다르거나 unhealthy면 기존 engine을 dispose하고 새로 만든다.
- **[FACT]** pool은 `current` entry 1개와, 교체 중이면 retiring entry만 가진다.
  - dispose는 활성 lease가 반환될 때까지 기다린다.
  - lease가 0이 되면 `idleTtlMs = 30s` 타이머를 건다.
- **[FACT]** Flux와 Koharu 전환 시 반대편 pool을 dispose한다(`switch-to-flux`/`switch-to-koharu`).
- **[FACT]** engine은 첫 `inpaint` 호출 때 `FluxWorker`를 lazy 생성한다.
  - unhealthy면 폐기하고 다시 만든다.
  - `dispose` 시 worker를 종료한다.
- **[FACT]** runner(`tools/mgt-flux-klein-runner/src/main.rs`)는 시작 시 model과 prompt embedding을 1회 load한 뒤 stdin line 루프를 돈다.
- **[FACT]** `JsonLinesWorkerClient`(`runtimeSupport/jsonLinesWorkerClient.ts`)
  - 요청 timeout은 기본 30분이다.
  - timeout이나 exit가 나면 process를 종료하고 pending 요청을 reject한다.
  - stderr tail은 최대 80 chunk × 16k로 제한된다.
  - 응답 한 줄은 최대 1MB다.
- **[FACT]** crop 임시 디렉터리는 `runFluxInpaint`의 `finally`에서 삭제한다. 단, `MGT_KEEP_FLUX_DEBUG=1`이면 남긴다. 두 data root의 `tmp/runtime/flux-inpainting`은 비어 있었다.
- **[FACT]** cancellation: `signal`이 crop 루프, mask 생성, 요청까지 전달된다. JSON worker 요청은 abort 시 reject된다.

### 6.2 page와 chapter 단위 수명

- **[FACT]** `eraseWorkflowPage`는 page마다 lease를 acquire하고 release한다. page 사이 간격이 30초보다 짧으면 같은 engine과 worker를 재사용한다.
- **[FACT/local]** repo 로그에서 두 run(10409ed7: 41 page, 1336145f: 49 page) 모두 `Flux worker process starting`은 run당 1회였다.
  - `mgt-flux-klein: model loaded in` 3.38초와 2.47초
  - run 사이에 `Flux inpainting engine disposed {reason:"idle-ttl"}`가 1회 있다.
  - 설치 앱 run 97f9fa51도 worker 기동 1회, model load 10.66초였다.
- **[INFERENCE]** 관찰된 run에서는 page마다 model이 reload되지 않았다. 다음 경우에는 reload가 생길 수 있다.
  - page 간 간격이 30초를 넘을 때
  - 아래 release 호출이 erase 사이에 끼어들 때

### 6.3 GPU handoff timeline [FACT]

```
[순차 모드]
OCR stage(모든 page):   releaseGpuBeforeOcr → disposeCachedInpaintingEngines (GPU OCR일 때)
                        HayaiOCR child 실행/종료
translate stage(page별): waitForOcrIdle → releaseDetectorResources(Koharu layout session dispose)
                        → groupingEvidence release → (gemma만) disposeCachedInpaintingEngines
                        → endpoint 시작/종료(openai-api는 process 없음)
typography stage
erase stage(page별):     acquire Flux(첫 page에서 생성, 이후 재사용) → bubble prepass(Koharu layout
                        session 재생성 가능) → Flux crop 추론 → release(30s TTL)
layout stage:           bubble layout(Koharu layout)
(30초 idle 후 Flux worker 종료)

[병렬 모드, openai-api 전용]
translate 이전 stage 완료
├─ translation lane(page 순차): 매 page startEndpointSession → Koharu layout session dispose
└─ erase lane(page 순차):       Flux lease/추론, bubble prepass가 Koharu session을 다시 생성
두 lane 종료 → deferred erase commit(page 순차 저장) → typography → layout → review
```

- **[FACT]** `gpuMemoryCoordinator.releaseIdleResources = disposeCachedInpaintingEngines`(`translationRuntime.ts:20`)다.
  - translation 시작 전 inpainting 해제는 `modelProvider==="gemma"`일 때만 일어난다.
  - 병렬 모드는 `modelProvider==="openai-api"`일 때만 활성화된다(`pageWorkflowResourceHints.ts`).
  - **따라서 병렬 모드에서 translation이 Flux engine을 해제하는 경로는 없다.**
- **[FACT]** 반면 `releaseDetectorResources`(= `disposeCachedKoharuLayoutSessions`)는 provider와 무관하게 translation page마다 호출된다.
  - `KoharuLayout execution provider ready` 로그는 새 ONNX session을 만들 때만 찍힌다(`bubbleLayout/session.ts:308`).
  - 병렬 run 1336145f 구간에서 27회, run 10409ed7 구간에서 8회 찍혔다.
  - **[INFERENCE]** translation lane의 detector 해제와 erase lane의 prepass가 교차하면서 session이 반복 재생성된 것으로 보인다. 재생성 1회의 비용은 로그에 없다 **[UNKNOWN]**. 이 비용은 `inpaintingMs` bucket 밖이다(§14).
- **[FACT]** 병렬 모드에서는 Flux(CUDA)와 Koharu layout(DirectML)이 같은 GPU를 쓴다. erase lane 안에서는 순차 실행이다. translation은 원격 endpoint라 local GPU를 쓰지 않는다.

## 7. Long-run / Page-count Scaling Investigation

분류:
- **A** page 수에 따라 증가함이 source에서 확인됨
- **B** 일정/재사용이 확인됨
- **C** source만으로 판단 불가
- **D** 해당 없음

"A"는 **증가한다는 뜻이지 병목이라는 뜻이 아니다.**

| 항목 | 분류 | 근거 |
|---|---|---|
| Chapter state 저장 I/O | **A** | [FACT] stage 결과를 page마다 저장할 때 `savePageWorkflowResultUnlocked`(`libraryStore/pageWorkflowMutations.ts:19`)가 다음을 수행한다: `chapter.json` 전체 read + parse, page revision 비교, 전체 page map, transaction(journal 작성, 기존 파일 **durable backup 복사**(`libraryTransaction.ts` `copyDurableBackup`), temp write + `fsync` + rename(`libraryTransactionStorage.ts:56`)). executor도 page마다 `readChapter`한다. 저장 1회 비용은 chapter 크기(∝ page 수)에 비례하고, 저장 횟수는 page 수 × stage 수다. **[INFERENCE]** run 전체 I/O는 대략 O(N²) |
| Chapter 크기의 run 중 증가 | **A** | [FACT] `chapter.json`은 page당 약 83–161 KB다(49p 4.4MB, 77p 12.4MB). chapter 592a103c에서 `bubbleLayout`이 block 데이터의 약 1.95MB/2.27MB다. `bubbleLayout`은 erase prepass와 layout stage가 채우므로, 한 run 안에서 뒤로 갈수록 저장 비용이 커질 수 있다 **[INFERENCE]** |
| 병렬 deferred erase 결과 | **A** | [FACT] `computeDeferredErasePages`의 `results[]`가 page마다 `{before, after}` page 객체(bitmap 아님)를 translation lane 종료까지 보관한다 |
| `prepareSourceErasePages` | **A** | [FACT] 병렬 모드에서 lane 시작 **전에** 모든 대상 page의 source 글자 크기를 추정하고(`estimatePageSourceFontSizes`) page 사본 map을 보관한다. [INFERENCE] 사전 비용이 page 수에 선형이다 |
| decoded image / bitmap / mask 버퍼 | **B** | [FACT] `inpaintPatternPage` 함수 범위 지역 변수다. 결과는 파일 경로로만 남는다 |
| inpainting 출력 파일 | A(디스크, 선형) | [FACT] page당 PNG 1개 + mask 1개. 디스크 파일 수 = 참조 수(45/45, 34/34, 35/35, 75/75). orphan 없음 |
| Flux runtime/model cache | **B** | [FACT] pool entry 1개, worker 1개, run당 load 1회(local) |
| GPU/VRAM allocation(runner 내부) | **C** | Candle allocator 동작은 source로 판단할 수 없다 |
| ONNX(Koharu layout) session | **B/재생성** | [FACT] cache는 key당 1개다. 병렬 모드에서는 반복 재생성(§6.3). 누적은 아님 |
| child process | **B** | [FACT] Flux worker 1개. unhealthy면 교체 |
| promises/tasks | **B** | [FACT] 병렬 모드는 lane 2개뿐이다. lane 안은 순차(`for … await`)다. concurrency limit은 구조적으로 1/lane |
| worker pending map, stderr tail | **B** | [FACT] 요청 완료 시 제거. stderr는 상한 있음 |
| timing collector, `pageStartedAt` map | A(작음) | [FACT] page당 항목 1개 |
| progress/log | A | [FACT] `app.log` append(repo 약 700KB) |
| run artifact(`runs/…`) | A(선형) | [FACT] page별 OCR/translation 파일 |
| temp files | **B** | [FACT] crop run dir는 `finally`에서 삭제. `.transactions/*`는 두 root 모두 0 |
| story memory / glossary | A | translation 문서 §3.6. erase와 무관 |
| JSON serialize/deserialize 반복 | **A** | 위 저장 경로와 같다 |
| GC pressure / retained references | **C** | runtime 측정 필요 |
| model reload | **B(관찰 범위)** | local run당 1회. TTL 초과 시 재생성 가능 |

## 8. Experimental Translation / Erase Parallel Path

- **[FACT] 활성 조건** (`pageWorkflowResourceHints.ts`, `shared/pageWorkflowPolicy.ts:152`):
  - `settings.modelProvider==="openai-api"`
  - `settings.api.experimentalParallelAcceleration===true`
  - `plan.erasureEngine==="local"`
  - plan에 translate와 erase가 모두 있음
  - `format-rules`가 없음
  - 조건이 맞지 않으면 순차로 실행하고 설정은 유지된다.
- **[FACT] Overlap 단위**: chapter 하나 안에서 translation lane 전체와 erase lane 전체를 `Promise.allSettled([translationTask, eraseTask])`로 실행한다. 각 lane은 page 순차이고 동시성 한도는 lane마다 1이다.
- **[FACT] GPU**
  - translation은 원격이다. erase는 local Flux(CUDA)와 Koharu layout(DML)을 쓴다.
  - local Gemma provider에서는 이 경로가 켜지지 않는다.
  - 충돌이 확인된 것은 translation page마다 호출되는 Koharu layout session dispose뿐이다(§6.3).
- **[FACT] 순서와 저장**
  - erase lane은 lane 시작 시점의 chapter snapshot으로 page 순서대로 처리한다.
  - 저장은 두 lane이 모두 끝난 뒤 `commitDeferredErasePages`가 page 순서대로 수행한다. 이때 현재 page를 다시 읽어 inpaint 필드 4개만 병합한다.
  - erase가 먼저 끝나도 `inpaintedImagePath`는 **translation lane이 끝날 때까지 page state에 나타나지 않는다.**
  - 한쪽 lane이 reject되면 다른 lane 결과와 무관하게 예외를 던진다. 이미 쓴 inpainted PNG는 page state에 연결되지 않는다 [INFERENCE: 이후 cleanup 여부는 확인하지 않음].
- **[FACT] Pending work 누적**: deferred 결과 배열이 page 수만큼 커진다(§7). 대기 중인 GPU 작업이 쌓이는 queue는 없다.
- **[FACT/local] 성능**: 병렬 run 3개(repo 2, 설치 앱 1)의 기록에서 erase 추론이나 overhead가 page 진행에 따라 증가한 증거는 없다(§14). erase를 포함한 순차 모드 run의 timing 기록은 찾지 못했다. **이 경로가 장시간 성능 저하와 관련 있다는 증거는 없다.**
- **[INFERENCE] 체감과의 관계**: 병렬 모드에서 page의 erase 결과와 stage 완료 표시는 translation lane이 끝난 뒤 몰아서 나타난다. `page-timing.totalMs`는 page의 첫 stage 시작부터 마지막 stage 완료까지라서 거의 run 전체 시간과 같다(§14). 둘 다 "page가 늦게 끝난다"는 인상을 줄 수 있는 구조다. 체감 원인이라고 단정하지 않는다.

## 9. Output Contract

| 산출물 | 영속 여부 | 후속 사용 |
|---|---|---|
| `inpaintedImagePath` (`<chapter>/inpainted/pattern-<uuid>.png`, 원본과 같은 크기의 전체 page PNG) | page state 영속 | export/renderer 입력 raster(`resolveExportImageSource`가 inpainted를 우선 사용, renderer 문서) [FACT] |
| `inpaintMaskPath` (`<chapter>/mask/…png`, union mask), `maskProvenance` | page state 영속 | 재erase/retouch/manual revision [FACT] |
| `erasedWorkflowRegions[blockId]=regionKey` | page state 영속 | 다음 run의 erase 대상 판정, erase stage key [FACT] |
| workflow receipt(`pageWorkflow.steps.erase`) | page state 영속 | 재실행 skip [FACT] |
| page-timing(`preparingMs`, `inpaintingMs`, `inpaintingBackend`) | log | 진단 [FACT] |
| crop 입력/mask/출력 PNG | 임시(삭제) | 없음 [FACT] |
| Flux crop 로그(`elapsedMs`, `maxPixels`, `steps`) | log | 진단 [FACT] |
| confidence, 품질 score | 없음 | [FACT] 변경 pixel 존재 여부 외 품질 metric은 저장하지 않음 |
| model/runtime identity | log에만 | [FACT] page state에 model id/hash가 없음 |

- **[FACT]** layout stage의 stage key는 `inpaintedImagePath`를 포함한다.
- **[FACT]** 순차 모드에서 erase 결과 page 전체(prepass가 채운 `bubbleLayout` 등 포함)가 저장된다. 병렬 모드는 inpaint 필드 4개만 병합하므로 prepass의 `bubbleLayout` 변경은 저장되지 않는다. 이 경우 layout stage가 이후에 채운다 [INFERENCE: layout 대상 규칙 `!block.bubbleLayout` 기준].

## 10. Failure / Retry / Recovery

- **[FACT] 재시도**: erase stage에는 page retry loop가 없다. Flux crop 요청 실패, worker exit, timeout은 예외로 page를 실패시킨다(receipt 실패, 이후 stage는 그 page를 건너뜀).
- **[FACT] Worker 복구**: 다음 요청 때 unhealthy worker를 교체한다(`getWorker`). 같은 page 안에서 자동 재시도하지는 않는다.
- **[FACT] OOM/throttle**: Flux runtime error 문구를 정규화한다(`fluxWorkerErrors.ts`). 자동 CPU fallback은 없다. backend는 설정값 그대로 쓴다.
- **[FACT] 이미지 decode 실패/크기 0**: 예외를 던진다(`loadPatternWorkingBitmap`).
- **[FACT] 빈 crop mask**: `Flux 원문 지우기 마스크가 비어 있습니다` 예외
- **[FACT] Partial**
  - block window에 변경이 없으면 incomplete가 된다.
  - 일부 block만 incomplete면 결과 PNG를 저장한 page와 함께 `PageWorkflowPartialFailure`를 던진다. 부분 결과가 저장되고 stage는 실패로 기록된다.
  - 모든 block이 unchanged면 page를 바꾸지 않은 채 incomplete로 실패한다.
- **[FACT] Silent 가능 경로**
  1. mask 대상 block이 0개면(`maskContext.blocksErased===0`, 예: bbox 무효) `{page, blocksErased:0}`을 반환한다. 이 경우 stage는 **오류 없이 완료**된다.
  2. block 판정 기준이 "window 안에서 변경된 pixel > 0"이다. 한 pixel만 바뀌어도 erased로 판정된다. 글자 잔여 여부는 production에서 검사하지 않는다(`collectSourceGlyphEvidence:false`, source glyph 진단은 QA 전용).
  3. **번역이 누락된 block도 erase한다.** local library 확인 결과, completed page에서 `sourceText`는 있지만 `translatedText`가 빈 block 87개가 모두 `erasedWorkflowRegions`에 기록되어 있고 page에 `inpaintedImagePath`가 있다. OCR 실패로 원문이 빈 block 1개도 erase됐다.
     - **[INFERENCE]** 최종 출력에서 이 영역들은 원문 없이 빈 말풍선으로 보인다. renderer는 `translation-only` 빈 text를 그리지 않는다(renderer census).
- **[FACT] Cancellation**: signal abort 시 예외를 전파한다. lease는 `finally`에서 반환하고 crop 임시 디렉터리도 `finally`에서 삭제한다.
- **[FACT] 원본 fallback**: 실패 시 page의 `inpaintedImagePath`는 이전 값(없으면 없음)을 유지한다. export는 원본 raster를 쓴다(renderer 문서의 source 선택 규칙).

## 11. Platform Coupling

| Coupling | 위치 | 분류 |
|---|---|---|
| Electron `nativeImage` decode/encode | `inpainting/imageIO.ts`, `patternPage.ts` `writePatternInpaintedImage`, mask artifact | **REPLACE**(PNG/JPEG codec) |
| appPaths(`dataRoot/models/inpainting/…`, `tmp/runtime/flux-inpainting`) | `fluxEnginePool.ts` | **ADAPTABLE**(경로 주입) |
| Flux runner 배포(Windows zip, GitHub release asset, SM arch별) | `fluxAssets/constants.ts`, `workerLaunch.ts` | **REPLACE**(Linux build 또는 배포) |
| Runner CUDA DLL preload(`cudart64_12.dll` 등) | `tools/mgt-flux-klein-runner/src/main.rs` | **ADAPTABLE**. Linux에서는 `.so` 동적 로딩으로 바꾸거나 `--cuda-runtime-dir` 없이 실행 [UNKNOWN: 검증 필요] |
| Candle/koharu-ml(Rust) | runner | **PORTABLE**(Linux CUDA build 가능성은 [UNKNOWN]) |
| DirectML(Koharu layout prepass) | `bubbleLayout/session.ts`, `runtimeSupport/windowsDirectMlAdapter.ts` | **REPLACE**(Linux ORT CUDA/CPU EP) |
| ONNX Runtime(`onnxruntime-node`) | bubble prepass | **ADAPTABLE** |
| Python(Flux legacy/ROCm) | `fluxAssets/python*` | **DROP**(초기) |
| PowerShell, managed installer, ZLUDA, HIP SDK | `fluxAssets/*` | **REPLACE/DROP** |
| JSON-lines worker protocol | `jsonLinesWorkerClient.ts`, `fluxWorker.ts` | **PORTABLE** |
| mask geometry/composite | `maskGeometry.ts`, `patternPageMask.ts`, `patternTextMask.ts`, `rasterMasks.ts`, `pageMaskComposite.ts`, `fluxWindowPreparation.ts`, `fluxCropTiling.ts` | **PORTABLE** |
| Library transaction/receipt | `libraryStore/*` | **REPLACE**(Rover 저장 모델) |

## 12. Linux RoverCMT Boundary

[RECOMMENDATION — USER DECISION REQUIRED] 비교만 한다. architecture는 확정하지 않는다.

```
Rover Core ── Mask Builder(순수 TS: bbox/bubble/text mask, window, crop plan)
    │
    └─ Inpainting Adapter ── worker process(JSON-lines, 상주)
                               └─ mgt-flux-klein(Linux build) + FLUX.2 Klein 4B GGUF + VAE
    결과: crop PNG → Core가 합성·검증 → page PNG + mask PNG
```

| 판단 항목 | 근거와 선택지 |
|---|---|
| mask 생성을 Core에 둘 수 있는가 | 가능 [INFERENCE]. 순수 bitmap 연산이다. image codec만 교체하면 된다. bubble prepass는 ONNX 의존이 있어 선택 기능으로 분리할 수 있다 |
| 추론을 별도 worker로 분리할 수 있는가 | 이미 분리되어 있다 [FACT]. protocol은 `{type:"inpaint", input, mask, output, steps, strength, max_pixels, mask_padding}`, 파일 경로 기반 |
| Python worker가 필요한가 | production 경로에는 없다 [FACT]. Rust runner다 |
| ONNX Runtime 직접 호출 | Flux는 ONNX가 아니다. bubble prepass(Koharu layout)만 ORT다 [FACT] |
| Carrot runtime manager 전체가 필요한가 | 필요 없어 보인다 [INFERENCE]. 필요한 것은 runner 경로, model 경로, 해시 검증, launch뿐이다. 다운로드/ZLUDA/HIP/Python 계층은 Windows 배포용이다 |
| chapter 동안 model 상주 | 현재도 TTL pool로 사실상 run 동안 상주한다 [FACT/local]. Rover에서는 명시적인 chapter 단위 lease가 더 단순하다 |
| translation과 GPU 공유 | 현재 local evidence의 translation은 원격이다. local LLM을 같은 GPU에서 쓸 경우 Carrot은 translation 시작 전에 inpainting을 해제한다(gemma). Rover는 stage 단위 GPU owner를 명시해야 한다(예: OCR → 해제 → translation → 해제 → erase) |

후보 비교:

| 후보 | 장점 | 비용/위험 |
|---|---|---|
| A. Rust runner Linux build + 작은 TS adapter | 현재 production model/품질 유지. 상주 worker | Linux CUDA build, 배포, CUDA 버전 검증 필요 |
| B. Koharu LaMa runner | 가벼운 model | 품질과 동작이 현재 production과 다름. 비교 필요 |
| C. Python Diffusers Flux | Linux 생태계 표준 | Carrot에서 legacy/diagnostic 경로. 의존성 크고 성능 미검증 |

## 13. Existing Tests

`tests/`에서 이름 기준으로 관련 파일 85개를 찾았다. 대표 분류는 아래와 같다.

| 분류 | 예시(케이스 수) | 종류 |
|---|---|---|
| mask geometry | `patternPageMask.test.ts`(20), `patternTextMask`, `patternWindowPolicy`, `pageMaskComposite`, `fluxBubbleConstraint`, `bubbleMaskOwnership`, `koharuTypographyInpaintingMask` | pure/unit [FACT] |
| page 흐름 | `patternPage.test.ts`(10), `patternEngineRunner`, `inpaintingSelectionNoChange` | mock engine [FACT] |
| scale | `sourceEraseScale.test.ts`(2) | pure [FACT] |
| worker protocol | `fluxWorker.test.ts`(39), `jsonLinesWorkerClient`, `inpaintingWorkerProtocol` | mock. 일부는 `process.execPath` fake worker spawn [FACT] |
| engine | `fluxEngine.test.ts`(18, fake worker로 node spawn), `fluxEngineLaunch`, `fluxEnginePoolPreflight` | integration(가짜 runner) [FACT] |
| pool/lifecycle | `leasedIdleResource.test.ts`(5), `inpaintingEnginePool`(2), `inpaintingConcurrentOwnership` | unit [FACT] |
| 병렬 경로 | `pageWorkflowService.test.ts`("overlaps experimental erase compute with serial translation and rebases its commit" 등) | mock [FACT] |
| artifact/revision | `inpaintMaskArtifact`, `inpaintingArtifactCleanup`, `inpaintingRevision*` | unit/mock [FACT] |
| runtime 설치 | `fluxDownloads`, `fluxCudaRuntime*`, `fluxZluda*`, `koharuBackendMatrix` | mock [FACT] |

- **[FACT]** vitest에서 실제 Flux model 추론을 하는 테스트는 찾지 못했다.
  - 실제 추론은 수동 script(`scripts/run-flux-pattern-smoke.cjs`, `smoke-flux-pattern-chapter.cjs`(Electron), `smoke-flux-cpu-remote-runner.cjs`)뿐이다.
  - macOS CI의 `test:flux-metal`은 runner Rust test를 실행한다.
- **[INFERENCE] Rover contract test 후보**: mask geometry, pattern page mask, worker protocol, pool lease semantics
- **[INFERENCE] 새로 필요한 test**
  - Linux runner 실제 추론 smoke(§18)
  - 번역 누락 block의 erase 정책
  - blocksErased=0의 silent 완료 처리
  - chapter 저장 비용의 page 수 scaling 측정

## 14. Real Library / Run Evidence

**[FACT] Page-timing 로그** (`logs/app.log`, `previous.log`, 설치 앱 `logs/app.log`의 `page-timing` event). 정의(`pageWorkflowRuntime.ts` `recordWorkflowPageTiming`, `pageWorkflowImages.ts`):
- `inpaintingMs`: `inpaintPatternPage` 수행 시간. decode, mask, Flux 추론, 합성, PNG 저장 포함. **bubble prepass와 lease acquire는 제외**된다(acquire는 `preparingMs`).
- `totalMs`: page의 첫 stage 시작부터 마지막 stage 완료까지. stage-major/병렬 실행에서는 **run 경과 시간에 가깝다.** page별 처리 시간이 아니다.

| Run | pages | 병렬 | `inpaintingMs` median (min–max) | page index와의 Spearman | 비고 |
|---|---:|---|---|---:|---|
| 10409ed7 (repo) | 41 (erase 34) | 예 | 10,244 ms (1,095–20,697) | −0.14 | stages: translate…review |
| 1336145f (repo, chapter 592a103c) | 49 (erase 44) | 예 | 9,294 ms (1,478–22,520) | −0.39 | full stages |
| 97f9fa51 (설치 앱, 조사 시점 진행 중) | 기록 14 | 예 | 26,582 ms (13,737–64,440) | −0.46 | 기록이 일부뿐 |

**[FACT] Flux crop 로그** (`Flux inpaint crop completed.elapsedMs`, `steps=4`, `maxPixels=1,048,576`):

| 구간 | crop 수 | median | 순서 사분위 median | Spearman(순서, 시간) |
|---|---:|---:|---|---:|
| repo 두 run 합계 | 381 | 1,535 ms | 1,597 / 1,517 / 1,490 / 1,559 | 0.00 |
| 설치 앱 run | 620 | 2,006 ms | 2,241 / 1,711 / 2,146 / 2,036 |0.00 |

**[FACT] crop 사이 간격(1초 초과만)** — page 간 비추론 overhead의 근사값이다. crop 사이의 mask, decode, 저장, prepass 등을 포함하고 translation lane과 CPU를 공유한다.
- run 10409ed7: n=23, median 1.5초, 사분위 3.1/3.1/1.5/1.2, Spearman −0.77
- run 1336145f: n=37, median 2.8초, 사분위 3.1/2.9/2.7/1.3, Spearman −0.63
- 설치 앱 run: n=89, median 4.0초, 사분위 4.8/3.3/3.1/3.1, Spearman −0.31
- 추론이 차지한 비율(첫 crop부터 마지막 crop까지 구간 중 추론 시간): 82%, 76%, 76%

**해석 [INFERENCE]**
- 이 표본(page 34–75개, 병렬 모드, RTX 5070 Ti)에서는 erase 추론 시간과 page 간 overhead가 page 진행에 따라 증가하지 않았다. 후반 overhead는 오히려 감소했는데, translation lane이 먼저 끝나 CPU 경합이 줄었을 가능성이 있다(미검증).
- 표본이 적고 순차 모드, 100 page 이상, chapter 저장 시간 기록이 없어 **누적 저하 가설을 기각하지도 확인하지도 못한다.**
- chapter 저장 시간은 로그에 없다 **[UNKNOWN]**.

**[FACT] Library와 artifact**
- inpainted PNG: 592a103c 45개(64MB), 408fb247 34개(49MB), 46e79bc1 35개(50MB), b909e2ad 75개(173MB). 모두 page state 참조 수와 일치한다.
- `chapter.json`: 4.4MB/49p, 3.5MB/42p, 3.5MB/42p, 12.4MB/77p

## 15. Future 20-page vs 100-page Benchmark Design (미실행)

**조건**
- 같은 machine, driver, runtime, settings와 plan으로 실행한다.
- 순차 모드와 병렬 모드를 각각 측정한다.
- 입력: 같은 작품의 100 page 세트. 20-page run은 그 세트의 **앞 20 page**를 쓴다. 그래야 두 run의 page 1–20 content가 같다.
- 매 run 전 빈 data root에서 시작하거나, cache와 runtime 상태를 명시적으로 기록한다.
- 순서 효과를 보기 위해 100-page run을 **page 순서를 뒤집어** 한 번 더 실행하는 것을 권장한다.

**Page별 수집 (JSONL)**

| 필드 | 출처(기존 또는 추가 계측) |
|---|---|
| page index, page id, 입력 크기, block 수 | 기존 |
| detection / OCR / translation / typography / layout / render ms | 기존 page-timing + render는 추가 |
| erase: acquire ms, **prepass ms(신규)**, inpainting ms, crop 수, crop별 elapsed, mask pixel 수 | 기존 + 추가 |
| **chapter 저장 ms, chapter.json bytes(신규)** | 추가 계측 |
| stage 시작/종료 timestamp(벽시계) | 추가 |
| process RSS(main, Flux worker), 시스템 RAM | 추가 샘플러(예: 1초 주기) |
| VRAM(nvidia-smi 샘플), GPU util | 추가 |
| model load/reload event, worker spawn, Koharu session 생성 event | 기존 로그 |
| translation prompt/completion tokens, glossary 크기, story-memory 크기 | 기존 result.json + 파일 크기 |
| Node heap used, GC 시간(`--trace-gc` 또는 perf_hooks) | 추가 |

**분석**
- per-stage 시간을 page index에 대해 regression과 rank correlation으로 본다.
- 20-page run과 100-page run의 page 1–20을 같은 page끼리 비교한다.
- changepoint 검출로 threshold 동작을 찾는다.
- 저장 시간을 chapter bytes에 대해 본다.
- block 수와 mask pixel 수로 content 복잡도를 정규화한 residual 추세를 본다.

**구분 기준**

1. **정상 linear scaling**: page별 시간이 평탄하고 총시간이 N에 비례한다.
2. **Cumulative degradation**: 정규화한 residual이 index와 함께 단조 증가하고, 뒤집은 순서 run에서도 재현된다.
3. **Threshold**: changepoint 이후 step 증가가 있고, RAM/VRAM 또는 reload event와 동시에 나타난다.
4. **Content 변동**: residual 추세 없이 block 수나 mask 면적과 상관만 있다.
5. **Reload 비용**: worker spawn/model load/session 생성 event 직후 page의 시간이 튄다.
6. **RAM/VRAM/GC 연관**: 시간 증가가 RSS, heap, VRAM 증가와 같이 나타난다.

## 16. Unknowns

1. 순차 모드에서 page 수에 따른 erase 시간 추세(기존 기록은 병렬 run 위주)
2. chapter 저장(read, backup, fsync, write) 1회 시간과 page 수에 따른 증가폭
3. Koharu layout session 재생성 1회 비용과 누적 시간
4. Flux runner 내부 VRAM 사용과 allocator 단편화
5. memory leak, VRAM leak, GC 병목 여부(측정 없음)
6. 100 page 이상 run의 동작
7. Linux에서 `mgt-flux-klein` CUDA build 가능성과 CUDA DLL preload 대체 방식
8. 병렬 lane이 reject된 뒤 기록되지 않은 inpainted PNG의 정리 여부
9. 사용자 체감 속도 저하의 실제 원인. 기존 기록은 erase의 누적 저하를 보여주지 않는다

## 17. Recommended Migration Boundary

**[RECOMMENDATION — USER DECISION REQUIRED]**

### KEEP / REUSE

- mask geometry와 composite 로직(`maskGeometry`, `patternPageMask`, `patternTextMask`, `rasterMasks`, `pageMaskComposite`, `fluxWindowPreparation`, `fluxCropTiling`)
- JSON-lines worker protocol과 client의 timeout/exit 처리
- Flux runner source(Rust)와 model pin(GGUF + VAE, sha256)
- block별 변경 검증 개념

### ADAPT

- image decode/encode: `nativeImage`를 PNG/JPEG codec으로 교체
- runner launch: 경로와 env 주입, Linux CUDA 로딩
- engine lease: chapter 단위 명시 lease로 단순화
- bubble prepass: ORT CPU/CUDA EP, 선택 기능
- 저장: page 단위 artifact + 작은 manifest. chapter 전체 JSON을 매번 다시 쓰지 않는 구조 검토

### DROP INITIALLY

- ZLUDA, HIP, Python Diffusers, CPU runner, Metal, Codex erase, Koharu LaMa/AOT
- 수동 selection, retouch, revision store
- 병렬 lane 구조(Rover pipeline 설계에서 다시 결정)
- managed download/installer

### UNDECIDED

1. 번역이 누락된 block을 erase할지(빈 말풍선과 원문 잔존 사이의 trade-off)
2. blocksErased=0이나 약한 변경 판정에 품질 gate를 둘지
3. bubble prepass 유지 여부(품질 vs ONNX 의존과 시간)
4. GPU owner 정책(local LLM을 같은 GPU에서 쓸 경우)
5. mask 크기 추정에 `sourceEraseScale`을 기본 사용할지(현재는 병렬 모드에서만 적용)

## 18. Exact Next Step

**기존 run artifact 1 page를 입력으로 하는 Flux runner 단독 protocol smoke**를 제안한다(미실행).

1. chapter 592a103c의 page 1개에 대해 다음을 입력으로 쓴다.
   - 원본 raster
   - 저장된 `inpaintMaskPath`
   - 기존 `inpaintedImagePath`(비교용)
2. 격리된 Rover spike 디렉터리에서 기존 Windows `mgt-flux-klein` runner와 model 파일을 **읽기 전용 경로로** 사용한다.
3. mask bbox 기준 crop 1개를 만들어 JSON-lines `inpaint` 요청 1건을 보낸다.
4. 다음을 기록한다.
   - model load 시간
   - crop elapsed
   - 출력 PNG 크기와 변경 pixel 수
   - 기존 inpainted 결과와의 차이
   - shutdown 정상 여부

Carrot source, library, renderer 파일을 건드리지 않고 runner protocol과 입력 계약을 확인하는 가장 작은 작업이다. Linux build 검증은 그 다음 단계다.
