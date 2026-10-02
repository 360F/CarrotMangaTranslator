# M1 — CURRENT

[M1 README](README.md) · [Planning index](../README.md)

사용자가 M1에서 하기로 결정한 작업이다(2026-10-01 milestone 정의 기준). 각 item은 근거 analysis로 연결된다.
진행 상태는 `Progress`로 표시하며, 현재 값은 아래 Item 목록 표와 각 item의 `Progress` 필드를 따른다.
"기존 Carrot"/"Windows Carrot"은 reference fork(`fd461737`)와 그 Windows 빌드를 뜻한다([RoverCarrot/AGENTS.md](../../../AGENTS.md#reference-implementation)).

**2026-10-01 사용자 확정 결정** (자세한 내용은 각 item):

| 결정 | 내용 | 기록 위치 |
|---|---|---|
| M1 호환의 의미 | RoverCMT output을 기존 Windows Carrot에서 정상적으로 open/use할 수 있으면 된다(interoperability). byte/pixel identical, 같은 구현·runtime·renderer는 요구하지 않는다 | [M1-COMPAT-001](#m1-compat-001--windows-carrot과의-output-interoperability) |
| Rover Output | fork 기능(번역 JSON/CSV export, 출력 경로 분리, 기본 입출력 디렉터리)이지만 **M1에서 기존 기능으로 이식**한다 | [M1-PERSIST-002](#m1-persist-002--rover-output-이식번역-jsoncsv-export-출력-경로-기본-입출력-디렉터리) |
| Translation ↔ Erase 병렬 경로 | 기존 Carrot 기능이므로 **M1에서 이식**한다. M3는 이를 출발점으로 추가 pipelining을 검토한다 | [M1-CORE-002](#m1-core-002--기존-translation--erase-병렬-실행-경로-이식) |
| M1 renderer | **Skia Canvas primary, Playwright Chromium fallback/reference** | [M1-RENDER-001](#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback) |

Item 목록:

| ID | Title | Progress |
|---|---|---|
| [M1-CORE-001](#m1-core-001--linux-core-pipeline-port) | Linux core pipeline port | not started |
| [M1-CORE-002](#m1-core-002--기존-translation--erase-병렬-실행-경로-이식) | 기존 Translation ↔ Erase 병렬 실행 경로 이식 | not started |
| [M1-CONFIG-001](#m1-config-001--configsettings-파일-기반-설정) | Config/settings 파일 기반 설정 | not started |
| [M1-CONFIG-002](#m1-config-002--inputoutput-경로-config화) | Input/output 경로 config화 | not started |
| [M1-INPUT-001](#m1-input-001--carrot-inputimport-parity) | Carrot input/import parity | in progress (Step 1: 직접 이미지·direct folder 일부) |
| [M1-CLI-001](#m1-cli-001--bashcli-실행) | Bash/CLI 실행 | not started |
| [M1-OBS-001](#m1-obs-001--stage-진행상황과-소요시간-실시간-표시) | Stage 진행상황과 소요시간 실시간 표시 | not started |
| [M1-COMPAT-001](#m1-compat-001--windows-carrot과의-output-interoperability) | Windows Carrot과의 output interoperability | not started (정의 확정) |
| [M1-PERSIST-001](#m1-persist-001--persistence와-data-contract-parity) | Persistence와 data contract parity | not started |
| [M1-PERSIST-002](#m1-persist-002--rover-output-이식번역-jsoncsv-export-출력-경로-기본-입출력-디렉터리) | Rover Output 이식(번역 JSON/CSV export, 출력 경로, 기본 입출력 디렉터리) | not started |
| [M1-RUNTIME-001](#m1-runtime-001--linux-runtimemodel-의존성-교체적응) | Linux runtime/model 의존성 교체·적응 | not started |
| [M1-DETECT-001](#m1-detect-001--koharu-layout-onnx-linux-runtime) | Koharu layout ONNX Linux runtime | not started |
| [M1-OCR-001](#m1-ocr-001--hayaiocr-linux-runtime) | HayaiOCR Linux runtime | not started |
| [M1-TRANS-001](#m1-trans-001--openai-compatible-translation-client와-prompt-contract-이식) | OpenAI-compatible translation client와 prompt contract 이식 | not started |
| [M1-INPAINT-001](#m1-inpaint-001--flux-klein-candle-runner-linux-runtime) | FLUX Klein Candle runner Linux runtime | not started |
| [M1-RENDER-001](#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback) | Linux renderer: Skia Canvas primary, Playwright Chromium fallback | in progress (방향 결정, Skia 구현·검증 전) |

---

### M1-CORE-001 — Linux core pipeline port

- **Status:** CURRENT
- **Progress:** in progress (Step 1 skeleton 완료; 실제 stage/전체 M1 검증 남음)
- **Summary:** Carrot staged workflow의 자동 pipeline(detect → ocr → translate → erase → typography/layout → render → output)을 RoverCMT 내부 독립 코드로 이식한다. 각 stage의 runtime 이식은 아래 개별 item이 맡고, 이 item은 orchestration과 stage 연결을 맡는다.
- **Why it matters:** M1의 본체다. 분석 결론은 "GUI와 Electron에 의존하지 않고 Linux에서 실행 가능한 독립적인 RoverCMT Core를 만드는 것은 현실적"이다.
- **Related analysis:**
  - [INITIAL_MIGRATION_ANALYSIS §1 목적과 결론](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#1-목적과-결론) — Linux Core 가능성 결론과 분리가 필요한 Carrot infrastructure 목록.
  - [INITIAL_MIGRATION_ANALYSIS §6 재사용 우선 후보](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#6-재사용-우선-후보) — 그대로 옮길 가치가 높은 orchestration·geometry·prompt·mask 로직과, `wholePagePipeline.ts` 통째 이식을 권장하지 않는 이유.
  - [CORE §1 End-to-End Production Data Flow](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#1-end-to-end-production-data-flow) — 실제 stage 순서와 stage 간 데이터.
  - [CORE §15 Minimal E2E Contract](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#15-minimal-e2e-contract) — stage 경계별 최소 전달 정보.
- **Related items:** 모든 M1 runtime item, M1-CORE-002, M1-PERSIST-001.
- **Dependencies:** M1-RENDER-001(방향은 결정됨: Skia primary), 각 runtime smoke.
- **Decision / validation needed:** CORE §17의 열린 결정(raw OCR 보존, 번역 누락 처리, erase와 번역의 관계, partial failure 정책 등)을 M1에서 Carrot 동작 그대로 둘지 사용자 확인. 대표 실제 page로 최소 E2E 실행([ANALYSIS_PLAN §6](../../ANALYSIS_PLAN.md#6-end-to-end-검증)).
- **History:** 2026-10-01 생성(milestone 정의). 2026-10-02 Step 1 skeleton/contract smoke 완료, Progress와 근거 갱신.

- **Step 1 evidence (2026-10-02):** [Step 1 Result](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter); loader contract, config/Core/CLI, dummy progress 및 isolated library persistence smoke 완료.

### M1-CORE-002 — 기존 Translation ↔ Erase 병렬 실행 경로 이식

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** reference fork에 있는 Translation ↔ Erase overlap 경로(`experimentalParallelAcceleration`, fork 커밋 `c5cef4cf`. upstream v2.8.2에는 없다)를 기존 기능의 일부로 보고 Linux port에 포함한다. 가능한 한 그대로 이식하고, Linux runtime/resource 차이로 같은 구현이 불가능하면 **기능적 동등성을 우선**하고 그 이유를 이 item의 History에 기록한다.
- **Why it matters:** M1의 목표는 기존 기능의 Linux 재현이다. 이 경로는 M3에서 처음 만드는 기능이 아니다. 사용자 full run 15개 중 9개가 이 경로로 실행됐다.
- **Existing behavior (analysis 인용):**
  - 활성 조건: `modelProvider==="openai-api"`, `api.experimentalParallelAcceleration===true`, `erasureEngine==="local"`, plan에 translate와 erase가 모두 있고 `format-rules`가 없음. 조건이 맞지 않으면 순차 실행.
  - 구조: chapter 하나 안에서 translation lane 전체와 erase lane 전체를 `Promise.allSettled`로 겹친다. 각 lane은 page 순차, lane당 동시성 1.
  - 저장: erase 결과는 translation lane이 끝날 때까지 메모리에 보관했다가 page 순서대로 commit한다.
  - 알려진 부작용: translation lane이 page마다 Koharu layout session을 dispose하고 erase lane이 다시 만든다. erase가 번역보다 먼저 일어나므로 번역 누락 block의 원문도 지워진다.
- **Related analysis:**
  - [INPAINTING §8 Experimental Translation / Erase Parallel Path](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#8-experimental-translation--erase-parallel-path) — 활성 조건, lane 구조, deferred commit, 성능 증거.
  - [INPAINTING §6.3 GPU handoff timeline](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#63-gpu-handoff-timeline-fact) — 병렬 모드의 GPU 사용과 Koharu session 재생성.
  - [TRANSLATION_PIPELINE §1.1 Stage 진입](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#11-stage-진입) — `executeExperimentalParallelChapter` 진입 조건과 translation 자체는 page 순차라는 점.
  - [CORE §8 Runtime / GPU Ownership Map](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#8-runtime--gpu-ownership-map) — 병렬 모드(openai-api 전용)의 runtime 동시 사용.
  - [CORE §17 Open Decisions #3](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#17-open-decisions-for-user) — erase와 번역의 관계(번역 누락 block 처리) 선택지.
- **Related items:** M1-CORE-001, M1-TRANS-001, M1-INPAINT-001, [M3-SCHED-001](../M3_PIPELINING/IDEAS.md#m3-sched-001--기존-translation--erase-병렬을-넘어선-추가-stage-overlap)(이 경로를 넘어선 추가 pipelining).
- **Dependencies:** M1-TRANS-001, M1-INPAINT-001, M1-DETECT-001(bubble prepass).
- **Decision / validation needed:** Linux에서 같은 구현이 어려운 부분이 생기면 기능적 동등성 판단과 이유 기록. 번역 누락 block의 erase 처리(CORE §17 #3)는 기존 동작 보존이 기본이며, 변경하려면 별도 사용자 결정이 필요하다. **장치 전제(미결정):** 이 경로는 번역 backend가 별도 장치에서 실행되는 상황을 전제로 만들어졌다. M1 대상 환경(Rover PC 5090 WSL2, [실행 환경](../../../AGENTS.md#실행-환경))에서는 번역과 FLUX/OCR이 같은 GPU를 쓸 수도 있다. 이 차이가 동작·자원에 주는 영향을 Step 8에서 검증 항목으로 확인한다. 지금 결정하지 않는다.
- **History:** 2026-10-01 생성. 사용자 결정: 기존 Translation ↔ Erase 병렬 경로는 기존 기능이므로 M1에서 이식하고, M3는 이를 출발점으로 추가 pipelining을 검토한다. 이전에 M3-SCHED-001의 "M1 이식 vs M3 재설계" 결정 항목이었던 부분이다. 2026-10-01 reference fork 기능(`c5cef4cf`)임을 명시하고 장치 전제(별도 장치 vs 같은 GPU 공유)를 검증 항목으로 추가(user decision).

### M1-CONFIG-001 — Config/settings 파일 기반 설정

- **Status:** CURRENT
- **Progress:** in progress (Step 1 skeleton 완료; 실제 stage/전체 M1 검증 남음)
- **Summary:** Carrot의 GUI settings와 `settings.json` 대신 RoverCMT config 파일로 pipeline 설정(model endpoint, runtime 경로, stage option, 언어 등)을 받는다. secret(API key 등)은 config 본문과 분리한다.
- **Why it matters:** CLI 실행과 재현성의 전제다. 현재 production 동작은 `settings.json`의 값(예: `modelProvider="openai-api"`, `ocr.pipeline="hayai"`, `cumulative:true`)에 따라 분기가 정해진다.
- **Related analysis:**
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §2 Actual Production Call Path](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#2-actual-production-call-path) — production 분기를 결정하는 실제 settings 값.
  - [TRANSLATION_PIPELINE_MIGRATION_ANALYSIS §2 Translation Backend / Runtime Inventory](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#2-translation-backend--runtime-inventory) — backend별 설정과 env 변수 목록.
  - [OCR §13 Recommended Migration Boundary](../../analysis/OCR_RUNTIME_MIGRATION_ANALYSIS.md#13-recommended-migration-boundary) — "실행 경로는 설정/CLI 인자로 받는다"는 runtime 준비 권장.
- **Related items:** M1-CONFIG-002, M1-CLI-001.
- **Dependencies:** 없음(설계 먼저 가능).
- **Decision / validation needed:** config 형식(JSON/TOML/YAML)과 Carrot `settings.json` 값 import 여부.
- **History:** 2026-10-01 생성. 2026-10-02 Step 1 skeleton/contract smoke 완료, Progress와 근거 갱신. 2026-10-02 Step 1 UX 보완: 단일 TOML config `config/config.toml`, `--config` 제거. Step 2 미시작.

- **Step 1 evidence (2026-10-02):** [Step 1 Result](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter); loader contract, config/Core/CLI, dummy progress 및 isolated library persistence smoke 완료.

### M1-CONFIG-002 — Input/output 경로 config화

- **Status:** CURRENT
- **Progress:** in progress (Step 1 skeleton 완료; 실제 stage/전체 M1 검증 남음)
- **Summary:** 입력 파일/디렉터리, 출력 파일/디렉터리, model/runtime 경로를 config 또는 CLI 인자로 받는다.
- **Why it matters:** Carrot은 data root와 library 구조(`library/works/<workId>/chapters/<chapterId>/…`)를 앱이 관리한다. Linux CLI에서는 명시적 경로가 필요하다.
- **Related analysis:**
  - [CORE §9 Persistence and Artifact Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#9-persistence-and-artifact-model) — 현재 저장 파일과 artifact 위치.
  - [INPAINTING §12 Linux RoverCMT Boundary](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#12-linux-rovercmt-boundary) — runner·model 경로와 해시 검증만 필요하다는 근거.
- **Related items:** M1-CONFIG-001, M1-COMPAT-001(출력은 Windows Carrot에서 열 수 있어야 한다).
- **Dependencies:** M1-COMPAT-001(정의 확정: Carrot에서 open/use 가능).
- **Decision / validation needed:** Carrot이 열 수 있는 출력 형태를 어떤 방식으로 만들지(Carrot library 구조에 직접 쓰기 / 별도 output 디렉터리 + Carrot이 가져올 수 있는 형태). M1-COMPAT-001의 interoperability 검증을 통과해야 한다.
- **History:** 2026-10-01 생성. 2026-10-01 M1-COMPAT-001 정의 확정에 맞춰 의존 설명 갱신. 2026-10-02 Step 1 skeleton/contract smoke 완료, Progress와 근거 갱신. 2026-10-02 사용자 검토 보완(input/smoke/local test-data), Step 2 미시작. 2026-10-02 고정 `config/`와 CLI `--input`/`--output` override, CWD 기준 상대경로(Step 1 Result D2).

- **Step 1 evidence (2026-10-02):** [Step 1 Result](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter); loader contract, config/Core/CLI, dummy progress 및 isolated library persistence smoke 완료. 사용자 검토 보완으로 PNG/JPEG/WebP/JFIF decode, repository smoke와 Git 제외 로컬 test-data 추가(같은 Result 참고).

### M1-INPUT-001 — Carrot input/import parity

- **Status:** CURRENT
- **Progress:** in progress (Step 1 보완으로 PNG/JPG/JPEG/WebP 단일 파일·direct folder 일부 구현. 아래 차이와 나머지 parity 항목 남음)
- **Summary:** 기존 Carrot 사용자가 실제로 쓸 수 있던 input/import 기능을 Linux RoverCMT(config/CLI 입력)로 이식한다. 범위 판단 기준: **Carrot 기존 지원 → M1 parity**(빠지면 migration regression), **Carrot 미지원 → 신규 기능**(M1 parity 아님, [M5-INPUT-001](../M5_FEATURES/IDEAS.md#m5-input-001--carrot에-없던-input-형식import-방식)).
- **Why it matters:** 실제 사용자 검토에서 JPG 4페이지 만화가 PNG 전용 Step 1 입력에서 실패했다. 이식 중 기존 input 기능이 조용히 빠지지 않도록 M1 완료 전 점검표가 필요하다.
- **Related analysis:**
  - [CARROT_LOADER_OUTPUT_CONTRACT — Input / import capability](../../analysis/CARROT_LOADER_OUTPUT_CONTRACT.md#input--import-capability-d10-source-trace-2026-10-02) — entry point, 형식, directory/archive/URL 동작의 source evidence(이 item의 사실 근거. 여기서 다시 쓰지 않는다).
- **Parity checklist** (Carrot 근거는 위 analysis. M1 완료 전 모두 `done` 또는 사용자 결정으로 처리되어야 한다):

  | # | Carrot 기능 | Rover 현재 | 비고 |
  |---|---|---|---|
  | P1 | 직접 이미지 PNG/JPG/JPEG/WebP | 부분(Step 1) | 아래 차이 I1–I5 |
  | P2 | 폴더 direct file import(non-recursive, natural order) | 부분(Step 1) | 아래 차이 I3, I6 |
  | P3 | 이미지 여러 개 선택 import(1 chapter) | 없음 | config `input`은 경로 1개. CLI 표현 결정 필요 |
  | P4 | ZIP/CBZ(1 chapter, 내부 경로 natural order) | 없음 | yauzl 예산·순서 |
  | P5 | RAR/CBR | 없음 | Carrot은 Rust runner(`rars`). Linux 재사용 가능성 확인 |
  | P6 | PDF(300 DPI PNG rasterize) | 없음 | 같은 runner(`hayro`) |
  | P7 | 일괄 가져오기 폴더(여러 archive/하위 폴더 → 여러 chapter) | 없음 | multi-chapter output 필요(현재 output은 1 work 1 chapter) |
  | P8 | 웹 페이지 URL import | 없음 | Carrot은 Electron browser로 page scan → GUI 후보 선택. Linux browser runtime과 CLI 선택 정책 결정 필요 |
  | P9 | drag & drop | 해당 없음 | GUI entry. 같은 경로 분류(P1–P6)로 대체되며 혼합 drop 거부 규칙만 의미가 있다 |

- **Step 1 구현과 Carrot 동작의 차이** (2026-10-02 [Step 1 보완](IMPLEMENTATION_PLAN.md#input-materialization-direction) 기준. 바꿀지는 사용자 결정):
  - I1 확장자/content 불일치: Carrot은 content로 판정해 받아들이고 저장 확장자를 고친다. Rover는 실패시킨다.
  - I2 WebP: Carrot은 PNG로 변환해 `.png`로 저장한다. Rover는 원본 `.webp`를 보존한다. Carrot loader는 `.webp` page path를 허용하지만 Carrot import가 만들지 않는 형태라 Windows 후속 stage 동작은 Step 8 interop 검증이 필요하다.
  - I3 header가 잘못된 파일: Carrot folder/이미지 import는 그 파일만 제외하고 계속한다(유효 page 0이면 실패). Rover는 전체 실패다. pixel 손상은 둘 다 전체 실패다.
  - I4 JPEG EXIF orientation 5–8: Carrot은 회전 후 width/height를 기록한다. Rover는 저장 raster 크기를 기록한다.
  - I5 animated WebP: Carrot은 header를 허용한다(첫 frame만 변환되는 것으로 보이나 미확정). Rover는 거부한다.
  - I6 정렬과 metadata: Carrot은 `localeCompare(undefined, {numeric, sensitivity: "base"})`, Rover는 `'en'`·numeric(대소문자 동률 처리가 다를 수 있다). Carrot folder page의 `sourceFileName`/`sourceRelativePath`, chapter title(폴더 이름)은 Rover에 아직 없다. 크기 한계(256 MiB, 120M pixel)도 다르다.
- **신규 기능으로 분류(M1 parity 아님):** JFIF `.jfif` 확장자 — Carrot 미지원. 사용자 요청으로 Step 1 보완에서 JPEG decoder로 구현됐다(저장 `.jpg`). 7z, GIF/BMP/TIFF/AVIF 등, archive/이미지 URL 직접 다운로드, recursive 폴더를 1 chapter로 합치기, clipboard → [M5-INPUT-001](../M5_FEATURES/IDEAS.md#m5-input-001--carrot에-없던-input-형식import-방식).
- **Related items:** M1-CONFIG-002(input 경로 config), M1-COMPAT-001(I2 등 Windows open/use), M1-PERSIST-001(multi-chapter output), M1-RUNTIME-001(ffmpeg/Rust runner/browser 의존성).
- **Dependencies:** P7은 multi-chapter output, P8은 Linux browser runtime 결정.
- **Decision / validation needed:** (사용자) I1–I6를 Carrot 동작으로 맞출지. P3/P8의 CLI 표현(P8의 후보 선택 GUI를 어떻게 대체할지). `.mgtshare` 공유 패키지 import와 기존 작품에 chapter 추가를 이 item 범위로 볼지(원본 만화 input이 아니라 Carrot 작품/library 조작이라 분류를 보류했다). 구현 Step 배정. 미배정이어도 [Step 8](IMPLEMENTATION_PLAN.md#step-8--full-integration--interoperability) 완료 전 이 점검표로 누락을 확인한다.
- **History:** 2026-10-02 생성. 사용자 원칙(Carrot 기존 지원 = M1 parity, 미지원 = 신규 기능)과 D10 source trace에 따름(user decision). Step 2 미시작.

### M1-CLI-001 — Bash/CLI 실행

- **Status:** CURRENT
- **Progress:** in progress (Step 1 skeleton 완료; 실제 stage/전체 M1 검증 남음)
- **Summary:** GUI 없이 Linux bash에서 하나의 command로 pipeline 전체 또는 지정 stage를 실행한다.
- **Why it matters:** M1의 실행 형태 요구사항이다. 현재 Carrot은 Electron main process와 IPC를 통해 실행된다.
- **Related analysis:**
  - [INITIAL_MIGRATION_ANALYSIS §3.1 Input / orchestration / persistence](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#31-input--orchestration--persistence--adaptable) — orchestration이 ADAPTABLE로 분류된 근거.
  - [CORE §16 What NOT to Migrate](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기) — Electron IPC/UI state가 Core 범위 밖이라는 근거.
- **Related items:** M1-OBS-001.
- **Dependencies:** M1-CONFIG-001.
- **Decision / validation needed:** stage 단위 재실행(resume) 지원 범위.
- **History:** 2026-10-01 생성. 2026-10-02 Step 1 skeleton/contract smoke 완료, Progress와 근거 갱신. 2026-10-02 사용자 검토 보완(input/smoke/local test-data), Step 2 미시작.

- **Step 1 evidence (2026-10-02):** [Step 1 Result](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter); loader contract, config/Core/CLI, dummy progress 및 isolated library persistence smoke 완료. 사용자 검토 보완으로 PNG/JPEG/WebP/JFIF decode, repository smoke와 Git 제외 로컬 test-data 추가(같은 Result 참고).

### M1-OBS-001 — Stage 진행상황과 소요시간 실시간 표시

- **Status:** CURRENT
- **Progress:** in progress (Step 1 skeleton 완료; 실제 stage/전체 M1 검증 남음)
- **Summary:** 실행 중 page×stage 진행상황과 각 stage 소요시간을 실시간으로 출력하고, run 종료 후에도 남긴다.
- **Why it matters:** 사용자 요구사항이며 M2 benchmark의 측정 기반이다. 기존 Carrot 로그는 일부 시간을 다른 bucket에 합산한다(예: detection 시간이 `ocr` bucket에 합산).
- **Related analysis:**
  - [DETECTION §26 Exact Next Step](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#26-exact-next-step) — "detection 시간이 `ocr` bucket에 합산되는 등 계측이 부족하다".
  - [INPAINTING §15 Future 20-page vs 100-page Benchmark Design](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#15-future-20-page-vs-100-page-benchmark-design-미실행) — 추가로 필요한 계측 항목(prepass ms, crop 수, crop별 elapsed 등).
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §12 Token / Context Evidence](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#12-token--context-evidence) — translation에서 남겨야 할 지표(prompt/completion tokens, prompt_ms, predicted_ms, wall).
- **Related items:** [M2-BENCH-001](../M2_TEST_SET/CURRENT.md#m2-bench-001--stage별-benchmark와-실행시간-측정), [M2-BENCH-002](../M2_TEST_SET/CURRENT.md#m2-bench-002--full-e2e-benchmark와-실행시간-측정).
- **Dependencies:** M1-CLI-001.
- **Decision / validation needed:** 출력 형식(사람용 진행 표시 + 기계용 JSONL 등).
- **History:** 2026-10-01 생성. 2026-10-02 Step 1 skeleton/contract smoke 완료, Progress와 근거 갱신. 2026-10-02 Step 1 UX 보완: 사람용 진행률 화면 + `logs/log_all.log`/`critical.log`. Step 2 미시작.

- **Step 1 evidence (2026-10-02):** [Step 1 Result](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter); loader contract, config/Core/CLI, dummy progress 및 isolated library persistence smoke 완료.

### M1-COMPAT-001 — Windows Carrot과의 output interoperability

- **Status:** CURRENT
- **Progress:** in progress (Step 1 skeleton 완료; 실제 stage/전체 M1 검증 남음)
- **Summary:** RoverCMT가 생성한 프로젝트/결과물을 **기존 Windows Carrot에서 열었을 때 정상적으로 불러오고 사용할 수 있게** 한다. 요구사항은 interoperability다: "RoverCMT output → 기존 Windows Carrot에서 정상적으로 open/use 가능".
- **요구하지 않는 것:**
  - Windows Carrot과 같은 내부 구현
  - 같은 runtime
  - 같은 renderer
  - byte-identical project representation
  - Electron과 pixel-identical 최종 raster
- **Why it matters:** 사용자 요구사항이다. 이 정의는 [PROJECT_VISION §2](../../PROJECT_VISION.md#2-carrotmangatranslator와의-관계)·[§5](../../PROJECT_VISION.md#5-의도적인-trade-off)와 [MIGRATION_PRINCIPLES §5 Behavior Compatibility](../../MIGRATION_PRINCIPLES.md#5-behavior-compatibility)의 "내부 구조·동작 호환성은 목표가 아니다"와 충돌하지 않는다. 그 원칙은 **구현·동작의 동일성**을 요구하지 않는다는 뜻이고, M1-COMPAT-001은 **출력 데이터를 Carrot이 읽을 수 있는지**만 요구한다(아래 [M1 README](README.md#compatibility의-의미-2026-10-01-확정) 참고).
- **Related analysis:**
  - [CORE §2 Canonical Entity Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#2-canonical-entity-model) — Carrot의 work/chapter/page/block 구조와 파일 위치. Carrot이 여는 대상이다.
  - [CORE §4 Block Data Lifecycle](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#4-block-data-lifecycle) — block 필드별 생산자·소비자. Carrot이 열고 쓰는 데 필요한 필드를 고를 때 쓴다.
  - [CORE §9 Persistence and Artifact Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#9-persistence-and-artifact-model) — canonical 파일(`work.json`, `chapter.json`, `style-guide.json`, `story-memory.json`)과 debug artifact 구분.
  - [CORE §13 Proposed Minimal RoverCMT Core Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#13-proposed-minimal-rovercmt-core-model) — Rover 내부 model은 Carrot과 달라도 된다(확정 아님). 다르면 Carrot 형식으로 내보내는 경계가 필요하다.
  - [CARROT_LOADER_OUTPUT_CONTRACT.md](../../analysis/CARROT_LOADER_OUTPUT_CONTRACT.md) — Step 1 D1: strict schema, library path/identity 검증, relocation과 share ZIP 구분, 최소 출력 구조.
- **Related items:** M1-PERSIST-001, M1-CONFIG-002, [M1-RENDER-001](#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback)(pixel parity 불필요), [M4-PERSIST-001](../M4_OPTIMIZATION/IDEAS.md#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선).
- **Dependencies:** 없음. 이 정의가 M1-PERSIST-001, M1-CONFIG-002, M4-PERSIST-001의 범위를 정한다.
- **Decision / validation needed:**
  - 결정됨: 호환 수준 = Windows Carrot에서 open/use 가능(2026-10-01).
  - 남은 검증: RoverCMT 출력을 실제 Windows Carrot으로 열어 불러오기와 사용(편집·export 등 사용자가 쓰는 기본 동작)이 되는지 확인. Carrot loader 최소 contract는 Step 1 분석 완료; 실제 Windows open/use는 Step 8 검증한다.
- **History:** 2026-10-01 생성. 2026-10-01 사용자 결정으로 호환 의미를 output interoperability로 확정하고 title을 "Windows/Electron 결과·프로젝트 호환"에서 변경(ID 유지). 2026-10-02 Step 1 skeleton/contract smoke 완료, Progress와 근거 갱신.

- **Step 1 evidence (2026-10-02):** [Step 1 Result](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter); loader contract, config/Core/CLI, dummy progress 및 isolated library persistence smoke 완료.

### M1-PERSIST-001 — Persistence와 data contract parity

- **Status:** CURRENT
- **Progress:** in progress (Step 1 skeleton 완료; 실제 stage/전체 M1 검증 남음)
- **Summary:** stage 결과, block 데이터, translation memory(`style-guide.json`, `story-memory.json`), run artifact를 Carrot과 같은 의미로 저장·재사용한다.
- **Why it matters:** translation은 page N의 memory commit 이후 page N+1이 memory를 읽는 순차 의존이 있고, 같은 의미를 보존해야 현재 결과를 재현할 수 있다.
- **Related analysis:**
  - [CORE §9 Persistence and Artifact Model](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#9-persistence-and-artifact-model) — 무엇이 canonical이고 무엇이 debug artifact인지.
  - [CORE §14 Candidate Persistence Strategies](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#14-candidate-persistence-strategies) — chapter JSON / page JSON / SQLite 비교(winner 미정).
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §10.1 Workflow의 저장 의미](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#101-workflow의-저장-의미-fact) — memory를 page 저장과 같은 transaction으로 commit하는 의미.
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §16.4 반드시 보존해야 할 상태](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#164-반드시-보존해야-할-상태-fact) — memory 파일 2종과 merge 알고리즘.
- **Related items:** M1-COMPAT-001, [M4-PERSIST-001](../M4_OPTIMIZATION/IDEAS.md#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선).
- **Dependencies:** M1-COMPAT-001(정의 확정: 저장 결과를 Windows Carrot이 열 수 있어야 한다. 내부 저장 방식은 Carrot과 달라도 된다).
- **Decision / validation needed:** CORE §17 #5 persistence 전략. 요청별 work-context snapshot을 artifact로 남길지(TR-LLM §16.6).
- **History:** 2026-10-01 생성. 2026-10-01 M1-COMPAT-001 정의 확정에 맞춰 의존 설명 갱신. 2026-10-02 Step 1 skeleton/contract smoke 완료, Progress와 근거 갱신.

- **Step 1 evidence (2026-10-02):** [Step 1 Result](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter); loader contract, config/Core/CLI, dummy progress 및 isolated library persistence smoke 완료.

### M1-PERSIST-002 — Rover Output 이식(번역 JSON/CSV export, 출력 경로, 기본 입출력 디렉터리)

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** reference fork의 Rover Output 기능을 Linux Core로 이식한다: 번역 결과의 JSON/CSV export(`translation.csv` 등), 출력 경로 분리(Rover output root), 기본 입력/출력 디렉터리. Carrot GUI settings/dialog 부분은 이식하지 않고 [M1-CONFIG-001](#m1-config-001--configsettings-파일-기반-설정)·[M1-CONFIG-002](#m1-config-002--inputoutput-경로-config화)의 config/CLI 인자로 받는다.
- **Why it matters:** 사용자 결정으로 fork 기능이지만 M1에서 이식할 기존 기능으로 취급한다. upstream v2.8.2에는 없는 기능이므로 upstream 기준으로 판단하면 빠진다.
- **Existing behavior (source 근거, `fd461737` 기준):**
  - fork 커밋: `15eae20f`(기본 입출력 디렉터리), `314a5b91`(출력 경로와 번역 JSON export), `a39aea0d`(export·workflow 동작 정리), `fd461737`(export runtime state `rover-translation-exports.json` gitignore).
  - source: `src/main/roverDefaultDirectories.ts`(`resolveRoverOutputRoot`, `resolveTranslationJsonExportEnabled` 등), `src/main/linkedWorkspace/linkedWorkspaceTranslationJson.ts`(`buildTranslationJson`, `serializeTranslationCsv`, `createTranslationJsonExporter`), `src/main/linkedWorkspace/linkedWorkspaceFiles.ts`(`writeTranslationCsvFile` 등), `src/main/linkedWorkspace/linkedWorkspaceRuntime.ts`, `src/main/linkedWorkspace/linkedWorkspacePaths.ts`, `src/main/settings/appSettingsDefaults.ts`, `src/main/settings/appSettingsUiNormalize.ts`.
  - tests: `tests/linkedWorkspaceTranslationJson.test.ts`, `tests/translationJsonWorkflowAcceptance.test.ts`.
- **Related analysis:**
  - `Evidence: not yet analyzed`
- **Related items:** M1-PERSIST-001, M1-CONFIG-002, M1-TRANS-001, M1-COMPAT-001.
- **Dependencies:** M1-TRANS-001(번역 저장 상태에서 export가 트리거된다), M1-CONFIG-002(출력 경로).
- **Decision / validation needed:** 구현 Step(기본안: Step 4 구현, Step 8 통합. [IMPLEMENTATION_PLAN D29](IMPLEMENTATION_PLAN.md#open-decision--validation-register)). export 트리거 시점과 파일 형식은 source trace로 확인해 기존 동작을 보존한다.
- **History:** 2026-10-01 생성(user decision: fork 기능이지만 기존 기능으로 이식).

### M1-RUNTIME-001 — Linux runtime/model 의존성 교체·적응

- **Status:** CURRENT
- **Progress:** in progress (Step 1 skeleton 완료; 실제 stage/전체 M1 검증 남음)
- **Summary:** Carrot의 Windows/Electron 전용 지원 계층(Electron `nativeImage` image I/O, Windows managed installer/binary catalog, DirectML/PowerShell, FFmpeg 경로 등)을 Linux에서 동작하는 대응물로 교체한다. stage별 runtime은 아래 개별 item이 맡고 이 item은 공통 계층과 exact pin 검증을 맡는다.
- **Why it matters:** 분석 결론상 핵심 risk는 "Linux용 기술 부재"가 아니라 packaging 분리, exact pin, ABI, model/config compatibility다.
- **Related analysis:**
  - [INITIAL_MIGRATION_ANALYSIS §5 Upstream Linux compatibility](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#5-upstream-linux-compatibility) — component별 upstream Linux 지원.
  - [INITIAL_MIGRATION_ANALYSIS §8 현재 migration risk](../../analysis/INITIAL_MIGRATION_ANALYSIS.md#8-현재-migration-risk) — runtime availability와 packaging risk.
  - [ANALYSIS_PLAN §5 이후 Runtime Smoke Tests](../../ANALYSIS_PLAN.md#5-이후-runtime-smoke-tests) — runtime별 최소 smoke 기준.
- **Related items:** M1-DETECT-001, M1-OCR-001, M1-TRANS-001, M1-INPAINT-001, M1-RENDER-001.
- **Dependencies:** Linux 실행 환경(distro, GPU/driver). 주 환경: Rover PC([RoverCarrot/AGENTS.md 실행 환경](../../../AGENTS.md#실행-환경)).
- **Decision / validation needed:** 배포 형태(venv/container/system package)와 GPU 필수 여부.
- **History:** 2026-10-01 생성. 2026-10-01 Dependencies에 Rover PC 실행 환경 링크 추가(user decision). 2026-10-02 Step 1 skeleton/contract smoke 완료, Progress와 근거 갱신.

- **Step 1 evidence (2026-10-02):** [Step 1 Result](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter); loader contract, config/Core/CLI, dummy progress 및 isolated library persistence smoke 완료.

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

### M1-RENDER-001 — Linux renderer: Skia Canvas primary, Playwright Chromium fallback

- **Status:** CURRENT
- **Progress:** in progress — 분석·spike·contract-aligned v3 비교 완료, **방향 결정(2026-10-01)**, Skia production 구현·검증 전
- **Decision (사용자, 2026-10-01):**
  - **Primary: Skia Canvas.** M1에서 Skia Canvas를 우선 renderer backend로 구현한다.
  - **Fallback / reference: Playwright Chromium.** 삭제하거나 REJECTED로 옮기지 않는다. 검증된 fallback이자 Electron reference를 재현하는 기준 backend로 유지한다.
  - 전략: **"Skia first. Implement and validate Skia during the Linux port. If a material compatibility/capability blocker is discovered, fall back to Playwright Chromium."**
  - Skia는 영구 확정된 유일한 renderer가 아니다. 아래 fallback 조건에 해당하면 바꿀 수 있다.
- **Summary:** Electron `BrowserWindow`/Chromium 기반 final render를 Linux에서 실행 가능한 Skia Canvas backend로 교체한다. 기존 advanced rendering capability를 성급하게 삭제하지 않는다.
- **Why Skia (선택 근거):**
  - 현재 visual quality가 사용자 기준으로 충분히 acceptable하다(아래 User review).
  - M1은 Electron pixel parity가 목적이 아니다([M1-COMPAT-001](#m1-compat-001--windows-carrot과의-output-interoperability): Windows Carrot에서 open/use 가능하면 된다).
  - core renderer에서 Chromium/Electron dependency를 제거할 수 있다.
  - 현재 측정에서 startup과 warm rendering cost가 더 낮았고, Linux core에 더 가벼운 renderer가 될 가능성이 있다.
- **Current evidence (원문 인용):**
  - v3 contract-aligned 재비교 완료. Skia Canvas 8/8, Playwright Chromium 8/8 성공.
  - Playwright 출력은 8개 fixture 모두 Electron reference-v3와 byte/pixel identical(선택 기준이 아니라 contract 재현 증거).
  - Skia는 Electron과 작은 raster/layout 차이가 있지만, contract correction 후 v2의 큰 layout 차이는 해소됐다. `_0411` 첫 block: Electron reference-v3, Skia, Playwright 모두 94px, 같은 8줄, overflow 없음.
  - 남은 Skia 차이는 source-match block(특히 `_047`)의 1–2px 크기와 줄바꿈, `_012`의 4px 차이에 집중.
  - 성능(단일 run 관측, steady-state 보장 아님):

    | | Cold start | First render | Warm mean | Eight-page total |
    |---|---:|---:|---:|---:|
    | Skia Canvas | 46.31 ms | 890.18 ms | 476.20 ms | 4223.59 ms |
    | Playwright Chromium | 503.84 ms | 1212.43 ms | 773.71 ms | 6628.41 ms |

    단일 benchmark run의 결과이므로 "Skia가 항상 특정 비율만큼 빠르다"고 일반화하지 않는다.
- **User review (2026-10-01, 사용자 보고):** 사용자가 v3 visual comparison HTML을 직접 확인했고 전체 결과를 실사용 관점에서 정상/acceptable하다고 판단했다. analysis 문서([RECOMPARISON §16](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#16-human-visual-review-pending))에는 작성 시점 상태인 "Human visual review pending"이 남아 있다. 최신 상태는 이 item이 source of truth다.
- **Fallback 조건** — M1 구현 중 Skia에서 다음 같은 material blocker가 확인되면 Playwright Chromium으로 fallback할 수 있다. fallback 시 근거와 날짜를 History에 기록한다.
  - 필요한 font loading/fallback을 실용적으로 지원하지 못함
  - CJK shaping이 실제 프로젝트에서 허용하기 어려운 수준으로 깨짐
  - vertical text 처리에 심각한 문제가 발생
  - 기존 advanced rendering capability를 필요한 수준으로 구현할 수 없음
  - Windows Carrot에서 사용할 결과를 만드는 데 실질적 장애가 발생
  - 수정 비용이 Playwright 사용보다 명백히 과도해짐
- **Font capability validation (M1 범위):** Skia 사용 가능성을 확인하기 위한 compatibility/capability check다. 모든 폰트에 대한 대규모 benchmark가 아니며, [M2 Golden Sample/benchmark](../M2_TEST_SET/README.md)와 별개다. M1 구현 과정에서 필요한 최소 fixture/smoke test는 에이전트가 만들 수 있지만, 사용자가 검토·승인하는 장기 기준 셋은 M2 scope다.
  - Korean/Japanese CJK font loading
  - Latin/digit mixed text
  - font fallback
  - CJK shaping
  - vertical text
  - 기존 프로젝트에서 쓰는 일반적인 font switching
  - 참고: v3 검증은 portable Noto Sans CJK KR 하나를 중심으로 수행됐다. 현재 library census에서는 vertical text와 custom/non-default font가 0/603이지만 Carrot renderer는 두 기능을 지원하므로 capability로 확인한다(아래 Related analysis).
- **Related analysis:**
  - [RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md) — **Skia 선택의 최신 근거.** [§11 Fixture results](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#11-fixture-results), [§12 `_0411` before and after](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#12-_0411-before-and-after), [§13 Performance](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#13-performance), [§14 Pixel diagnostics](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#14-pixel-diagnostics), [§17 Unresolved questions](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#17-unresolved-questions).
  - [RENDERER_COMPARISON_SPIKE §9 Decision inputs still needed](../../analysis/RENDERER_COMPARISON_SPIKE.md#9-decision-inputs-still-needed) — v2 시점의 결정 입력. #1(Chromium parity vs Skia 속도)은 이번 결정으로 답했고, #4(steady-state memory)와 #5(Chromium version skew)는 Skia 구현 검증에서 다시 본다.
  - [RENDERER_CANDIDATE_ANALYSIS §3 Actual Renderer Requirements](../../analysis/RENDERER_CANDIDATE_ANALYSIS.md#3-actual-renderer-requirements) — CJK shaping, font fallback, vertical, outline 등 Skia가 구현해야 할 capability 목록. [§5 Candidate Survey](../../analysis/RENDERER_CANDIDATE_ANALYSIS.md#5-candidate-survey) — Skia Canvas(STRONG_CANDIDATE), Playwright Chromium(REFERENCE_FALLBACK)로 분류한 근거.
  - [RENDERER_LIBRARY_FEATURE_CENSUS §4 Feature Census](../../analysis/RENDERER_LIBRARY_FEATURE_CENSUS.md#4-feature-census) — 실제 library 603 block에서 쓰인 renderer 기능. [§5.1 Latin/digit 혼용 text](../../analysis/RENDERER_LIBRARY_FEATURE_CENSUS.md#51-latindigit-혼용-text), [§5.2 Default font에서의 실제 glyph fallback](../../analysis/RENDERER_LIBRARY_FEATURE_CENSUS.md#52-default-font에서의-실제-glyph-fallback) — font validation 항목의 실제 사례.
  - [RENDERER_FIXTURE_CENSUS §7 Coverage Matrix](../../analysis/RENDERER_FIXTURE_CENSUS.md#7-coverage-matrix) — v3 8 fixture가 다루는 범위와 빠진 범위.
  - [RENDERER_FONT_RESOLUTION §8 Portability / Distribution Considerations](../../analysis/RENDERER_FONT_RESOLUTION.md#8-portability--distribution-considerations)와 [RENDERER_PORTABLE_FONT_REFERENCE §4 License / Redistribution](../../analysis/RENDERER_PORTABLE_FONT_REFERENCE.md#4-license--redistribution) — Linux에서 같은 결과를 내려면 font를 pin하고 배포해야 한다는 근거와 선택된 portable font의 라이선스. [PORTABLE_FONT_REFERENCE §12 Future Multi-Font Compatibility](../../analysis/RENDERER_PORTABLE_FONT_REFERENCE.md#12-future-multi-font-compatibility) — font role → asset mapping(vertical, user-custom 등 확장 지점).
  - [CORE §0.2 Renderer decision state](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#02-renderer-decision-state) 와 [CORE §16 What NOT to Migrate](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#16-what-not-to-migrate-초기) — advanced renderer field는 현재 미사용이지만 schema를 optional로 남기라는 권장.
  - Review artifact(로컬, git 미추적): `RoverCarrot/spikes/renderer-comparison/outputs/comparison-2026-10-01-v3-contract-aligned/visual-comparison/index.html`. Spike 설명: [spikes/renderer-comparison/README.md](../../../spikes/renderer-comparison/README.md).
- **Related items:** [M1-COMPAT-001](#m1-compat-001--windows-carrot과의-output-interoperability), [M4-RENDER-001](../M4_OPTIMIZATION/IDEAS.md#m4-render-001--선택된-linux-renderer-backend의-성능-최적화)(선택 후 성능 최적화), [M2-GOLDEN-001](../M2_TEST_SET/CURRENT.md#m2-golden-001--사용자-검토-golden-sample-약-3종)(장기 기준 셋은 M2).
- **Dependencies:** 없음(방향 결정됨).
- **Decision / validation needed:**
  - 결정됨: backend 방향 = Skia primary, Playwright fallback/reference(2026-10-01).
  - 남은 검증: Linux에서 같은 Skia/font 버전으로 smoke와 isolated-process memory 측정(RECOMPARISON §17 #5–#6), 위 font capability validation, 남은 source-match 차이(`_047` 등)가 실사용에 문제없는지 구현 중 확인.
  - 남은 사용자 확인: RENDERER_CANDIDATE_ANALYSIS §7의 기각 후보를 사용자 결정으로 기록할지([REJECTED.md](REJECTED.md) 참고). Playwright는 그 목록에 없고 fallback으로 유지된다.
- **History:** 2026-10-01 생성. Skia vs Chromium 비교는 사용자 초안에서 M4 아이디어로 제시됐지만, Electron 대체 backend 선택이 M1 이식의 전제이므로 M1에 둔다. 선택 이후의 추가 성능 최적화만 M4-RENDER-001이 맡는다. 2026-10-01 사용자 결정: Skia Canvas primary, Playwright Chromium fallback/reference. title을 "Electron-free Linux renderer 선택과 구현"에서 변경(ID 유지).

---

## Suggested next step

M1의 구현 순서와 다음 Step은 **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** 가 관리한다(2026-10-01부터). 현재 다음 Step은 [Step 1 — Core Architecture, Contracts & CLI Adapter](IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter)다.

이전에 이 section에 있던 제안(Skia Linux 검증, Carrot loader 요구 조건 확인, runtime smoke, config/CLI/OBS 설계)은 IMPLEMENTATION_PLAN의 Step 1–8과 [Open decision / validation register](IMPLEMENTATION_PLAN.md#open-decision--validation-register)로 옮겼다.
