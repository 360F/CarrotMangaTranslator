# Translation Managed Backend Source Trace

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M1-TRANS-001](../milestones/M1_LINUX_PORT/CURRENT.md#m1-trans-001--openai-compatible-translation-client와-prompt-contract-이식)
- [Step 4 — Translation](../milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#step-4--translation)
- [D32·D33](../milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#open-decision--validation-register)
- [2026-10-03 baseline 결정](../milestones/M1_LINUX_PORT/CURRENT.md#m1-baseline-decision-2026-10-03)

## Scope and Evidence Rules

- 기준: reference fork `fd461737`; 모든 source 경로와 줄 번호는 저장소 루트 `src/` 기준이다.
- 조사일: 2026-10-03.
- **[FACT]** source에서 직접 확인한 사실이다.
- **[INFERENCE]** source 사실에서 도출한 이식 영향이며 runtime으로 검증하지 않았다.

runtime 실행이나 managed 실사용 검증을 수행한 기록이 아니다. Linux runtime 검증 근거로 사용할 수 없다.

## Source evidence

**[FACT]** 아래 줄 번호는 루트 reference source 기준이다. 사용자 확정 대상은 **`modelProvider="gemma"` managed llama-server + Gemma 4 26B**다. `openai-api`/`openai-codex`도 source에 존재하지만 M1 대상의 재선택 사유가 아니다.

| 확인 항목 | Source / 관찰 |
|---|---|
| Provider dispatch | [runtimeModules.ts](../../../src/main/pipeline/runtimeModules.ts):60–70: `openai-codex`는 Codex endpoint, `openai-api`는 외부 API handle, 나머지 managed 경로는 `runtime.simplePage.startServer(options)`. 종료 dispatch :133–151은 managed `stopServer` 호출 |
| 모델 설정 해석 | [simple-page-model-config.cjs](../../../src/main/runtime/simple-page-model-config.cjs):56–60, 362–416: `modelSource=local`은 local GGUF/mmproj path, HF는 `modelRepo`/`modelFile`/`mmprojRepo`/`mmprojFile`(env override 포함). 26B가 현재 앱 전체 default라는 뜻은 아님: [modelPresets.ts](../../../src/shared/modelPresets.ts):65–68은 31B default |
| 26B catalog: economy26b | [modelPresets.ts](../../../src/shared/modelPresets.ts):30–37, 275–281: GGUF repo `mradermacher/gemma-4-26B-A4B-it-ultra-uncensored-heretic-i1-GGUF`, file `gemma-4-26B-A4B-it-ultra-uncensored-heretic.i1-IQ3_S.gguf`; mmproj repo `mradermacher/gemma-4-26B-A4B-it-ultra-uncensored-heretic-GGUF`, file `gemma-4-26B-A4B-it-ultra-uncensored-heretic.mmproj-Q8_0.gguf` |
| 26B catalog: qat26b | 같은 file :39–47, 282–288: repo `HauhauCS/Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-MTP`; GGUF `Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf`, mmproj `mmproj-Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-BF16.gguf`, MTP `mtp-gemma-4-26B-A4B-it.gguf`(같은 repo). 위 두 preset 중 하나를 이번 작업에서 선택하지 않음 |
| Legacy 설정 | [appSettingsStoredResolvers.ts](../../../src/main/settings/appSettingsStoredResolvers.ts):221–226 이하: 이전 unsloth 26B UD-Q3/Q4/Q6 설정 migration도 있음. 실사용 외부 서버의 Q6_K를 managed preset과 동일 구성으로 간주하지 않음 |
| 26B 식별 분기 | [runtime-profile.cjs](../../../src/main/runtime/model/runtime-profile.cjs):78–101은 HF repo/file 또는 local model/mmproj 경로를 regex로 검사해 `isGemma26BModel` 판정. :136–160은 `isGemma26BQatMtpModel` → `isSpeedGemmaModel`; 일반 26B도 `isMainlineGemmaModel`에 속함 |
| CUDA runtime 계열 | 같은 file :198–215: SPEED 분기를 먼저 검사하여 QAT/MTP 26B는 SPEED b10621, 일반 26B는 mainline b9553. BeeLlama는 나머지 분기(26B 표준 경로 아님). [model-runtime-compatibility.cjs](../../../src/main/runtime/model/model-runtime-compatibility.cjs):81–89, 119–136: mainline 모델의 BeeLlama launch/path는 배제. [simple-page-llama-runtimes.cjs](../../../src/main/runtime/simple-page-llama-runtimes.cjs):105–170과 [speed-llama-runtime-contracts.cjs](../../../src/main/runtime/model/speed-llama-runtime-contracts.cjs):6–70에 CUDA12.4/13.3 contracts |
| CUDA12/13 선택 | `shouldUseRtx50LlamaRuntime`, runtime-profile.cjs :34–61: options 또는 `MANGA_TRANSLATOR_LLAMA_RUNTIME_PROFILE`의 `rtx50/blackwell/cuda13/cuda13.1/cuda13.3`는 true; `default/cuda12/cuda12.4/legacy`는 false. 그 외 `ocrGpuCudaTag` 또는 `MANGA_TRANSLATOR_OCR_GPU_CUDA_TAG`가 `cu129/cu13/cu131/cu133`면 true. GPU 이름 자동 감지 함수로 해석하지 않음. :218–227은 metal/rocm/vulkan profile 분기도 보유 |
| App 설정의 profile 기본값 | [llamaRuntimeProfile.ts](../../../src/main/settings/llamaRuntimeProfile.ts):49–73: 하드웨어 default는 computeCapability ≥12 또는 capability 미상·rtxGeneration ≥50이면 rtx50. [hardwareDefaults.ts](../../../src/main/settings/hardwareDefaults.ts):168과 [appSettingsDefaults.ts](../../../src/main/settings/appSettingsDefaults.ts):120–124에서 그 default를 설정/env에 반영한다. 이는 앞 행의 runtime `shouldUseRtx50LlamaRuntime` 자체가 GPU를 탐지한다는 뜻과 구분한다 |
| 기본 26B runtime 설정 | [gemmaRuntimePresets.ts](../../../src/main/settings/gemmaRuntimePresets.ts):72–85: ctx=32768, batch/ubatch=1024, fitTargetMb=1024, q4_0 KV, mmproj/KV offload, gpuLayers=fit, useDraft=false. :106–127, 149–175: HF QAT26B + CUDA12/rtx50 profile은 MTP helper, draft-mtp, useDraft=true; q4_0 KV, no-mmap, threads=10/threadsBatch=12, draftMaxTokens=2. 비-CUDA profile에서는 draft 비활성; local source는 preset 그대로 반환. 설정/env override가 있어 모든 26B의 고정 launch 값은 아님 |
| Port/endpoint | [translationGemmaFieldOptions.ts](../../../src/main/settings/translationGemmaFieldOptions.ts):81–85: port는 `MANGA_TRANSLATOR_LLAMA_PORT`, 기본 18180. [llama-server-process.cjs](../../../src/main/runtime/transport/llama-server-process.cjs):80: base URL `http://127.0.0.1:${options.port}/v1`; [chat-completion.cjs](../../../src/main/runtime/transport/chat-completion.cjs):58–63: POST `${server.baseUrl}/chat/completions`, JSON body, abort signal. 내부 OpenAI-compatible client 이식은 유효 |
| Launch 인자 | [launch-arguments.cjs](../../../src/main/runtime/model/launch-arguments.cjs):28–46, 61–77: local/cache는 `-m`, HF는 `-hf/-hff`, mmproj path/URL. :81–117: 선택 시 MTP `--spec-type draft-mtp`, draft model, draft GPU auto, main과 같은 draft KV type. :133–181: host/port·sampling/reasoning. :190–238: fit/fit-target/fit-ctx, `-ngl`, GPU 선택, flash attention, ctx/batch/ubatch, `-np 1`, no-cache-prompt/no-warmup, mmproj offload. :317–353: KV/image token·extraArgs 옵션; extraArgs도 반영. [gemma4-official-chat-template.cjs](../../../src/main/runtime/model/gemma4-official-chat-template.cjs):169 이하: 26B 공식 pinned Jinja template 인자도 분기 |
| 준비·시작 | llama-server-process.cjs :79–119: 제한된 reuse 검사 → binary resolve/download → HF GGUF/mmproj assets 준비 → preflight → launch → readiness → MTP fit calibration. :127–150: reuseServer만으로 reuse되지 않고 allow-reuse env도 필요. :153–187: serverPath/env override와 catalog 다운로드 fallback. :206–230: child spawn(shell=false), stdout/stderr capture, abort listener |
| Model assets 다운로드 | [hf-model-download.cjs](../../../src/main/runtime/model/hf-model-download.cjs):49–69: cache 검사 → launch 재해석 → Windows path safety 검사 → pending task download. [hf-model-download-tasks.cjs](../../../src/main/runtime/model/hf-model-download-tasks.cjs):127–180: HF model/mmproj/draft 작업을 모으며 local/cache asset이면 생략, draft는 useDraft 조건. 선택 GGUF/mmproj/helper binding을 Step 4 evidence에 기록해야 함 |
| Readiness / 실패 | [llama-server-readiness.cjs](../../../src/main/runtime/transport/llama-server-readiness.cjs):6–44: `/v1/models` 응답 OK 검사(요청 timeout 2500ms), 1500ms polling, 기본 최대 1800000ms, abort/child exit 감지. llama-server-process.cjs :91–121, 270–279: readiness와 launch error race; 실패 시 child tree 종료 및 상세 error |
| 종료 | llama-server-process.cjs :403–416: child 없으면 no-op; Windows tree termination, 그 외 SIGTERM, 최대 5초 대기 후 강제 종료. [process-termination.cjs](../../../src/main/runtime/transport/process-termination.cjs):6–36: Windows `taskkill /PID /T /F`, 실패 fallback SIGKILL; non-Windows 강제 종료는 child SIGKILL |
| Page별 session open/close | [pageWorkflowTranslation.ts](../../../src/main/pageWorkflow/pageWorkflowTranslation.ts):8–25: 대상 block 없으면 session 없이 반환, 그 외 매 page `runWholePagePipeline({pages:[input]})`. [wholePagePipeline.ts](../../../src/main/wholePagePipeline.ts):436–477, 591–608: endpoint 준비/필요시 생성, finally dispose; [endpointSession.ts](../../../src/main/pipeline/endpointSession.ts):46–72: idempotent dispose, cleanup 등록, setup/abort 실패 정리. runtimeModules.ts :73–131: ModelEndpointSession dispose 한 번. managed 경로는 page마다 실제 server 시작/종료 가능하며 M1에서 chapter cache로 최적화하지 않음 |
| Provider별 body 보존 | [simple-page-request-builders.cjs](../../../src/main/runtime/simple-page-request-builders.cjs):249–331: provider별 body/sampling 분기가 있음. 외부 `openai-api` 저장 요청과 managed body가 모든 필드에서 같다고 가정하지 말고 managed branch도 source 기준으로 검증 |

세부 모델 quantization·QAT/MTP·runtime/profile 결정은 [D32](../milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#open-decision--validation-register)에서 추적한다. 일반/QAT catalog와 legacy/local 설정 가능성이 있다는 source 사실만 기록했다. remote 서버 설정이나 RTX 5090 보유 사실로 이를 임의 결정하지 않는다.

## Windows coupling

Linux 이식 결정은 [D33](../milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#open-decision--validation-register)에서 추적한다. **[INFERENCE]** 다음은 Linux 이식에서 해결할 문제이며 이번 작업은 Linux 후보를 선택하거나 구현하지 않았다.

- 위 catalog는 Windows CUDA zip, `llama-server.exe`/`llama-server-impl.dll`/CUDA DLL inventory를 요구한다. macOS arm64 contract도 있지만 Linux catalog 항목은 없다. [llama-runtime-download.cjs](../../../src/main/runtime/model/llama-runtime-download.cjs):133–144는 managed platform 허용을 Windows/macOS arm64로 제한한다. Linux 대응 binary/build pin·inventory·ABI/preflight·배포 방식은 미결정이다.
- Windows `taskkill /T /F`를 Linux process tree 종료로 그대로 이식할 수 없다. source의 non-Windows SIGTERM/SIGKILL 동작은 관찰 사실이며 Linux shutdown/abort/restart 검증을 통과한 대체 방안으로 확정한 것이 아니다.
- [gemma4-official-chat-template.cjs](../../../src/main/runtime/model/gemma4-official-chat-template.cjs):100–145는 Windows ASCII template cache 경로를 요구한다. [translationLlamaServerPath.ts](../../../src/main/settings/translationLlamaServerPath.ts):28–30, 119–125의 Windows runtime directory 선택과 custom path 처리도 적응 대상이다.
- [electron-builder.config.cjs](../../../electron-builder.config.cjs):45–52, 100 이하, 349: Carrot은 tools/resources staging 및 Windows/macOS packaging 구분을 갖고 llama.cpp source directory는 package files에서 제외한다. managed binary는 위 catalog/download contract가 권위이며 Linux 배포가 준비됐다는 증거가 아니다.

## Existing Rover code impact

**[FACT]** 현재 translation/erase는 no-op이며 managed 또는 병렬 backend 구현은 없다. **[INFERENCE]** 다음은 후속 Step에서 영향을 받을 수 있는 **경로 목록**이고 이번에 수정하지 않았다.

- `RoverCarrot/src/pipeline/run.ts`: stage-major 순차 실행(현재 baseline과 부합).
- `RoverCarrot/src/core/contracts.ts`: stage 순서, reads/writes/resources, pending memory persistence contract.
- `RoverCarrot/src/core/config.ts`, `RoverCarrot/src/cli/config-file.ts`: 현재 strict config에는 managed model/runtime/port 설정이 없으므로 Step 4에서 contract 확장 필요.
- `RoverCarrot/src/core/run.ts`, `RoverCarrot/src/adapters/smoke.ts`: stage composition/no-op 연결을 managed translation으로 바꿀 후속 위치.
- `RoverCarrot/src/adapters/library.ts`: page/memory 및 번역 artifact 저장 boundary 확장 영향.
- `RoverCarrot/tests/core.test.mjs`, `RoverCarrot/tests/smoke.test.mjs`, `RoverCarrot/tests/cli.test.mjs`, `RoverCarrot/tests/boundaries.mjs`: 후속 scope의 contract/runtime 검증 영향.
