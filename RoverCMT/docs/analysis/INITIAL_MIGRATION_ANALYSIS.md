# RoverCMT 초기 이식 가능성 분석

## 1. 목적과 결론

이 문서는 CarrotMangaTranslator의 자동 번역 pipeline을 분석하여,
RoverCMT에 필요한 핵심 기능을 더 작고 독립적인 구조로 분리하고
Linux에서도 실행 가능한 Core로 이식할 수 있는지 평가한 결과다.

조사 범위는 다음 두 단계로 진행했다.

1. CarrotMangaTranslator source에서 실제 자동 번역 pipeline과 dependency를 추적
2. 사용 중이거나 지원되는 주요 runtime/backend의 upstream Linux 지원 여부 확인

전체 editor architecture, 모든 state model, 모든 fallback/retry,
전체 UI와 세부 기능을 분석하는 것은 범위에 포함하지 않았다.

### 결론

**GUI와 Electron에 의존하지 않고 Linux에서 실행 가능한 독립적인 RoverCMT Core를 만드는 것은 현실적이다.**

Carrot의 production pipeline 전체를 그대로 옮기는 방식은 적절하지 않다.

다음과 같은 검증된 핵심 로직은 재사용 가치가 높다.

- workflow orchestration
- detection 후처리와 region geometry
- OCR input/result binding
- translation prompt/schema/parser/result mapping
- bbox, reading order, text wrapping과 layout
- inpainting mask 생성과 결과 검증

반면 다음 영역은 Carrot의 현재 infrastructure에서 분리하거나
Linux에 적합한 runtime/backend로 교체해야 한다.

- Windows 중심 runtime bootstrap과 asset packaging
- Electron `nativeImage` 기반 image I/O
- Electron `BrowserWindow` / Chromium 기반 final rendering
- Windows/macOS 중심 managed binary catalog
- DirectML / PowerShell 등 Windows-specific 지원 계층

추가 upstream 조사 결과,
주요 OCR, detection, translation, inpainting 및 supporting runtime 대부분에는
Linux에서 사용할 수 있는 공식 또는 실용적인 실행 경로가 존재한다.

따라서 현재 핵심 migration risk는
**Linux용 기술 자체의 부재가 아니다.**

현재 주요 risk는 다음과 같다.

- Carrot의 Windows/macOS 중심 packaging을 Core에서 분리하는 작업
- exact dependency pin 검증
- native ABI compatibility
- model/configuration compatibility
- 각 runtime을 RoverCMT의 작은 contract로 연결하는 integration
- Electron-free final renderer의 실제 시각 품질과 성능

아직 Linux에서 실제 RoverCMT pipeline을 실행한 것은 아니므로,
upstream 지원 확인과 RoverCMT integration 검증은 구분한다.


---

## 2. 확인한 Carrot 자동 번역 경로

현재 staged 자동 처리의 주요 실행 경로는 다음과 같다.

1. `src/renderer/src/hooks/useRunPageWorkflow.ts`
2. `src/renderer/src/api/pageWorkflowGateway.ts`
3. `src/main/ipc/pageWorkflowIpc.ts`
4. `src/main/jobs/pageWorkflowJob.ts`
5. `src/main/application/pageWorkflowService.ts`
6. `src/main/pageWorkflow/pageWorkflowRuntime.ts`

현재 stage 순서는 다음과 같다.

`detect → ocr → source-rules → translate → translation-rules → typography → format-rules → erase → layout → review`

RoverCMT 관점의 핵심 흐름으로 단순화하면 다음과 같다.

`Input → Detection → OCR → Translation → Erase → Typography/Layout → Render → Output`

`executePageWorkflow` 자체는 `PageWorkflowExecutionPort`를 통해
chapter read/acquire/save와 stage 실행을 주입받는다.

따라서 orchestration 자체는 Electron IPC에 본질적으로 종속되지 않는다.

반면 현재 default runtime 조립은
Carrot library, settings, job registry, app paths 및 runtime manager에 결합돼 있다.


---

## 3. Component별 이식성

### 3.1 Input / orchestration / persistence — ADAPTABLE

핵심 entry:

- `startPageWorkflowJob`
- `executePageWorkflow`
- `createPageWorkflowRuntime`

`executePageWorkflow`는 Electron을 직접 요구하지 않고
`PageWorkflowExecutionPort`를 통해 외부 기능을 주입받는다.

따라서 다음은 재사용 가치가 높다.

- stage ordering
- abort handling
- page-local failure isolation
- 작은 workflow orchestration 구조

반면 다음 Carrot infrastructure는 초기 RoverCMT Core에서 분리한다.

- Electron IPC
- library lock
- receipt/history
- job ownership
- 복잡한 resume semantics
- Carrot-specific persistence

RoverCMT에서는 작은 input/output manifest와
filesystem 기반 port를 사용하는 방향이 적절하다.


### 3.2 Detection — ADAPTABLE

주요 경로:

`detectWorkflowBlocks`
→ `prepareHayaiRegions`
→ `detectPageTextRegions`
→ `detectKoharuPageLayout`

현재 production detection은 Koharu layout ONNX model과
`onnxruntime-node`를 사용한다.

ONNX preprocessing/postprocessing,
region geometry와 OCR subdivision은 UI와 독립적이므로
RoverCMT로 분리할 가치가 높다.

현재 image loader가 Electron `nativeImage`에 의존하므로
이 부분은 플랫폼 중립 image codec으로 교체해야 한다.

ONNX Runtime은 Linux x86_64에서 CPU/CUDA 실행 경로가 확인됐다.

따라서 남은 검증은 Linux 지원 여부가 아니라
Carrot에서 사용하는 exact ORT version과 Koharu model/configuration의
실제 Rover 환경 동작 여부다.


### 3.3 OCR — ADAPTABLE CORE / REPLACE PACKAGING

주요 경로:

- `prepareWorkflowOcrInput`
- `applyWorkflowOcrResult`
- `src/main/runtime/hayai-bboxes.py`

재사용 가치가 높은 부분:

- fixed-region OCR contract
- region manifest
- block ↔ OCR result binding
- revision validation
- 실패한 OCR result 처리 규칙

현재 Carrot의 OCR runtime bootstrap은
Windows embedded Python, `python.exe`, CUDA/ROCm package 관리 등
Windows 중심 구조를 포함한다.

이 packaging/runtime manager는 RoverCMT로 그대로 옮기지 않는다.

HayaiOCR 자체는 PyTorch 기반이며 Linux 실행 경로가 존재하지만,
Carrot에서 사용하는 exact dependency/model combination은
실제 smoke test가 필요하다.

PaddleOCR/PaddlePaddle 역시 Linux CPU/CUDA 지원 경로가 확인됐으며,
Carrot이 사용하는 pinned version 조합은 별도 smoke test 대상으로 남긴다.


### 3.4 Translation — ADAPTABLE

주요 경로:

`translateWorkflowPage`
→ `runWholePagePipeline`
→ `TranslationRuntimePort.requestTranslation`

재사용 가치가 높은 부분:

- kept-block OCR contract
- prompt construction
- response schema
- lenient JSON parsing
- normalization
- block mapping/merge

Carrot은 다음 translation/runtime 계열을 포함하거나 지원한다.

- Gemma + llama.cpp / llama-server
- BeeLlama
- Lemonade ROCm
- OpenAI-compatible endpoint
- Ollama
- Codex app-server

llama.cpp, BeeLlama, Lemonade ROCm, Ollama 등에는
Linux 실행 경로가 확인됐다.

따라서 translation의 주요 문제는 Linux 지원 자체보다
Carrot의 managed binary catalog와 runtime manager를 분리하고
RoverCMT에서 사용할 endpoint/runtime contract를 정하는 것이다.

Carrot의 전체 checkpoint, retry, story memory,
font inference 등을 초기 RoverCMT에 모두 가져올 필요는 없다.


### 3.5 Erase / Inpainting — ADAPTABLE CORE / REPLACE RUNTIME INTEGRATION

주요 경로:

`eraseWorkflowPage`
→ `acquireInpaintingEngine`
→ selected inpainting backend
→ `inpaintPatternPage`

재사용 가치가 높은 부분:

- target block selection
- mask geometry
- block별 성공 판정
- page result combination

Carrot에서 확인된 주요 backend는 다음과 같다.

- Koharu
- LaMa
- AOT-GAN
- FLUX.2

Koharu/LaMa에는 Linux 실행 경로가 확인됐다.

AOT-GAN은 source build가 필요한 대상으로 분류한다.

FLUX.2 자체의 Linux/CUDA 경로는 확인됐지만,
Carrot의 custom GGUF/Candle runner에서 CPU/ROCm 경로는 아직 불명확하다.

초기 RoverCMT가 NVIDIA/CUDA 경로를 우선 사용할 경우
CPU/ROCm 불확실성 자체를 전체 migration blocker로 보지는 않는다.

현재 Electron `nativeImage` 기반 raster I/O는 교체 대상이다.


### 3.6 Typography / Layout — PORTABLE + ADAPTABLE

다음 shared logic은 Electron dependency가 적고
RoverCMT로 가져올 가치가 높다.

- `naturalTextLayout*`
- `textWrapping`
- bbox geometry
- transform
- reading/layout logic

반면 automatic font matching과 typography profile은
Hayai/C18, analysis assets, work profile 등
Carrot infrastructure와 더 강하게 결합돼 있다.

초기 RoverCMT에서는 필요에 따라 단순화할 수 있다.

중요한 별도 문제는
**layout 계산과 실제 glyph rendering은 서로 다르다는 점**이다.

현재 실제 font measurement와 rendering은
DOM/CSS/Chromium의 text stack에 의존한다.

따라서 shared layout logic이 portable하더라도
Electron-free renderer가 동일한 수준의 시각 품질을 제공하는지는
별도로 검증해야 한다.


### 3.7 Render / Export — REPLACE

주요 경로:

- `src/main/pageExport.ts`
- `createPageExportRenderSession`
- `renderPageWithTranslationBlocksForExport`
- `src/renderer/src/pageExport/browserEntry.tsx`

현재 Carrot은 숨겨진 Electron `BrowserWindow`를
`offscreen: true`로 실행하고,

- React `PageArtwork`
- CSS
- web fonts
- Chromium text/layout rendering

을 이용하여 최종 페이지를 렌더링한다.

큰 이미지는 FFmpeg tile stitch 경로도 사용한다.

Electron과 Chromium 자체는 Linux를 지원한다.

따라서 이것은 Linux 지원 문제가 아니라
**RoverCMT Core를 Electron에서 독립시키기 위한 architecture boundary 문제**다.

RoverCMT에서는 page composition data와 geometry를 재사용하되,
Electron-free raster backend를 검토한다.

다만 renderer 교체는 단순 구현 문제가 아니다.

다음 품질이 현재 Carrot과 비교해 실용적으로 유지되는지 확인해야 한다.

- CJK glyph shaping
- font fallback
- font measurement
- line wrapping
- horizontal/vertical text
- alignment
- outline/stroke
- rotation/transform
- clipping
- image composition

따라서 renderer는 실제 migration 전에
별도의 candidate analysis와 comparison spike를 수행한다.


---

## 4. Component 분류 요약

| Component | 판정 | 재사용 가치가 높은 부분 | 분리/교체 대상 |
|---|---|---|---|
| Workflow orchestration | ADAPTABLE | stage ordering, abort, page-local failure | IPC, library/job/state |
| Detection | ADAPTABLE | ONNX preprocess/postprocess, region geometry | Electron image decode, provider setup |
| OCR | ADAPTABLE / REPLACE | manifest, region/result mapping | Windows Python/bootstrap packaging |
| Translation | ADAPTABLE | prompt/schema/parser, block mapping, endpoint contract | managed runtime catalog |
| Erase | ADAPTABLE / REPLACE | mask/target/validation | raster I/O, runtime packaging |
| Basic layout | PORTABLE | wrapping/layout/geometry | DOM-dependent measurement |
| Auto font matching | OPTIONAL | 향후 일부 품질 로직 | profile/assets/runtime coupling |
| Render/export | REPLACE | composition data/geometry | Electron BrowserWindow/Chromium export |
| Editor/review/rules/history | OPTIONAL | 초기 Core에 필수 아님 | human-in-the-loop infrastructure |


---

## 5. Upstream Linux compatibility

조사 과정에서 Carrot이 사용하거나 지원하는 다음 backend/runtime을 확인했다.

- Koharu layout ONNX
- legacy RT-DETR-v2
- anime-text-yolo
- HayaiOCR v2
- PaddleOCR / PaddleX / PaddlePaddle
- Gemma + llama.cpp
- BeeLlama
- Lemonade ROCm
- OpenAI-compatible endpoint
- Ollama
- Codex app-server
- Koharu / LaMa / AOT-GAN
- FLUX.2
- ONNX Runtime
- Electron / Chromium
- FFmpeg
- pngjs / ag-psd
- CSS / Chromium font shaping

### Compatibility matrix

| Component | Carrot usage | Linux 상태 | Runtime | Rover에서 남은 검증 |
|---|---|---|---|---|
| Koharu layout + ONNX Runtime | production detection | VERIFIED_SUPPORTED | CPU/CUDA | exact ORT + model smoke |
| legacy RT-DETR-v2 | legacy/optional detection | SUPPORTED_BUT_INTEGRATION_UNVERIFIED | ORT | 초기 optional |
| anime-text-yolo | detection option | SUPPORTED_BUT_INTEGRATION_UNVERIFIED | Koharu runtime | pinned model/runner |
| HayaiOCR v2 | fixed-region OCR | SUPPORTED_BUT_INTEGRATION_UNVERIFIED | PyTorch CPU/CUDA/ROCm | exact stack smoke |
| PaddleOCR/PaddlePaddle | alternate/legacy OCR | VERIFIED_SUPPORTED | CPU/CUDA | pinned stack smoke |
| Gemma + llama.cpp | local translation | VERIFIED_SUPPORTED | CPU/CUDA/ROCm/Vulkan | GGUF/flags smoke |
| BeeLlama | local translation server | VERIFIED_SUPPORTED | CPU/CUDA/ROCm/Vulkan/SYCL | Carrot pin smoke |
| Lemonade ROCm | AMD translation runtime | VERIFIED_SUPPORTED | ROCm | target integration |
| OpenAI-compatible/Ollama | translation endpoint | VERIFIED_SUPPORTED | server dependent | endpoint/schema smoke |
| Codex app-server | translation provider | SUPPORTED_BUT_INTEGRATION_UNVERIFIED | external protocol | protocol/version integration |
| Koharu + LaMa | erase | VERIFIED_SUPPORTED | CPU/CUDA/Vulkan depending backend | pinned integration smoke |
| AOT-GAN | erase | BUILD_REQUIRED | PyTorch | build/integration smoke |
| FLUX.2 | quality erase | Linux/CUDA VERIFIED_SUPPORTED | CUDA; Carrot custom CPU/ROCm unclear | selected runtime smoke |
| Electron/Chromium | render/export | VERIFIED_SUPPORTED | CPU | reference renderer |
| pngjs/ag-psd | image/PSD | VERIFIED_SUPPORTED | JS/CPU | optional corpus test |
| FFmpeg | large image stitching | VERIFIED_SUPPORTED | CPU/GPU build dependent | discovery/version smoke |
| Electron-free font/render | future Rover renderer | UNDECIDED | candidate dependent | visual/performance comparison |


### 주요 upstream 자료

- ONNX Runtime Node support / source build
- PaddleOCR / PaddlePaddle Linux installation and deployment documentation
- PyTorch Linux installation / HayaiOCR model distribution
- Koharu repository and releases
- llama.cpp Linux/container documentation
- BeeLlama releases
- Lemonade ROCm releases
- Ollama Linux documentation
- LaMa
- AOT-GAN
- FLUX.2
- Electron Linux/offscreen rendering documentation
- FFmpeg distribution documentation

이 조사는 upstream 지원 여부를 확인한 것이며,
RoverCMT의 exact dependency/model/configuration 조합을
실제 Linux에서 실행한 결과는 아니다.


---

## 6. 재사용 우선 후보

RoverCMT 내부 코드로 복사·정리할 가치가 높은 후보는 다음과 같다.

1. `PageWorkflowExecutionPort` 기반 sequential orchestration의 작은 형태
2. `hayaiRegionGeometry.ts`, `hayaiOcrSubdivision.ts`의 region 처리
3. OCR manifest와 block/result binding
4. translation prompt/schema/parser/normalization/block merge
5. shared bbox/transform/reading/layout/wrapping
6. inpainting mask 생성과 block별 completion validation
7. renderer에 전달되는 page composition data/geometry contract

`wholePagePipeline.ts` 전체를 그대로 가져오는 것은 권장하지 않는다.

유용한 translation logic 외에도
checkpoint, context persistence, font matching, diagnostics,
Codex image editing 등 초기 RoverCMT에 불필요한 infrastructure가 함께 결합돼 있기 때문이다.


---

## 7. 초기 RoverCMT에서 제외 가능한 항목

초기 Core에서 다음 기능은 필수가 아니다.

- renderer editor와 manual review workflow
- source/translation/format conditional rules
- 복잡한 resume/history/checkpoint/retry
- sound-effect 별도 review workflow
- Codex image editing/typesetting
- automatic font matching과 chapter font continuity
- work typography profile
- bubble sculpt 및 고급 layout correction
- PSD export
- web import
- multi-GPU 자동 탐지
- DirectML/ZLUDA/Windows ROCm 자동 설치
- 모든 local backend를 관리하는 범용 asset installer

단,

- 원문 제거
- 읽을 수 있는 번역문 배치
- 최종 이미지 출력

은 최소 E2E 결과에 필요하다.


---

## 8. 현재 migration risk

### 8.1 Runtime availability

주요 upstream runtime 대부분에 Linux 실행 경로가 확인됐다.

따라서 이것은 더 이상 가장 큰 불확실성이 아니다.


### 8.2 Packaging / integration

현재 가장 큰 일반적인 migration risk다.

검증해야 할 항목:

- exact dependency pins
- native Node/Python ABI
- CUDA/runtime compatibility
- model version과 configuration
- model file layout
- command-line flags
- process lifecycle
- input/output contract

Carrot의 Windows/macOS용 installer와 runtime manager를
그대로 이식하는 대신 RoverCMT에 필요한 작은 실행 경계를 정의해야 한다.


### 8.3 Renderer parity

현재 중요한 독립 risk다.

Carrot의 최종 결과는 Chromium의 mature text/layout/render stack에 의존한다.

Electron-free renderer가 다음을 실제 만화에서 충분한 품질로 제공하는지는
아직 검증되지 않았다.

- CJK shaping
- vertical text
- wrapping
- font measurement
- font fallback
- outline
- transform
- final raster quality

이 문제는 문서 조사만으로 최종 판단하지 않는다.

실제 Carrot output을 reference로 사용하는
renderer comparison spike가 필요하다.


---

## 9. 남은 검증

### Runtime smoke tests

- Hayai exact dependency/model stack
- pinned Paddle stack
- ONNX Runtime + Koharu model
- Gemma GGUF + selected local server
- Koharu / LaMa / AOT integration
- selected FLUX.2 runtime
- 필요한 경우 FFmpeg/image codec integration

Smoke test의 목적은 upstream Linux 지원을 다시 확인하는 것이 아니다.

실제 Rover 환경에서
exact pin/config/native ABI/model 조합이 최소 한 번 정상 실행되는지 확인하는 것이다.


### Renderer validation

별도 단계로 다음을 수행한다.

1. Carrot renderer가 실제 요구하는 기능을 source에서 추출
2. Electron-free Linux/headless renderer 후보 조사
3. 기능적으로 부적합한 후보 제거
4. 가치가 높은 2~3개 후보 선정
5. 동일한 실제 Carrot page/layout data로 comparison spike
6. 현재 Carrot Chromium output을 reference로 사용
7. render time / cold start / memory 측정
8. 생성된 결과물을 직접 시각 비교

pixel-perfect equality는 목표가 아니다.

목표는 다음 질문에 답하는 것이다.

**Electron을 제거하더라도 실제 사용 시 Carrot보다 눈에 띄게 품질이 떨어지지 않는 최종 만화 이미지를 만들 수 있는가?**


### End-to-end validation

각 component가 독립적으로 검증된 뒤
대표 실제 페이지에 대해 다음 전체 흐름을 검증한다.

`Detection → OCR → Translation → Erase → Typography/Layout → Render → Output`

최종적으로 확인할 항목은 다음이다.

- 결과 품질
- pipeline integration
- failure behavior
- time-to-output


---

## 10. 현재 판단

Linux independent RoverCMT Core의 기술적 가능성은 충분히 확인됐다.

현재 단계에서 더 이상
“Linux에서 가능한가?”를 광범위하게 조사할 필요는 없다.

다음 우선순위는
최종 결과물 전체에 영향을 주는
**Electron-free renderer의 품질과 성능 가능성을 먼저 검증하는 것**이다.

Renderer 검증이 성공하면
그 결과를 바탕으로 실제 RoverCMT Core migration을 시작한다.

Renderer 후보가 실용적인 품질을 제공하지 못한다면
Electron 제거 전략 또는 다른 headless rendering 방식을 다시 검토한다.