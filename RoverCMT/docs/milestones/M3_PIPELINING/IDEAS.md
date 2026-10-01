# M3 — IDEAS

[M3 README](README.md) · [Planning index](../README.md)

| ID | Title |
|---|---|
| [M3-SCHED-001](#m3-sched-001--detectionocrtranslationerase-stage-overlap) | Detection/OCR/Translation/Erase stage overlap |
| [M3-SCHED-002](#m3-sched-002--page-level--stage-level-concurrency-전략) | Page-level / stage-level concurrency 전략 |
| [M3-STATE-001](#m3-state-001--공유-mutable-state-분리) | 공유 mutable state 분리 |
| [M3-TRANS-001](#m3-trans-001--translation-memory-순차-dependency-완화) | Translation memory 순차 dependency 완화 |
| [M3-RUNTIME-001](#m3-runtime-001--pipelining을-위한-gpu-resource-scheduling) | Pipelining을 위한 GPU resource scheduling |
| [M3-RUNTIME-002](#m3-runtime-002--koharu-session-lifecycle이-병렬화를-방해하는-문제) | Koharu session lifecycle이 병렬화를 방해하는 문제 |

---

### M3-SCHED-001 — Detection/OCR/Translation/Erase stage overlap

- **Status:** IDEA
- **Summary:** 서로 의존하지 않는 stage를 겹쳐 실행한다. Carrot의 translation lane ∥ erase lane 실험 경로가 출발점이다.
- **Why it matters:** Carrot 사용자 full run 15개 중 9개가 이미 병렬 경로로 실행됐다. 현재 stage 순서는 stage-major(모든 page의 한 stage를 마친 뒤 다음 stage)다.
- **Related analysis:**
  - [INPAINTING §8 Experimental Translation / Erase Parallel Path](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#8-experimental-translation--erase-parallel-path) — 활성 조건, lane 구조, deferred commit, 알려진 충돌.
  - [TRANSLATION_PIPELINE_MIGRATION_ANALYSIS §1 Production Translation Flow](../../analysis/TRANSLATION_PIPELINE_MIGRATION_ANALYSIS.md#1-production-translation-flow) — stage-major 실행 순서와 병렬 경로 진입 조건.
  - [CORE §17 Open Decisions #3](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#17-open-decisions-for-user) — 병렬 모드는 번역 전에 erase하므로 번역 누락 block의 원문도 지워진다는 trade-off.
- **Related items:** M3-SCHED-002, M3-RUNTIME-001.
- **Dependencies:** M1 완료(baseline), M2 benchmark.
- **Decision / validation needed:** Carrot 실험 경로를 M1에서 그대로 이식할지, M3에서 재설계할지. 번역 누락 block erase 정책.
- **History:** 2026-10-01 생성.

### M3-SCHED-002 — Page-level / stage-level concurrency 전략

- **Status:** IDEA
- **Summary:** page 단위 pipelining(page N이 erase 중일 때 page N+1이 translate)과 stage 내부 page 병렬 요청 중 어떤 전략을 쓸지 정한다.
- **Why it matters:** translation은 원격 endpoint라 local GPU와 겹칠 여지가 있지만, 원격 server의 동시 처리 능력은 측정되지 않았다.
- **Related analysis:**
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §13.2 계측이 필요한 것](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#132-계측이-필요한-것-unknown) — "server의 동시 slot 수와 page 병렬 요청 시 처리량"이 UNKNOWN.
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §19 Future Optimization Candidates #9](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#19-future-optimization-candidates) — page 병렬 요청 후보와 memory 순서 의존 주의.
- **Related items:** M3-SCHED-001, M3-TRANS-001.
- **Dependencies:** M2 benchmark, 원격 server 동시성 측정.
- **Decision / validation needed:** 사용자 선택.
- **History:** 2026-10-01 생성.

### M3-STATE-001 — 공유 mutable state 분리

- **Status:** IDEA
- **Summary:** stage가 공유하는 mutable state(chapter 전체 snapshot 저장, deferred erase 결과, workflow pending memory 버퍼 등)를 page/stage 단위로 분리해 병렬화를 가능하게 한다.
- **Why it matters:** 현재 저장은 chapter 단위 transaction이고, 병렬 경로는 erase 결과를 translation lane 종료까지 메모리에 보관한다.
- **Related analysis:**
  - [CORE §12 Performance State Accumulation Map](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#12-performance-state-accumulation-map) — run 중 커지는 공유 상태 목록.
  - [INPAINTING §7 Long-run / Page-count Scaling Investigation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#7-long-run--page-count-scaling-investigation) — chapter 저장 I/O와 deferred erase 결과.
- **Related items:** [M4-PERSIST-001](../M4_OPTIMIZATION/IDEAS.md#m4-persist-001--chapter-전체-json-반복-rewrite-비용-개선)(저장 비용 자체는 M4), [M1-PERSIST-001](../M1_LINUX_PORT/CURRENT.md#m1-persist-001--persistence와-data-contract-parity).
- **Dependencies:** M1-PERSIST-001의 저장 구조.
- **Decision / validation needed:** 분리 단위와 commit 순서 정책.
- **History:** 2026-10-01 생성.

### M3-TRANS-001 — Translation memory 순차 dependency 완화

- **Status:** IDEA
- **Summary:** page N+1 번역이 page N의 memory commit을 기다리는 구조를 완화해 translation page 병렬화를 가능하게 하는 방법을 검토한다(예: memory snapshot 기준 병렬, 사후 merge).
- **Why it matters:** 분석은 "이 순서 의존성 때문에 page 간 번역을 병렬화하면 memory 내용이 달라진다"고 기록했다. 품질 차이 없이 병렬화하려면 이 의존을 다뤄야 한다.
- **Related analysis:**
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §10.1 Workflow의 저장 의미](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#101-workflow의-저장-의미-fact) — page N+1이 page N의 commit 이후 memory를 읽는다.
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §15.4 갱신 시 주의점 #5](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#154-갱신-시-주의점-proposal) — 병렬화 시 commit 순서 정책 필요.
- **Related items:** [M4-TRANS-008](../M4_OPTIMIZATION/IDEAS.md#m4-trans-008--series-memory-개선)(memory 구조 자체 개선은 M4).
- **Dependencies:** M2 benchmark(품질 비교).
- **Decision / validation needed:** 품질 차이 허용 범위 — 사용자.
- **History:** 2026-10-01 생성.

### M3-RUNTIME-001 — Pipelining을 위한 GPU resource scheduling

- **Status:** IDEA
- **Summary:** HayaiOCR(CUDA), Koharu layout(DirectML/ONNX), FLUX(CUDA), local LLM(선택)이 같은 GPU를 쓸 때 stage overlap이 가능한 owner 정책을 정한다.
- **Why it matters:** 현재 Carrot은 stage 전환 때 GPU를 해제하는 순서로 충돌을 피한다. 병렬화하면 이 순서가 깨진다.
- **Related analysis:**
  - [CORE §8 Runtime / GPU Ownership Map](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#8-runtime--gpu-ownership-map) — runtime별 GPU 사용, handoff 순서, 충돌 가능 조합.
  - [INPAINTING §6.3 GPU handoff timeline](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#63-gpu-handoff-timeline-fact) — 순차/병렬 모드 timeline.
- **Related items:** M3-RUNTIME-002, [M4-RUNTIME-002](../M4_OPTIMIZATION/IDEAS.md#m4-runtime-002--gpu-lifecycle-최적화).
- **Dependencies:** M1 runtime item 완료, Linux GPU 환경 확정.
- **Decision / validation needed:** CORE §17 #6 GPU ownership 결정.
- **History:** 2026-10-01 생성.

### M3-RUNTIME-002 — Koharu session lifecycle이 병렬화를 방해하는 문제

- **Status:** IDEA
- **Summary:** 병렬 모드에서 translation lane이 page마다 Koharu layout session을 dispose하고 erase lane이 다시 만드는 교차 문제를 lane 간 resource ownership 관점에서 해결한다.
- **Why it matters:** 병렬 run에서 session 생성 로그가 27회(run 1336145f), 8회(run 10409ed7) 찍혔다. 재생성 1회 비용은 UNKNOWN이다.
- **Related analysis:**
  - [DETECTION §15 Runtime Lifecycle / Resource Ownership](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#15-runtime-lifecycle--resource-ownership) — 병렬 모드에서 dispose/재생성 교차.
  - [INPAINTING §6.3 GPU handoff timeline](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#63-gpu-handoff-timeline-fact) — 로그 근거와 INFERENCE.
- **Related items:** [M4-RUNTIME-001](../M4_OPTIMIZATION/IDEAS.md#m4-runtime-001--modelsession-cache와-불필요한-reloadrecreation-제거)(순차 실행에서의 불필요한 재생성 제거는 M4가 primary).
- **Dependencies:** M3-SCHED-001.
- **Decision / validation needed:** 재생성 비용 측정.
- **History:** 2026-10-01 생성.
