# M5 — IDEAS

[M5 README](README.md) · [Planning index](../README.md)

| ID | Title |
|---|---|
| [M5-QUEUE-001](#m5-queue-001--multi-filechapter-queue) | Multi-file/chapter queue |
| [M5-BATCH-001](#m5-batch-001--장시간-unattended-batch-processing) | 장시간 unattended batch processing |
| [M5-INPUT-001](#m5-input-001--carrot에-없던-input-형식import-방식) | Carrot에 없던 input 형식/import 방식 |

---

### M5-QUEUE-001 — Multi-file/chapter queue

- **Status:** IDEA
- **Summary:** 여러 입력 file/chapter를 queue에 넣고 순서대로 자동 처리한다.
- **Why it matters:** M1 CLI는 한 번의 실행 단위를 다룬다. 여러 chapter를 연속 처리하려면 queue와 실행 순서 관리가 필요하다.
- **Related analysis:**
  - `Evidence: not yet analyzed`(queue 기능 자체).
  - 참고: [TR-LLM §10 Story Memory Lifecycle](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#10-story-memory-lifecycle) — 이전 화 story memory를 다음 화 번역이 읽으므로 같은 작품의 chapter 처리 순서가 결과에 영향을 준다.
- **Related items:** M5-BATCH-001, [M1-CLI-001](../M1_LINUX_PORT/CURRENT.md#m1-cli-001--bashcli-실행).
- **Dependencies:** M1 완료.
- **Decision / validation needed:** queue 저장 위치, 실패 시 다음 항목 진행 정책 — 사용자.
- **History:** 2026-10-01 생성.

### M5-BATCH-001 — 장시간 unattended batch processing

- **Status:** IDEA
- **Summary:** 사람 개입 없이 장시간 여러 chapter를 처리하고, 실패한 page/stage와 원인을 기록한 뒤 계속 진행한다.
- **Why it matters:** 장시간 실행에서는 page 수에 따라 커지는 상태(저장 I/O, memory, log, artifact)가 문제가 될 수 있다.
- **Related analysis:**
  - [INPAINTING §7 Long-run / Page-count Scaling Investigation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#7-long-run--page-count-scaling-investigation) — page 수에 따라 증가하는 구조.
  - [CORE §11 Failure Semantics](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#11-failure-semantics) — 현재 실패 처리 방식.
  - [CORE §12 Performance State Accumulation Map](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#12-performance-state-accumulation-map) — 장시간 누적 상태.
- **Related items:** M5-QUEUE-001, [M4-PERSIST-001](../M4_OPTIMIZATION/IDEAS.md#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선).
- **Dependencies:** M5-QUEUE-001, M1-OBS-001.
- **Decision / validation needed:** 실패 허용·재시도 정책([MIGRATION_PRINCIPLES §7 Recovery Policy](../../MIGRATION_PRINCIPLES.md#7-recovery-policy) 참고) — 사용자.
- **History:** 2026-10-01 생성.

### M5-INPUT-001 — Carrot에 없던 input 형식/import 방식

- **Status:** IDEA
- **Summary:** Carrot이 지원하지 않던 input을 RoverCMT 신규 기능으로 검토한다. 후보: 7z archive, GIF/BMP/TIFF/AVIF 등 추가 이미지 형식, archive/이미지 URL 직접 다운로드, recursive 폴더를 1 chapter로 합치기, clipboard 입력.
- **Why it matters:** Carrot 기존 지원 input은 M1 parity([M1-INPUT-001](../M1_LINUX_PORT/CURRENT.md#m1-input-001--carrot-inputimport-parity))다. 그 밖의 형식은 M1에 섞지 않고 여기서 따로 판단한다. "decoder library가 지원한다"는 이유만으로 parity에 넣지 않는다.
- **Related analysis:**
  - [CARROT_LOADER_OUTPUT_CONTRACT — Input / import capability](../../analysis/CARROT_LOADER_OUTPUT_CONTRACT.md#input--import-capability-d10-source-trace-2026-10-02) — 위 후보가 Carrot에 없다는 근거(allowlist, 웹 import의 명시적 unsupported skip, 7z 부재).
- **Related items:** M1-INPUT-001. JFIF `.jfif`도 Carrot 미지원 신규 기능이지만 사용자 요청으로 M1 Step 1 보완에서 이미 구현됐다(M1-INPUT-001에 기록).
- **Dependencies:** M1-INPUT-001의 materialization 경로.
- **Decision / validation needed:** 후보별 필요성과 처리 규칙(animated GIF 처리, 저장 형식 변환, Windows Carrot이 그 page를 열 수 있는지) — 사용자.
- **History:** 2026-10-02 생성(D10 source trace의 신규 기능 분류).
