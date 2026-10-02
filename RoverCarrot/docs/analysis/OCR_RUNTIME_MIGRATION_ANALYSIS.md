# OCR Runtime Migration Analysis

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M1 Linux Port](../milestones/M1_LINUX_PORT/README.md) — HayaiOCR Linux runtime과 smoke 계획
- [M4 Optimization](../milestones/M4_OPTIMIZATION/README.md) — OCR + Translation 통합 실험의 하위 의존성

Tracking: [M1 CURRENT](../milestones/M1_LINUX_PORT/CURRENT.md) · [M4 IDEAS](../milestones/M4_OPTIMIZATION/IDEAS.md)

## 1. Purpose and Evidence Rules

이 문서는 Carrot의 현재 production OCR 경로를 source와 read-only local evidence로 추적하고, RoverCMT가 Linux에서 독립 실행할 OCR 경계를 정하기 위한 분석이다. RoverCMT OCR 구현, runtime 설치, 모델 다운로드, OCR 재실행은 하지 않았다. Carrot source, library, runtime, 기존 문서, Renderer Comparison 파일은 수정하지 않았다.

각 문장은 다음 중 하나로 표시한다.

- **[사실]** source 또는 local file에서 직접 확인했다.
- **[추론]** 확인된 사실에서 도출했지만 실행으로 검증하지 않았다.
- **[미확인]** 이번 조사로 확인할 수 없었다. §11에 모았다.

`INITIAL_MIGRATION_ANALYSIS.md` §3.3의 OCR 요약(ADAPTABLE CORE / REPLACE PACKAGING)을 source 수준에서 구체화한다. 해당 문서의 upstream Linux 지원 판단은 다시 조사하지 않았다.

## 2. Current Production OCR Flow

### 2.1 사용 중인 engine

- **[사실]** OCR pipeline은 `hayai`와 `paddle-legacy` 두 가지다(`src/shared/ocrEngines.ts`). 새 설정의 기본값은 `hayai`다(`src/main/settings/appSettingsDefaults.ts`의 `resolveOcrPipeline(env…, "hayai")`).
- **[사실]** 두 data root(repo root, 설치 앱 data root)의 `settings.json`은 모두 `ocr.pipeline="hayai"`, `device="gpu"`, `gpuBackend="cuda"`, `gpuCudaTag="cu129"`다.
- **[사실]** staged page workflow의 OCR stage는 HayaiOCR 고정 영역 방식만 지원한다. `collectPreparedHayaiHints(Batch)`는 pipeline이 `hayai`가 아니거나 region manifest가 없으면 예외를 던진다(`src/main/pipeline/translationRuntimePort.ts`).
- **[추론]** RoverCMT가 이식할 OCR은 HayaiOCR v2 고정 영역 판독이다. PaddleOCR은 legacy whole-page 경로의 대안이며 초기 migration 대상이 아니다.

### 2.2 호출 경로 (staged workflow)

stage 순서는 `detect → ocr → source-rules → translate → …`다(`INITIAL_MIGRATION_ANALYSIS.md` §2).

1. **Detect** — `detectWorkflowBlocks` (`src/main/pageWorkflow/pageWorkflowOcr.ts:24`) → `prepareHayaiRegions` (`src/main/textDetection/hayaiRegionPrepass.ts`) → `detectPageTextRegions` → Koharu layout ONNX. 결과 dialogue region마다 block을 만든다. 이때 `workflowOrigin.recognitionBboxes`와 `workflowOrigin.ocrSubdivision`을 함께 저장한다. subdivision은 detector mask에서 세로 다열 영역을 오른쪽→왼쪽 column group으로 나눈 계획이다(`hayaiOcrSubdivision.ts`).
2. **OCR 준비** — `prepareWorkflowOcrBatch` (`pageWorkflowRuntime.ts:196`)가 page마다 `prepareWorkflowOcrInput` (`pageWorkflowOcr.ts:104`)을 호출한다.
   - 대상 block의 현재 bbox로 `workflow-regions.json`(`schemaVersion: "hayai-dialogue-effect-separated-v1"`)을 run 디렉터리에 쓴다.
   - `inputKey`(stage key), `pageRevision`, `targetBlockIds`를 기록한다.
   - 저장된 `recognitionBboxes`/`ocrSubdivision`은 `geometryKey`가 현재 geometry와 같을 때만 재사용하고, bbox로 clip한다(`manifestForBlocks`, `:217`).
3. **Runtime 호출** — 준비된 모든 page를 한 batch로 `collectPreparedHayaiHintsBatch`에 넘긴다(`translationRuntimePort.ts`).
   - batch 안의 모든 항목은 같은 OCR runtime profile이어야 한다(`OCR_BATCH_PROFILE_KEYS`).
   - GPU OCR 전에는 idle inpainting cache와 detector runtime을 해제한다.
4. **Node runtime** — `runtime.simplePage.collectOcrBboxHintsBatch` (`src/main/runtime/simple-page-ocr-bbox-pipeline.cjs:220`) → batch pipeline → `ensureOcrRuntime` → child process 실행.
5. **Python** — `python -u hayai-bboxes.py --batch <json> --progress <jsonl> --device <cpu|gpu[:n]>`. 단일 page는 `--image --regions --output`을 쓴다(`simple-page-ocr-commands.cjs:59`, `:135`). page마다 `ocr-bbox-hints.json`을 쓴다.
6. **정규화** — Node가 출력 JSON을 `normalizeOcrBboxHintPayload`(`src/main/runtime/ocr/hint-normalization.cjs`)로 정규화한다.
7. **적용** — `applyWorkflowOcrResult` (`pageWorkflowOcr.ts:124`)가 page id, revision, stage key 일치를 확인한다. 그 뒤 hint `id = index+1`을 block에 binding해 `sourceText`와 `workflowOrigin`을 갱신한다.
8. **완료 조건** — `waitForOcrIdle`이 OCR child process 종료를 기다린 뒤에야 번역 모델이 시작된다(`simple-page-ocr-bbox-pipeline.cjs:231`, `startEndpointSession`).

### 2.3 실제 실행 증거

- **[사실]** chapter `592a103c…`의 run(`runs/1336145f…/pages/*/attempt-1/`) 45 pages에 `workflow-regions.json`, `hayai-regions.json`, `ocr-bbox-hints.json`이 있다. 출력은 204 items이고, 그중 `ocrHealth.status="failed"`는 1건이다. 출력의 `model`은 §3.2의 pin과 같다.
- **[사실]** repo `logs/`의 `page-timing` 기록에서 `ocrMs > 0`인 91건은 median 1,422 ms, min 2 ms, max 22,216 ms다.
- **[사실]** 이 값은 batch 전체 경과 시간을 page 수로 나눈 것이다(`pageWorkflowRuntime.ts`의 `elapsedPerPage`).
- **[추론]** 따라서 process 시작과 모델 load가 page에 분산돼 있다. 이 machine의 CUDA 환경 값이므로 Linux/CPU 성능 근거로 쓰지 않는다.

## 3. Backend / Runtime Inventory

### 3.1 HayaiOCR (production)

| 항목 | 값 | 근거 |
|---|---|---|
| Runner | `src/main/runtime/hayai-bboxes.py` (792 lines) | [사실] |
| Framework | PyTorch + Transformers `AutoModel(trust_remote_code=True)` + `PreTrainedTokenizerFast` + `AutoProcessor`, PIL | [사실] |
| Model | `JustANormalTinkerer/hayai-ocr-v2` @ `3608bb2075b9b39cb9f63e57251bca665de248cd` | [사실] |
| Processor | `google/siglip2-base-patch16-naflex` @ `b53b807d3a2d5e2b3911292f2d69e5341cdc064c` | [사실] |
| 무결성 | 모델 6개, processor 5개 파일의 byte size와 SHA-256을 load 전에 검증한다. `model.safetensors`는 622,502,784 bytes | [사실] |
| 다운로드 | `huggingface_hub.snapshot_download(repo, revision, allow_patterns)`. cache는 `HF_HOME`/`HF_HUB_CACHE` = `<ocr-runtime>/hf-cache` | [사실] |
| 추론 설정 | F32, greedy (`num_beams=1`), `max_new_tokens=128`, `max_num_patches=256`, batch 8. OOM이면 batch를 절반으로 나눠 재시도 | [사실] |
| Device | `cpu`, CUDA (`torch.version.cuda`), ROCm/HIP (`MANGA_TRANSLATOR_OCR_GPU_BACKEND=rocm-transformers`). GPU 요청인데 torch GPU가 없으면 실패한다(CPU fallback 없음) | [사실] |
| 실패 판정 | 생성 token 수 ≥ `max_new_tokens`(EOS 없음)면 exhausted. whole read였던 region만 subdivision으로 1회 재시도하고, 계속 실패하면 `ocrHealth.status="failed"` | [사실] |

### 3.2 Pinned Python stack (Windows lock 기준)

- **[사실]** `requirements-hayai-{cpu,cuda-cu126,cuda-cu130,rocm}-win.{in,lock}`의 핵심 pin은 다음과 같다.
  - `torch==2.9.1`, `torchvision==0.24.1`
  - `transformers==5.13.1`, `tokenizers==0.23.0rc0` (pre-release)
  - lock 기준 `huggingface-hub==1.29.0`, `safetensors==0.8.0`, `numpy==2.5.2`, `pillow==12.3.0`
  - lock은 `uv pip compile … --python-version 3.12 --python-platform windows --generate-hashes`로 만들었다.
- **[사실]** 설치 앱 data root의 runtime(`ocr-runtime/python-packages-hayai-cuda-cu130`)
  - dist-info가 위 버전과 일치한다(`torch-2.9.1+cu130`).
  - bootstrap은 managed embedded `python-3.12.7`이다.
- **[사실]** repo(dev) data root의 runtime은 `ocr-runtime/.venv-hayai-cuda-cu130`이다.
  - system Python 3.13.3으로 만든 venv다(`pyvenv.cfg`).
  - torch/transformers/tokenizers/huggingface_hub 버전은 같다.
  - **[추론]** 같은 package pin이 Python 3.12와 3.13 양쪽에서 설치되고 실행됐다.
- **[사실]** 사용자 설정 `gpuCudaTag="cu129"`는 Hayai에서 `resolveOcrTorchCudaTag`가 129 이상을 `cu130`으로 올려 variant `hayai-cuda-cu130`이 된다(`runtime-device.cjs:33`, `:161`). 두 data root의 설치 marker도 `hayai-cuda-cu130`이다.
- **[사실]** 두 data root 모두 `hf-cache/hub`에 `models--JustANormalTinkerer--hayai-ocr-v2`와 `models--google--siglip2-base-patch16-naflex`가 있다.

### 3.3 PaddleOCR (legacy, 초기 대상 아님)

- **[사실]** `paddleocr-bboxes.py` (2,723 lines)
- **[사실]** `paddlepaddle(-gpu)==3.3.1`, `paddleocr[doc-parser]==3.7.0`, cu126/cu129/ROCm-transformers variant
- **[사실]** 모델 cache 손상 시 자동 복구 경로가 있다(`runOcrCommandWithModelRepair`).
- **[추론]** staged workflow가 쓰지 않으므로 RoverCMT 초기 경계에서 제외할 수 있다. §9에서 판단 근거를 제시한다.

### 3.4 같은 runner의 다른 consumer

- **[사실]** font matching chapter pipeline(`src/main/pipeline/fontChapterC18.ts`)도 `hayai-bboxes.py`와 `hayai-pool.py`를 사용한다.
- **[사실]** 현재 두 data root 설정은 `autoFontMatchingDefault=false`다(`RENDERER_LIBRARY_FEATURE_CENSUS.md` §2.2).

## 4. Dependency Map

```
page raster (page.imagePath, 원본)         Koharu ONNX detection  ──(Electron nativeImage decode, DirectML/ORT)
        │                                         │
        │                     region manifest + recognitionBboxes/ocrSubdivision
        ▼                                         ▼
 prepareWorkflowOcrInput ── workflow-regions.json (hayai-dialogue-effect-separated-v1)
        │   (shared: pageRevision, workflowStageKey, keepBlocksResult, bboxNormalization)
        ▼
 TranslationRuntimePort.collectPreparedHayaiHintsBatch  ── GPU memory coordinator, detector release
        ▼
 runtimeModuleLoader → out/app-runtime/*.cjs  ── appPaths (Electron `app`)
        ▼
 simple-page-ocr-bbox-pipeline.cjs → batch/single pipeline → command runner
        │                         └─ ensureOcrRuntime (managed Python / venv / pip / lock / vcredist / HF cache env)
        ▼
 python -u hayai-bboxes.py  ── torch, transformers, tokenizers, huggingface_hub, PIL, HF Hub(network on first use)
        ▼
 ocr-bbox-hints.json (hayai-ocr-regions-v1)
        ▼
 hint-normalization.cjs (sanitize text, 80 cap, ocrHealth/segments copy)
        ▼
 applyWorkflowOcrResult → block.sourceText, workflowOrigin.{recognitionSegments, ocrFailure}
```

- **[사실]** Node child env는 `HF_HOME`, `HF_HUB_CACHE`, `HF_HUB_DISABLE_XET=1`, 다운로드 timeout, thread 수(`OMP_NUM_THREADS` 등)와 `MANGA_TRANSLATOR_OCR_DLL_DIRS`를 설정한다(`runtime-environment.cjs`).
- **[사실]** OCR timeout은 page당 5분이고 최소 60분이다(`simple-page-defaults.cjs:76-77`). `MANGA_TRANSLATOR_OCR_BBOX_TIMEOUT_MS`로 override할 수 있다.

## 5. Windows / Electron Coupling

| 위치 | Coupling | 근거 |
|---|---|---|
| `hayai-bboxes.py` `configure_windows_dll_search_path` | `os.add_dll_directory`. `hasattr` guard로 non-Windows에서는 no-op | [사실] |
| `hayai-bboxes.py` `runtime_path` | Windows long path(`\\?\`) 변환. POSIX는 그대로(`tests/python/test_hayai_paths.py`의 POSIX 보존 test) | [사실] |
| `ocr/managed-python.cjs` | python.org `python-<ver>-embed-amd64.zip` 다운로드. `process.platform !== "win32"`이면 "Install Python 3 or set MANGA_TRANSLATOR_OCR_PYTHON" 오류 | [사실] (`:108`) |
| `ocr/runtime-layout.cjs` `resolveBootstrapPython` | env override → bundled(macOS `python/bin/python3`, 그 외는 `python.exe` 경로) → packaged가 아니면 system `python3` | [사실] |
| `ocr/requirements-integrity.cjs` | hash lock(`--require-hashes`)은 `win32`에서만 적용. non-Windows는 lock 없이 pip package 목록을 그대로 설치 | [사실] (`:220`) |
| built-in lock 파일 | 전부 `*-win*.lock` (windows / py3.12) | [사실] |
| ROCm install batch | `repo.radeon.com/rocm/windows/…win_amd64.whl` URL을 하드코딩(`simple-page-defaults.cjs:29-46`) | [사실] |
| CPU torch | Windows만 `+cpu` tag와 CPU index URL을 붙인다(`install-plan.cjs:130`) | [사실] |
| `ocr/managed-vcredist.cjs` | Windows VC++ runtime | [사실] |
| Windows ROCm short path layout | MAX_PATH 대응 | [사실] |
| CPU worker 수 정책 | Hayai의 RAM/CPU 기반 병렬 worker 산정은 `os.platform()==="win32"`일 때만 적용 | [사실] (`bbox-batch-config.cjs:52`) |
| `runtimeModuleLoader.ts` → `appPaths.ts` | `import { app } from "electron"`으로 runtime/data 경로 결정 | [사실] |
| Detection image decode | `inpainting/imageIO.ts`의 Electron `nativeImage`. detector session은 `windowsDirectMlAdapter` 사용 | [사실] |
| OCR 자체 image decode | Python PIL (`Image.open` + `exif_transpose` + RGB) | [사실] |

- **[사실]** `src/main/runtime/ocr/*.cjs`, `simple-page-ocr*.cjs`, `pageWorkflowOcr.ts`, `translationRuntimePort.ts`에는 `electron` import가 없다.
- **[추론]** Electron coupling은 OCR 알고리즘이 아니라 경로 결정(appPaths)과 detection 단계의 image decode에 있다.

## 6. Portable / Reusable Components

모두 **[사실]**로 Electron import가 없고 Node/Python 표준 기능만 쓴다. 이식 가치 판단은 **[추론]**이다.

| Component | 위치 | 판단 |
|---|---|---|
| Hayai runner 핵심 | `hayai-bboxes.py`의 `process_page`, subdivision/retry, `recognize_batch(_resilient)`, `GenerationLengthRecorder`, `normalize_text`, manifest validation, 모델 pin과 SHA 검증 | PORTABLE. Windows DLL/long-path 보조 함수만 제외하거나 그대로 둬도 된다 |
| Region manifest 생성 | `manifestForBlocks`, `clipOcrSubdivision` (`pageWorkflowOcr.ts`) | PORTABLE (shared TS 의존: `keepBlocksResult`, `bboxNormalization`, `pageWorkflowPolicy`) |
| 결과 binding / revision guard | `applyWorkflowOcrResult` | PORTABLE. `PageWorkflowPartialFailure`, zod, `MangaPage` 형태에 의존 |
| Subdivision planning | `hayaiOcrSubdivision.ts` (175 lines) | PORTABLE. detector mask 입력 필요 |
| Hint 정규화 중 Hayai 관련 부분 | `copyOcrHealth`, `copyRecognitionSegments`, id 보존 | ADAPTABLE. 파일 전체(600 lines)는 Paddle/anime-text/axis-v4 호환 규칙을 함께 담고 있다 |
| OCR text sanitize | `prompts/ocr-text.cjs` `sanitizeOcrTextForPrompt` | ADAPTABLE (§8 참고) |
| Batch profile 일관성 검사, detector/GPU 해제 순서 | `translationRuntimePort.ts` | ADAPTABLE. 개념만 유지 |

## 7. Components Requiring Adapters / Replacement

| Component | 이유 | 제안 (**[추론]**) |
|---|---|---|
| `ensureOcrRuntime`와 installer/verification/managed Python/vcredist/ROCm layout (`src/main/runtime/ocr/` 약 8,300 lines 중 대부분) | Windows 설치 UX, embedded Python, 다양한 variant, 자동 복구 | REPLACE. Rover는 미리 준비된 Python 환경(venv 또는 container)을 전제하는 작은 launcher로 대체 |
| Linux용 dependency lock | 현재 lock이 전부 Windows용이고, non-Windows 설치는 hash 검증이 없다 | 새 Linux lock 생성 필요(CPU, CUDA 각각) |
| ROCm 설치 경로 | Windows wheel URL 하드코딩 | Linux ROCm이 필요하면 별도 조사. 초기 범위에서는 제외 권장 |
| `runtimeModuleLoader`/`appPaths` | Electron `app` | Rover 설정/CLI 인자로 경로 주입 |
| `TranslationOptions` 기반 option bag | OCR, 번역, UI progress 옵션이 한 객체에 섞여 있다 | Rover OCR 전용 작은 입력 타입 |
| Progress/i18n (`emitRuntimeProgress`, `tMain`) | UI 한국어 progress 문자열 | log 수준으로 축소 |
| Detection image decode (`nativeImage`) | OCR 입력 manifest의 선행 단계 | detection migration에서 처리. OCR 경계 밖 |
| Paddle legacy, external command(`MANGA_TRANSLATOR_OCR_BBOX_CMD`), inline/json-file hint 주입 | staged workflow가 사용하지 않음 | 초기 제외 |

## 8. OCR Input / Output Contract

### 8.1 Input

- **[사실]** raster는 `options.imagePath = page.imagePath`다(`src/main/pipeline/options.ts:38`). inpainted image가 아닌 원본 page raster다.
  - Python이 EXIF transpose 후 크기를 manifest `width/height`와 비교하고, 다르면 실패한다.
- **[사실]** region manifest(`hayai-dialogue-effect-separated-v1`):
  - `width`, `height`
  - `dialogueRegions[]`, `effectRegions[]`. staged workflow에서는 `effectRegions`가 항상 `[]`다.
  - `diagnostics`
- **[사실]** dialogue region field:
  - `id` (1부터 시작하는 정수. block 순서와 binding된다)
  - `regionId` (= block id), `kind="dialogue"`
  - `bbox` (pixel `[x1,y1,x2,y2]`)
  - `detectorConfidence`, `sourceDetectionIds`
  - 선택: `recognitionBboxes` (2–8개, bbox 안쪽)
  - 선택: `ocrSubdivision {mode: preemptive|retry, bboxes: 2–8}`
- **[사실]** batch manifest는 `{items:[{image, regions, output}]}`다. progress는 JSONL(`phase: start|done|error`)이다.
- **[사실]** OCR 대상은 `workflowTargetBlocks(page, "ocr", plan)`이 고른다. 대상이 없으면 OCR을 건너뛴다.

### 8.2 Output

- **[사실]** `ocr-bbox-hints.json`(`hayai-ocr-regions-v1`)의 필드는 다음과 같다.
  - `coordinateSpace:"pixels"`, `width`, `height`, `noTextDetected`, `textEvidenceCount`, `model{id, revision, processorId, processorRevision}`
  - `effectReviewRegions[]`
  - `items[]`: `id`, `label:"text"`, `x1..y2`, `score`, `ocrText`, `reviewFragmentId:"B%04d"`, `reviewStatus:"confirmed"`, `reviewOrder`, `geometryLocked:true`, `sourceDetectionIds`, 선택 `recognitionSegments[]`(segment별 text), 선택 `ocrHealth{status: subdivided|recovered|failed, strategy, reason, segments, regionId}`
- **[사실]** Python `normalize_text`:
  - NFKC
  - 개행과 tab을 공백으로 바꾼다
  - CJK 사이 공백을 제거하고 공백을 압축한다
- **[사실]** Node 정규화가 Python 출력에 추가로 적용하는 것:
  - `sanitizeOcrTextForPrompt`: control 문자 제거. source language가 ja이면 일본어/Latin noise와 ruby 중복 noise를 제거한다. glossary omission term을 제거하고 **160자로 자른다**(`prompts/ocr-text.cjs:94-113`).
  - hint가 80개를 넘으면 잘라낸다(`MAX_OCR_BBOX_HINTS=80`, `review-context-metadata.cjs:8`).
  - `B####` / `confirmed` metadata가 있으면 원래 `id`를 보존한다.
- **[사실]** `applyWorkflowOcrResult`의 규칙:
  - page/revision/stage key가 바뀌었으면 예외
  - 대상 block에 대응하는 hint가 없으면 예외("A dialogue block is missing its OCR result.")
  - `failed`이면 `sourceText=""`로 두고 `workflowOrigin.ocrFailure{reason:"generation-budget-exhausted", strategy, rawText}`를 남긴다. 그 뒤 page 단위 `PageWorkflowPartialFailure`로 중단하고 사용자 확인을 요구한다.
  - 그 외에는 `sourceText=ocrText`, `workflowOrigin.recognitionSegments`를 저장한다.
- **[추론]** 한 page에 dialogue region이 80개를 넘으면 81번째 이후 hint가 사라지고, `applyWorkflowOcrResult`는 "missing its OCR result"로 실패한다. 실행으로 확인하지는 않았다.
- **[추론]** 저장되는 `sourceText`는 raw OCR이 아니라 prompt용으로 가공되고 160자로 잘린 text다. `ocrFailure.rawText.slice(0, 20000)`도 이미 가공된 text에 적용되므로 실제 raw 출력을 보존하지 않는다.

## 9. Downstream Dependencies

| Consumer | 사용하는 OCR 산출물 | 근거 |
|---|---|---|
| Translate stage | `sourceText` → keep-block OCR hints. 빈 `sourceText`가 남아 있으면 번역 전에 중단 | [사실] `pageWorkflowTranslation.ts:44`, `:113` |
| Typography input | `sourceText`(jp), 현재 geometry와 일치할 때 `recognitionSegments` | [사실] `pageWorkflowTypographyInput.ts:56-77` |
| Erase scale | `recognitionSegments` cross-axis median, 없으면 `recognitionBboxes`, 없으면 bbox / `sourceText` 줄 수 | [사실] `sourceEraseScale.ts:122`, `:148` |
| Source-rules / translation-rules | `sourceText` | [추론] stage 이름과 순서 기준. 세부는 확인하지 않음 |
| Font matching | `recognitionSegments`(`fontMatchingCrossScriptProxyHints.ts`), OCR geometry direction | [사실] 파일 존재 / [추론] 초기 Rover 불필요 |
| Library 저장 | `workflowOrigin.ocrFailure`, `recognitionSegments`는 `pageWorkflowBlockMetadata.ts` schema | [사실] |

- **[추론]** Hayai는 개행을 공백으로 바꾸므로 erase scale의 "`sourceText` 줄 수" fallback은 Hayai 경로에서 항상 1줄로 계산된다. segment나 recognitionBboxes가 있으면 이 fallback은 쓰이지 않는다.
- **[추론]** Rover 최소 pipeline에서 OCR 출력 중 필수는 `sourceText`와 실패 표시다. `recognitionSegments`는 typography/erase 품질 보조 입력이므로, Rover가 그 stage를 이식할 때 같이 이식할지 결정한다.

## 10. Existing Test Coverage

| Test | 범위 | 실제 모델/torch 사용 |
|---|---|---|
| `tests/python/test_hayai_ocr_recovery.py` | `process_page`의 retry/subdivision/health 규칙, manifest 검증, 생성 길이 기록. `hayai-bboxes.py`를 AST로 발췌하고 image/torch/recognizer를 fake로 대체 | 없음 |
| `tests/python/test_hayai_paths.py` | Windows long path, POSIX path 보존, batch/single path | 없음 |
| `tests/ocrScript.test.ts` | 위 Python suite(+Paddle)를 vitest에서 `python`/`python3` subprocess로 실행 | 없음 |
| `tests/hayaiRuntimeCompatibility.test.ts` | DLL dir 등록, CUDA/ROCm torch 불일치 거부, CPU 경로, F32/OOM 정책 등. source text 검사 | 없음 |
| `tests/hayaiOcrSubdivision.test.ts` | subdivision planning | 없음 |
| `tests/hayaiOcrFailurePropagation.test.ts`, `tests/pageWorkflowAdapters.test.ts` | failed OCR이 `sourceText`/번역으로 흘러가지 않음, subdivision clip, recovered text 사용 | 없음 |
| `tests/translationRuntimePort.test.ts` | detector → Hayai → OCR 종료 대기 → Gemma 순서, batch profile 혼합 거부, GPU 해제 | 없음 (runtime mock) |
| `tests/ocrBboxPipelineBoundaries.test.ts` | hint 정규화, segment 보존, `ocrHealth` 보존, 80 cap | 없음 |
| `tests/ocrRuntimeBoundaries.test.ts`, `ocrBootstrapPython`, `ocrRuntimeVerification`, `ocrRuntimePackageIdentity` | 설치/variant/managed Python/검증 | 없음 |

- **[사실]** CI `check.yml`은 `windows-latest`와 `macos-15`에서만 `npm run check`를 실행한다. Linux job은 없다. macOS job의 torch 설치는 font chapter smoke용이다.
- **[사실]** `scripts/`에서 Hayai 실제 모델 추론을 CI로 검증하는 smoke는 찾지 못했다. `scripts/gemma-benchmark/ocr-cache.cjs`는 benchmark 도구다.
- **[추론]** 모델 추론 결과의 regression(OCR text 품질, 모델 pin 변경 영향)은 자동 test로 보호되지 않는다. Rover smoke에서 새 기준이 필요하다.

## 11. Unknowns

1. **Linux wheel 가용성**: `torch==2.9.1`의 Linux x86_64 CPU/cu126/cu130 wheel, `transformers==5.13.1`, `tokenizers==0.23.0rc0`(pre-release) Linux wheel이 이 조합으로 해석되는지 실제 설치로 확인하지 않았다.
2. **Python 버전**: lock은 3.12 기준이다. dev의 3.13.3 venv가 동작한 흔적은 있지만, Rover가 쓸 버전은 정하지 않았다.
3. **Offline 동작**: 모델이 cache에 있을 때 `snapshot_download(revision=…)`이 network 없이 성공하는지, 매 실행마다 HTTP 요청을 하는지 확인하지 않았다. 코드는 `HF_HUB_OFFLINE`을 설정하지 않는다.
4. **CPU 성능**: Linux CPU에서 page당 시간, RAM peak, thread 설정 효과를 모른다. Hayai의 CPU 병렬 worker 정책은 Windows 전용이라 Linux 동작도 정해져 있지 않다.
5. **결과 동일성**: 같은 crop에서 Windows CUDA 출력과 Linux CPU/CUDA 출력이 같은 text를 내는지(F32 greedy 경로 포함) 모른다.
6. **`trust_remote_code`**: `modeling_hayai.py`가 pinned SHA로 검증되지만 import하는 transformers 내부 API가 버전에 민감한지는 모른다.
7. **Linux ROCm**: Linux ROCm torch 경로는 Carrot에 없고 조사하지 않았다.
8. **Detection 연계**: OCR 입력 manifest는 Koharu detection과 mask 기반 subdivision에 의존한다. detection을 Rover로 옮길 때 같은 `recognitionBboxes`/`ocrSubdivision`이 재현되는지는 detection 분석 범위다.
9. **80 hint cap 실제 발생 여부**: library 최대는 page당 20 blocks(`RENDERER_LIBRARY_FEATURE_CENSUS.md`)라 현재 data에서는 발생하지 않았다. 대형 page에서 발생할지는 모른다.
10. **dev runtime 경로**: dev data root의 `python-packages-hayai-cuda-cu130` 폴더가 비어 있고 실제 package가 `.venv-hayai-cuda-cu130`에 있는 이유(venv 우선 정책)를 코드 수준까지 확인하지 않았다.

## 12. Linux Runtime Smoke Test Plan

목적은 exact 조합이 Linux에서 최소 1회 동작하는지 확인하는 것이다. 설계와 품질 평가는 범위 밖이다. 아래는 계획이며 아직 실행하지 않았다.

**S0. 환경 기록**
- distro, glibc, Python, pip/uv 버전, CPU/RAM, GPU/driver/CUDA runtime을 기록한다.

**S1. 설치 (CPU)**
1. 새 venv(Python 3.12)를 만든다.
2. `torch==2.9.1`, `torchvision==0.24.1` CPU wheel과 `transformers==5.13.1`, `tokenizers==0.23.0rc0`, `huggingface-hub==1.29.0`, `safetensors==0.8.0`, `pillow==12.3.0`, `numpy==2.5.2`를 설치한다.
3. 성공하면 `uv pip compile --python-platform linux --generate-hashes`로 Linux lock을 만든다.
4. 합격 기준: import 성공, `torch.__version__` 확인.

**S2. 모델 준비**
1. 빈 `HF_HOME`에서 `hayai-bboxes.py`와 같은 repo/revision/allow_patterns로 다운로드한다.
2. 11개 파일의 size/SHA-256이 일치해야 한다.
3. 이어서 `HF_HUB_OFFLINE=1`로 재실행해 offline load 가능 여부를 기록한다(Unknown 3).

**S3. 단일 page 실행 (CPU)**
1. Carrot `hayai-bboxes.py` 원본을 수정 없이 복사한다.
2. 기존 run artifact의 `workflow-regions.json` 1개와 대응 원본 page raster로 `--device cpu` 단일 page 모드를 실행한다.
3. 합격 기준:
   - exit 0
   - `hayai-ocr-regions-v1` schema
   - item 수가 manifest dialogue 수와 같음
   - `model` pin 일치

**S4. 결과 대조**
- S3의 `ocrText`를 같은 page의 Windows run `ocr-bbox-hints.json`과 region별로 비교한다. 동일/차이/차이율을 기록한다.
- 차이는 판정 기준이 아니라 기록 대상이다(Unknown 5).

**S5. 실패 경로**
- subdivision이 있는 region(`ocrSubdivision`)이 포함된 page를 1개 실행한다.
- 가능하면 `ocrHealth.failed`가 기록된 page(현 corpus의 failed 1건)도 실행해 health 출력을 비교한다.

**S6. Batch와 비용**
- 대표 page 5–10개를 `--batch --progress`로 한 번에 실행한다.
- cold start(모델 load), page당 시간, peak RSS를 기록한다.

**S7. CUDA (해당 GPU가 있을 때만)**
- cu126 또는 cu130 wheel로 S1–S6을 반복하고 `--device gpu`로 실행한다.
- CUDA 사용 로그(`[hayai-ocr] using CUDA …`)와 시간을 기록한다.

**S8. 정리**
- smoke 산출물은 Rover spike 디렉터리에만 둔다.
- Carrot library/runtime/cache는 읽기만 한다.

S3의 입력은 기존 run artifact를 **입력 fixture로만** 쓴다. 기대값의 권위는 final `chapter.json`의 `sourceText`가 아니라 같은 run의 `ocr-bbox-hints.json`이다. `sourceText`는 Node sanitize를 거친 값이기 때문이다(§8.2).

## 13. Recommended Migration Boundary

**[추론 — 권장안이며 사용자 결정 필요]**

Rover OCR 경계는 **"원본 raster + region manifest → Hayai 출력 JSON"을 수행하는 격리된 Python 실행 단위**와, 그 앞뒤의 작은 TS adapter로 둔다.

1. **Python worker (PORTABLE)**
   - `hayai-bboxes.py`의 manifest/output schema, 모델 pin, SHA 검증, subdivision/retry/health 규칙을 그대로 가져온다.
   - Windows DLL과 long path 보조 함수는 무해하므로 유지해도 되고, 제거해도 된다.
2. **Runtime 준비 (REPLACE)**
   - Carrot의 자동 설치기 대신 Linux lock으로 미리 만든 venv 또는 container를 전제한다.
   - 실행 경로는 설정/CLI 인자로 받는다.
   - GPU 요청 시 CPU fallback을 하지 않는 현재 정책은 유지를 권장한다.
3. **TS adapter (ADAPTABLE)**
   - manifest 생성(`manifestForBlocks`), 결과 binding과 revision guard(`applyWorkflowOcrResult`), `ocrHealth`/segment 보존만 이식한다.
   - Paddle, anime-text, axis-v4 호환 정규화와 80 cap은 가져오지 않는다.
4. **분리할 결정: text sanitize**
   - Carrot은 prompt용 sanitize(ja noise 제거, glossary omission, 160자 절단)를 OCR 결과 저장 단계에서 적용한다.
   - Rover에서는 raw OCR text를 저장하고 sanitize를 번역 입력 단계로 옮길지 결정해야 한다.
   - trade-off: 원문 보존과 디버깅이 쉬워지는 대신, 이후 stage가 Carrot과 다른 `sourceText`를 보게 된다.
5. **초기 범위에서 제외**
   - PaddleOCR legacy, ROCm, Windows managed Python/vcredist, external OCR command, inline/json-file hint 주입, UI progress/i18n, font chapter consumer
6. **Detection과의 경계**
   - OCR은 manifest를 입력으로만 받는다. Koharu detection과 subdivision planning은 detection migration에서 다룬다.
   - 이렇게 하면 OCR smoke를 detection 이식 전에 기존 run artifact만으로 수행할 수 있다.

## 14. Exact Next Step

§12의 **S0–S4**를 Linux x86_64 환경에서 CPU로 실행한다. 구체적으로는 다음과 같다.

1. Python 3.12 venv에 Hayai pin을 설치하고 Linux hash lock을 만든다.
2. 빈 HF cache에 pinned 모델을 받아 SHA를 검증한다.
3. 수정하지 않은 `hayai-bboxes.py`에 chapter `592a103c…` run의 page 1개(`workflow-regions.json` + 원본 raster)를 넣는다.
4. 출력 schema와 region별 `ocrText`를 Windows 결과와 대조한다.

이 결과가 나오기 전에는 Rover OCR code, lock 정책, CPU/GPU 기본값을 확정하지 않는다.
