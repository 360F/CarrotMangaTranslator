# M1 — CURRENT

[M1 README](README.md) · [Planning index](../README.md)

사용자가 M1에서 하기로 결정한 작업이다(2026-10-01 milestone 정의 기준). 각 item은 근거 analysis로 연결된다.
진행 상태는 `Progress`로 표시한다. RoverCMT production code는 아직 없으므로 모두 `not started`이며, renderer만 분석·spike가 진행됐다.

Item 목록:

| ID | Title | Progress |
|---|---|---|
| [M1-CORE-001](#m1-core-001--linux-core-pipeline-port) | Linux core pipeline port | not started |
| [M1-CONFIG-001](#m1-config-001--configsettings-파일-기반-설정) | Config/settings 파일 기반 설정 | not started |
| [M1-CONFIG-002](#m1-config-002--inputoutput-경로-config화) | Input/output 경로 config화 | not started |
| [M1-CLI-001](#m1-cli-001--bashcli-실행) | Bash/CLI 실행 | not started |
| [M1-OBS-001](#m1-obs-001--stage-진행상황과-소요시간-실시간-표시) | Stage 진행상황과 소요시간 실시간 표시 | not started |
| [M1-COMPAT-001](#m1-compat-001--windowselectron-결과프로젝트-호환) | Windows/Electron 결과·프로젝트 호환 | not started (호환 수준 결정 필요) |
| [M1-PERSIST-001](#m1-persist-001--persistence와-data-contract-parity) | Persistence와 data contract parity | not started |
| [M1-RUNTIME-001](#m1-runtime-001--linux-runtimemodel-의존성-교체적응) | Linux runtime/model 의존성 교체·적응 | not started |
| [M1-DETECT-001](#m1-detect-001--koharu-layout-onnx-linux-runtime) | Koharu layout ONNX Linux runtime | not started |
| [M1-OCR-001](#m1-ocr-001--hayaiocr-linux-runtime) | HayaiOCR Linux runtime | not started |
| [M1-TRANS-001](#m1-trans-001--openai-compatible-translation-client와-prompt-contract-이식) | OpenAI-compatible translation client와 prompt contract 이식 | not started |
| [M1-INPAINT-001](#m1-inpaint-001--flux-klein-candle-runner-linux-runtime) | FLUX Klein Candle runner Linux runtime | not started |
| [M1-RENDER-001](#m1-render-001--electron-free-linux-renderer-선택과-구현) | Electron-free Linux renderer 선택과 구현 | in progress (분석·spike 완료, backend 미결정) |

---

### M1-CORE-001 — Linux core pipeline port

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** Carrot staged workflow의 자동 pipeline(detect → ocr → translate → erase → typography/layout → render → output)을 RoverCMT 내부 독립 코드로 이식한다. 각 stage의 runtime 이식은 아래 개별 item이 맡고, 이 item은 orchestration과 stage 연결을 맡는다.
- **Why it matters:** M1의 본체다. 분석 결론은 "GUI와 Electron에 의존하지 않고 Linux에서 실행 가능한 독립적인 RoverCMT Core를 만드는 것은 현실적"이다.
- **Related analysis:**
  - [INITIAL_MIGRATION_ANALYSIS §1 목적과 결론](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#1-목적과-결론) — Linux Core 가능성 결론과 분리가 필요한 Carrot infrastructure 목록.
  - [INITIAL_MIGRATION_ANALYSIS §6 재사용 우선 후보](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#6-재사용-우선-후보) — 그대로 옮길 가치가 높은 orchestration·geometry·prompt·mask 로직과, `wholePagePipeline.ts` 통째 이식을 권장하지 않는 이유.
  - [CORE §1 End-to-End Production Data Flow](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#1-end-to-end-production-data-flow) — 실제 stage 순서와 stage 간 데이터.
  - [CORE §15 Minimal E2E Contract](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#15-minimal-e2e-contract) — stage 경계별 최소 전달 정보.
- **Related items:** 모든 M1 runtime item, M1-PERSIST-001.
- **Dependencies:** M1-RENDER-001의 backend 결정, 각 runtime smoke.
- **Decision / validation needed:** CORE §17의 열린 결정(raw OCR 보존, 번역 누락 처리, erase와 번역의 관계, partial failure 정책 등)을 M1에서 Carrot 동작 그대로 둘지 사용자 확인. 대표 실제 page로 최소 E2E 실행([ANALYSIS_PLAN §6](../../ANALYSIS_PLAN.md#6-end-to-end-검증)).
- **History:** 2026-10-01 생성(milestone 정의).

### M1-CONFIG-001 — Config/settings 파일 기반 설정

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** Carrot의 GUI settings와 `settings.json` 대신 RoverCMT config 파일로 pipeline 설정(model endpoint, runtime 경로, stage option, 언어 등)을 받는다. secret(API key 등)은 config 본문과 분리한다.
- **Why it matters:** CLI 실행과 재현성의 전제다. 현재 production 동작은 `settings.json`의 값(예: `modelProvider="openai-api"`, `ocr.pipeline="hayai"`, `cumulative:true`)에 따라 분기가 정해진다.
- **Related analysis:**
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §2 Actual Production Call Path](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#2-actual-production-call-path) — production 분기를 결정하는 실제 settings 값.
  - [TRANSLATION_PIPELINE_MIGRATION_ANALYSIS §2 Translation Backend / Runtime Inventory](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#2-translation-backend--runtime-inventory) — backend별 설정과 env 변수 목록.
  - [OCR §13 Recommended Migration Boundary](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#13-recommended-migration-boundary) — "실행 경로는 설정/CLI 인자로 받는다"는 runtime 준비 권장.
- **Related items:** M1-CONFIG-002, M1-CLI-001.
- **Dependencies:** 없음(설계 먼저 가능).
- **Decision / validation needed:** config 형식(JSON/TOML/YAML)과 Carrot `settings.json` 값 import 여부.
- **History:** 2026-10-01 생성.

### M1-CONFIG-002 — Input/output 경로 config화

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** 입력 파일/디렉터리, 출력 파일/디렉터리, model/runtime 경로를 config 또는 CLI 인자로 받는다.
- **Why it matters:** Carrot은 data root와 library 구조(`library/works/<workId>/chapters/<chapterId>/…`)를 앱이 관리한다. Linux CLI에서는 명시적 경로가 필요하다.
- **Related analysis:**
  - [CORE §9 Persistence and Artifact Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#9-persistence-and-artifact-model) — 현재 저장 파일과 artifact 위치.
  - [INPAINTING §12 Linux RoverCMT Boundary](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#12-linux-rovercmt-boundary) — runner·model 경로와 해시 검증만 필요하다는 근거.
- **Related items:** M1-CONFIG-001, M1-COMPAT-001(출력 위치가 Carrot project 구조와 호환되어야 하는지).
- **Dependencies:** M1-COMPAT-001의 호환 수준.
- **Decision / validation needed:** 출력 layout을 Carrot library 구조에 맞출지, 별도 output 디렉터리 + export로 둘지.
- **History:** 2026-10-01 생성.

### M1-CLI-001 — Bash/CLI 실행

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** GUI 없이 Linux bash에서 하나의 command로 pipeline 전체 또는 지정 stage를 실행한다.
- **Why it matters:** M1의 실행 형태 요구사항이다. 현재 Carrot은 Electron main process와 IPC를 통해 실행된다.
- **Related analysis:**
  - [INITIAL_MIGRATION_ANALYSIS §3.1 Input / orchestration / persistence](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#31-input--orchestration--persistence--adaptable) — orchestration이 ADAPTABLE로 분류된 근거.
  - [CORE §16 What NOT to Migrate](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기) — Electron IPC/UI state가 Core 범위 밖이라는 근거.
- **Related items:** M1-OBS-001.
- **Dependencies:** M1-CONFIG-001.
- **Decision / validation needed:** stage 단위 재실행(resume) 지원 범위.
- **History:** 2026-10-01 생성.

### M1-OBS-001 — Stage 진행상황과 소요시간 실시간 표시

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** 실행 중 page×stage 진행상황과 각 stage 소요시간을 실시간으로 출력하고, run 종료 후에도 남긴다.
- **Why it matters:** 사용자 요구사항이며 M2 benchmark의 측정 기반이다. 기존 Carrot 로그는 일부 시간을 다른 bucket에 합산한다(예: detection 시간이 `ocr` bucket에 합산).
- **Related analysis:**
  - [DETECTION §26 Exact Next Step](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#26-exact-next-step) — "detection 시간이 `ocr` bucket에 합산되는 등 계측이 부족하다".
  - [INPAINTING §15 Future 20-page vs 100-page Benchmark Design](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#15-future-20-page-vs-100-page-benchmark-design-미실행) — 추가로 필요한 계측 항목(prepass ms, crop 수, crop별 elapsed 등).
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §12 Token / Context Evidence](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#12-token--context-evidence) — translation에서 남겨야 할 지표(prompt/completion tokens, prompt_ms, predicted_ms, wall).
- **Related items:** [M2-BENCH-001](../M2_TEST_SET/CURRENT.md#m2-bench-001--stage별-benchmark와-실행시간-측정), [M2-BENCH-002](../M2_TEST_SET/CURRENT.md#m2-bench-002--full-e2e-benchmark와-실행시간-측정).
- **Dependencies:** M1-CLI-001.
- **Decision / validation needed:** 출력 형식(사람용 진행 표시 + 기계용 JSONL 등).
- **History:** 2026-10-01 생성.

### M1-COMPAT-001 — Windows/Electron 결과·프로젝트 호환

- **Status:** CURRENT
- **Progress:** not started (호환 수준 결정 필요)
- **Summary:** RoverCMT 최종 산출물이 기존 Windows/Electron Carrot 결과와 같은 프로젝트에서 공유/호환 가능한 수준이 되게 한다.
- **Why it matters:** 사용자 요구사항이다. 다만 [PROJECT_VISION §5](../../PROJECT_VISION.md#5-의도적인-trade-off)는 "기존 프로젝트와의 compatibility 포기"를 허용하므로 범위를 명확히 해야 한다([M1 README](README.md#알려진-문서-간-긴장-사용자-확인-필요)).
- **Related analysis:**
  - [CORE §2 Canonical Entity Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#2-canonical-entity-model) — Carrot의 work/chapter/page/block 구조와 파일 위치.
  - [CORE §4 Block Data Lifecycle](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#4-block-data-lifecycle) — block 필드별 생산자·소비자. 호환 대상 필드를 고를 때 쓴다.
  - [CORE §13 Proposed Minimal RoverCMT Core Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#13-proposed-minimal-rovercmt-core-model) — Carrot 구조와 다를 수 있는 Rover model 후보(확정 아님).
- **Related items:** M1-PERSIST-001, M1-CONFIG-002, [M4-PERSIST-001](../M4_OPTIMIZATION/IDEAS.md#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선).
- **Dependencies:** 없음. 이 결정이 M1-PERSIST-001, M1-CONFIG-002, M4-PERSIST-001의 범위를 정한다.
- **Decision / validation needed:** 호환 수준을 사용자와 확정한다. 예: (a) Carrot library의 `chapter.json`/`style-guide.json`/`story-memory.json`을 읽고 쓰기, (b) 최종 이미지와 번역 텍스트만 호환, (c) import/export 변환기. 검증은 같은 page를 Windows Carrot과 Linux Rover에서 처리해 비교하는 방식이 필요하다.
- **History:** 2026-10-01 생성. vision 문서와의 긴장 기록.

### M1-PERSIST-001 — Persistence와 data contract parity

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** stage 결과, block 데이터, translation memory(`style-guide.json`, `story-memory.json`), run artifact를 Carrot과 같은 의미로 저장·재사용한다.
- **Why it matters:** translation은 page N의 memory commit 이후 page N+1이 memory를 읽는 순차 의존이 있고, 같은 의미를 보존해야 현재 결과를 재현할 수 있다.
- **Related analysis:**
  - [CORE §9 Persistence and Artifact Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#9-persistence-and-artifact-model) — 무엇이 canonical이고 무엇이 debug artifact인지.
  - [CORE §14 Candidate Persistence Strategies](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#14-candidate-persistence-strategies) — chapter JSON / page JSON / SQLite 비교(winner 미정).
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §10.1 Workflow의 저장 의미](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#101-workflow의-저장-의미-fact) — memory를 page 저장과 같은 transaction으로 commit하는 의미.
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §16.4 반드시 보존해야 할 상태](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#164-반드시-보존해야-할-상태-fact) — memory 파일 2종과 merge 알고리즘.
- **Related items:** M1-COMPAT-001, [M4-PERSIST-001](../M4_OPTIMIZATION/IDEAS.md#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선).
- **Dependencies:** M1-COMPAT-001.
- **Decision / validation needed:** CORE §17 #5 persistence 전략. 요청별 work-context snapshot을 artifact로 남길지(TR-LLM §16.6).
- **History:** 2026-10-01 생성.

### M1-RUNTIME-001 — Linux runtime/model 의존성 교체·적응

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** Carrot의 Windows/Electron 전용 지원 계층(Electron `nativeImage` image I/O, Windows managed installer/binary catalog, DirectML/PowerShell, FFmpeg 경로 등)을 Linux에서 동작하는 대응물로 교체한다. stage별 runtime은 아래 개별 item이 맡고 이 item은 공통 계층과 exact pin 검증을 맡는다.
- **Why it matters:** 분석 결론상 핵심 risk는 "Linux용 기술 부재"가 아니라 packaging 분리, exact pin, ABI, model/config compatibility다.
- **Related analysis:**
  - [INITIAL_MIGRATION_ANALYSIS §5 Upstream Linux compatibility](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#5-upstream-linux-compatibility) — component별 upstream Linux 지원.
  - [INITIAL_MIGRATION_ANALYSIS §8 현재 migration risk](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#8-현재-migration-risk) — runtime availability와 packaging risk.
  - [ANALYSIS_PLAN §5 이후 Runtime Smoke Tests](../../ANALYSIS_PLAN.md#5-이후-runtime-smoke-tests) — runtime별 최소 smoke 기준.
- **Related items:** M1-DETECT-001, M1-OCR-001, M1-TRANS-001, M1-INPAINT-001, M1-RENDER-001.
- **Dependencies:** Linux 실행 환경(distro, GPU/driver).
- **Decision / validation needed:** 배포 형태(venv/container/system package)와 GPU 필수 여부.
- **History:** 2026-10-01 생성.

### M1-DETECT-001 — Koharu layout ONNX Linux runtime

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** Koharu layout ONNX detection과 Hayai region 후처리를 Linux에서 portable decoder + ONNX Runtime으로 재현한다.
- **Why it matters:** 이후 OCR·erase·layout의 block geometry 원천이다. 현재 Windows는 DirectML provider를 쓴다.
- **Related analysis:**
  - [DETECTION §20 Linux RoverCMT Boundary](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#20-linux-rovercmt-boundary) — Linux 경계 후보.
  - [DETECTION §22 Linux Runtime Smoke Test Plan](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#22-linux-runtime-smoke-test-plan-미실행) — 미실행 smoke 계획.
  - [DETECTION §24 Recommended Migration Boundary](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#24-recommended-migration-boundary) — KEEP/ADAPT/DROP 분류.
  - [DETECTION §25 Open Decisions for User](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#25-open-decisions-for-user) — raw mask 보존, ONNX 구현 언어 등.
- **Related items:** [M4-DETECT-001](../M4_OPTIMIZATION/IDEAS.md#m4-detect-001--같은-원본-raster의-koharu-raw-inference-재사용)(반복 추론 감소는 M4).
- **Dependencies:** M1-RUNTIME-001.
- **Decision / validation needed:** DETECTION §25의 결정. smoke S0–S3로 기존 `hayai-regions.json`과 region 수·bbox·순서 비교.
- **History:** 2026-10-01 생성.

### M1-OCR-001 — HayaiOCR Linux runtime

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** HayaiOCR Python worker를 Linux lock(venv/container)으로 실행하고, region manifest → OCR 결과 binding을 RoverCMT adapter로 이식한다.
- **Why it matters:** 현재 translation contract는 OCR text를 구조적으로 필요로 한다(빈 `sourceText` block은 번역 대상에서 빠지고, memory grounding도 OCR text를 쓴다).
- **Related analysis:**
  - [OCR §12 Linux Runtime Smoke Test Plan](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#12-linux-runtime-smoke-test-plan) — S0–S8 계획.
  - [OCR §13 Recommended Migration Boundary](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#13-recommended-migration-boundary) — Python worker + TS adapter 경계, sanitize 위치 결정.
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §11 OCR's Actual Role](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#11-ocrs-actual-role) — OCR이 번역에서 필수 입력인 근거.
- **Related items:** [M4-TRANS-001](../M4_OPTIMIZATION/IDEAS.md#m4-trans-001--hayai-ocr--vision-translation을-vision-llm-단독-ocrtranslation으로-통합)(OCR 제거 실험은 M4).
- **Dependencies:** M1-DETECT-001(manifest 입력), 또는 기존 run artifact로 단독 smoke.
- **Decision / validation needed:** raw OCR 보존과 sanitize 위치(CORE §17 #1).
- **History:** 2026-10-01 생성.

### M1-TRANS-001 — OpenAI-compatible translation client와 prompt contract 이식

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** 현재 prompt builder·parser·validation·block mapping과 작은 OpenAI-compatible HTTP client를 이식해 같은 vision 요청을 재현한다. memory(glossary/characters/story)와 page 순차 처리를 보존한다.
- **Why it matters:** 실제 운영은 이미 외부 OpenAI-compatible endpoint를 쓴다. 분석은 "M1 blocker: 새 blocker는 없다"고 결론냈다.
- **Related analysis:**
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §16 Minimal Linux Rover Translation Contract](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#16-minimal-linux-rover-translation-contract) — 보존해야 할 입력·요청 형식·출력 처리·상태.
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §18 Milestone 1 Blockers](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#18-milestone-1-blockers-if-any) — blocker 없음과 M1 위험(원격 server 설정 미상, work-context snapshot 부재).
  - [TRANSLATION_PIPELINE_MIGRATION_ANALYSIS §16 Recommended Migration Boundary](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#16-recommended-migration-boundary) — 그대로 가져갈 것/adapter/버릴 것.
  - [TRANSLATION_PIPELINE_MIGRATION_ANALYSIS §15 Runtime Smoke Test Plan](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#15-runtime-smoke-test-plan-미실행) — S4: 저장된 prompt로 같은 body 재전송.
- **Related items:** M1-PERSIST-001, M1-OCR-001. 속도 개선 아이디어는 M4-TRANS-*.
- **Dependencies:** M1-CONFIG-001.
- **Decision / validation needed:** 원격 server 설정(이미지 token 수 등) 기록 방식. 요청별 work-context snapshot 저장. TR §16 "아직 결정하지 않을 것" 목록.
- **History:** 2026-10-01 생성.

### M1-INPAINT-001 — FLUX Klein Candle runner Linux runtime

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** 현재 production erase인 Rust/Candle `mgt-flux-klein` runner를 Linux CUDA로 빌드·실행하고, mask 생성·합성·검증 로직을 이식한다.
- **Why it matters:** production 품질을 내는 erase 경로다. Windows zip/DLL에 결합되어 있다.
- **Related analysis:**
  - [INPAINTING §12 Linux RoverCMT Boundary](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#12-linux-rovercmt-boundary) — Rust runner Linux build + TS adapter 후보 비교.
  - [INPAINTING §17 Recommended Migration Boundary](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#17-recommended-migration-boundary) — KEEP/ADAPT/DROP/UNDECIDED.
  - [INPAINTING §18 Exact Next Step](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#18-exact-next-step) — 기존 page 1개로 runner 단독 protocol smoke.
- **Related items:** [M4-INPAINT-001](../M4_OPTIMIZATION/IDEAS.md#m4-inpaint-001--단색저변동-말풍선-fast-erase와-flux-fallback), [M4-INPAINT-002](../M4_OPTIMIZATION/IDEAS.md#m4-inpaint-002--flux-crop-수-감소).
- **Dependencies:** M1-RUNTIME-001, M1-DETECT-001(bubble prepass).
- **Decision / validation needed:** INPAINTING §17 UNDECIDED 항목(번역 누락 block erase 여부, bubble prepass 유지, GPU owner 정책 등).
- **History:** 2026-10-01 생성.

### M1-RENDER-001 — Electron-free Linux renderer 선택과 구현

- **Status:** CURRENT
- **Progress:** in progress — 분석·spike·contract-aligned v3 비교 완료, **renderer backend 미결정**
- **Summary:** Electron `BrowserWindow`/Chromium 기반 final render를 Linux에서 실행 가능한 backend로 교체한다. 현재 후보는 Skia Canvas(native)와 Playwright Chromium(browser fallback)이다. 기존 advanced rendering capability를 성급하게 삭제하지 않는다.
- **Why it matters:** renderer는 Electron 의존이 가장 큰 영역이고, production migration의 최대 미결정이었다.
- **Current evidence (원문 인용):**
  - v3 contract-aligned 재비교 완료. Skia Canvas 8/8, Playwright Chromium 8/8 성공.
  - Playwright 출력은 8개 fixture 모두 Electron reference-v3와 byte/pixel identical(선택 기준이 아니라 contract 재현 증거).
  - `_0411` 첫 block: Electron reference-v3, Skia, Playwright 모두 94px, 같은 8줄, overflow 없음.
  - 남은 Skia 차이는 source-match block(특히 `_047`)의 1–2px 크기와 줄바꿈, `_012`의 4px 차이에 집중.
  - 성능(1회 관측): Skia eight-page total 4223.59 ms, Playwright 6628.41 ms.
- **User review (2026-10-01, 사용자 보고):** 사용자가 v3 visual comparison HTML을 직접 확인했고 전체적으로 정상이라고 판단했다. 이 판단은 analysis 문서에는 아직 "Human visual review pending"으로 남아 있으며, **renderer winner는 결정하지 않았다.**
- **Related analysis:**
  - [RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md) — **최신 근거.** [§11 Fixture results](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#11-fixture-results), [§12 `_0411` before and after](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#12-_0411-before-and-after), [§13 Performance](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#13-performance), [§17 Unresolved questions](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#17-unresolved-questions).
  - [RENDERER_COMPARISON_SPIKE §9 Decision inputs still needed](../../analysis/RENDERER_COMPARISON_SPIKE.md#9-decision-inputs-still-needed) — winner 결정 전 남은 판단 항목(v2 기준이지만 질문은 유효).
  - [RENDERER_CANDIDATE_ANALYSIS §3 Actual Renderer Requirements](../../analysis/RENDERER_CANDIDATE_ANALYSIS.md#3-actual-renderer-requirements) — Carrot renderer가 실제로 쓰는 기능 목록.
  - [RENDERER_FONT_RESOLUTION §8 Portability / Distribution Considerations](../../analysis/RENDERER_FONT_RESOLUTION.md#8-portability--distribution-considerations)와 [RENDERER_PORTABLE_FONT_REFERENCE §4 License / Redistribution](../../analysis/RENDERER_PORTABLE_FONT_REFERENCE.md#4-license--redistribution) — Linux에서 같은 결과를 내려면 font를 pin하고 배포해야 한다는 근거와 선택된 portable font의 라이선스.
  - [CORE §0.2 Renderer decision state](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#02-renderer-decision-state) 와 [CORE §16 What NOT to Migrate](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기) — advanced renderer field는 현재 미사용이지만 schema를 optional로 남기라는 권장.
  - Review artifact(로컬, git 미추적): `RoverCMT/spikes/renderer-comparison/outputs/comparison-2026-10-01-v3-contract-aligned/visual-comparison/index.html`. Spike 설명: [spikes/renderer-comparison/README.md](../../../spikes/renderer-comparison/README.md).
- **Related items:** [M4-RENDER-001](../M4_OPTIMIZATION/IDEAS.md#m4-render-001--선택된-linux-renderer-backend의-성능-최적화)(선택 후 성능 최적화).
- **Dependencies:** 사용자 renderer 방향 결정.
- **Decision / validation needed:** (1) renderer backend 결정(Skia native / Playwright browser / 둘 다 유지) — 사용자. (2) 선택 backend의 Linux smoke와 memory 측정(v3 §17 #5–#6). (3) RENDERER_CANDIDATE_ANALYSIS §7의 기각 후보를 사용자 결정으로 기록할지([REJECTED.md](REJECTED.md) 참고).
- **History:** 2026-10-01 생성. Skia vs Chromium 비교는 사용자 초안에서 M4 아이디어로 제시됐지만, Electron 대체 backend 선택이 M1 이식의 전제이므로 M1에 둔다. 선택 이후의 추가 성능 최적화만 M4-RENDER-001이 맡는다.

---

## Suggested next step

아래 순서는 analysis 문서들의 "Exact Next Step"을 모은 **제안**이다. 실제 순서는 사용자가 정한다.

1. **M1-RENDER-001 방향 결정** — 사용자 visual review 결과(전체 정상)를 바탕으로 Skia native / Playwright browser 중 다음 검증 범위를 결정. 근거: [RECOMPARISON §18](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#18-exact-next-step).
2. **M1-COMPAT-001 호환 수준 결정** — persistence와 출력 경로 설계의 전제.
3. **Runtime smoke(독립 실행 가능, 순서 무관)**
   - Detection S0–S3: [DETECTION §26](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#26-exact-next-step)
   - OCR S0–S4: [OCR §14](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#14-exact-next-step)
   - Translation S4(저장 prompt 재전송): [TRANSLATION_PIPELINE §17](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#17-exact-next-step)
   - Inpainting runner protocol smoke: [INPAINTING §18](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#18-exact-next-step)
4. **M1-CONFIG/CLI/OBS 설계** 후 M1-CORE-001 최소 E2E.
