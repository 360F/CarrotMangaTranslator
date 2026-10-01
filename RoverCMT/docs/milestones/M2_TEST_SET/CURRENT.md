# M2 — CURRENT

[M2 README](README.md) · [Planning index](../README.md)

사용자가 M2 범위로 정한 작업이다. M2는 아직 active가 아니므로 모두 `not started`다.

| ID | Title | Progress |
|---|---|---|
| [M2-GOLDEN-001](#m2-golden-001--사용자-검토-golden-sample-약-3종) | 사용자 검토 Golden Sample 약 3종 | not started |
| [M2-BENCH-001](#m2-bench-001--stage별-benchmark와-실행시간-측정) | Stage별 benchmark와 실행시간 측정 | not started |
| [M2-BENCH-002](#m2-bench-002--full-e2e-benchmark와-실행시간-측정) | Full E2E benchmark와 실행시간 측정 | not started |
| [M2-BENCH-003](#m2-bench-003--baseline-vs-candidate-비교와-timing-report) | Baseline vs candidate 비교와 timing report | not started |
| [M2-BENCH-004](#m2-bench-004--사용자-요청-시-실행하는-운영-정책) | 사용자 요청 시 실행하는 운영 정책 | not started |
| [M2-BENCH-005](#m2-bench-005--immutableversioned-benchmark-inputmanifest) | Immutable/versioned benchmark input·manifest | not started |

---

### M2-GOLDEN-001 — 사용자 검토 Golden Sample 약 3종

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** 사용자가 직접 고른 약 3개 sample(내용 특성과 page 길이가 서로 다름)을 장기 기준 입력으로 고정한다.
- **Why it matters:** 에이전트가 만든 테스트는 기준으로 신뢰할 수 없다. page 수에 따라 증가하는 비용(저장 I/O, memory 누적)이 있으므로 길이가 다른 sample이 필요하다.
- **Related analysis:**
  - [INPAINTING §7 Long-run / Page-count Scaling Investigation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#7-long-run--page-count-scaling-investigation) — page 수에 따라 증가하는 구조(A 분류) 목록. 길이가 다른 sample이 필요한 근거.
  - [RENDERER_FIXTURE_CENSUS §6 Selected Fixtures](../../analysis/RENDERER_FIXTURE_CENSUS.md#6-selected-fixtures)와 [RENDERER_LIBRARY_FEATURE_CENSUS §8 Recommended Fixture Candidates](../../analysis/RENDERER_LIBRARY_FEATURE_CENSUS.md#8-recommended-fixture-candidates) — 기존 fixture 선정 방식과 실제 library에서 발견된 미포함 사례.
- **Dependencies:** M1 E2E 실행 가능.
- **Decision / validation needed:** 사용자 sample 선정과 승인. 저작권/배포 범위(repository에 넣을지 로컬 경로 참조만 할지).
- **History:** 2026-10-01 생성.

### M2-BENCH-001 — Stage별 benchmark와 실행시간 측정

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** Detection, OCR, Translation, Erase, Typography/Layout, Render 등 stage를 개별 실행하고 결과와 시간을 측정한다.
- **Why it matters:** M3/M4 개선 효과를 stage 단위로 분리해 보려면 필요하다. 현재 Carrot 로그는 stage 시간을 충분히 분리하지 않는다.
- **Related analysis:**
  - [INPAINTING §15 Future 20-page vs 100-page Benchmark Design](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#15-future-20-page-vs-100-page-benchmark-design-미실행) — 미실행 benchmark 설계와 필요한 계측.
  - [DETECTION §26 Exact Next Step](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#26-exact-next-step) — 계측 부족(detection 시간이 `ocr` bucket에 합산).
  - [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §13.2 계측이 필요한 것](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#132-계측이-필요한-것-unknown) — translation에서 아직 측정하지 못한 항목.
- **Related items:** [M1-OBS-001](../M1_LINUX_PORT/CURRENT.md#m1-obs-001--stage-진행상황과-소요시간-실시간-표시).
- **Dependencies:** M1-OBS-001, M2-GOLDEN-001.
- **Decision / validation needed:** stage 경계 정의와 측정 지표 목록 승인.
- **History:** 2026-10-01 생성.

### M2-BENCH-002 — Full E2E benchmark와 실행시간 측정

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** Golden Sample 전체를 input → output까지 실행하고 total time-to-output과 산출물을 기록한다.
- **Why it matters:** PROJECT_VISION은 개별 stage보다 전체 time-to-output을 중시한다.
- **Related analysis:**
  - [CORE §12 Performance State Accumulation Map](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#12-performance-state-accumulation-map) — E2E에서 누적되는 상태 목록.
  - [CORE §10 Reproducibility](../../analysis/CORE_DATA_MODEL_PIPELINE_CONTRACT_ANALYSIS.md#10-reproducibility) — 재현성 수준(L1–L3) 정의.
- **Dependencies:** M1-CORE-001, M2-GOLDEN-001.
- **Decision / validation needed:** 원격 translation endpoint 등 외부 변수의 고정·기록 방법.
- **History:** 2026-10-01 생성.

### M2-BENCH-003 — Baseline vs candidate 비교와 timing report

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** 승인된 baseline(M1 결과)과 candidate의 시간·산출물을 나란히 비교하는 report를 만든다. 품질 판정은 사람이 하고, 자동 diff는 보조 지표로 둔다.
- **Why it matters:** M3/M4는 "M1과 큰 차이 없음"과 "더 빠름"을 함께 보여야 한다.
- **Related analysis:**
  - [RENDERER_CONTRACT_ALIGNED_RECOMPARISON §14 Pixel diagnostics](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#14-pixel-diagnostics) — pixel diagnostic은 보조값이며 pass/fail 임계값이 아니라는 선례.
  - [RENDERER_COMPARISON_SPIKE §7 Review artifacts](../../analysis/RENDERER_COMPARISON_SPIKE.md#7-review-artifacts) — reference/candidate/diff를 한 HTML에서 보는 report 형식 선례.
- **Dependencies:** M2-BENCH-001, M2-BENCH-002.
- **Decision / validation needed:** report 형식 승인.
- **History:** 2026-10-01 생성.

### M2-BENCH-004 — 사용자 요청 시 실행하는 운영 정책

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** benchmark는 commit마다 자동 실행하지 않고 사용자가 요청할 때 실행한다. 실행 command와 결과 저장 위치를 문서화한다.
- **Why it matters:** 장시간·GPU·원격 endpoint 비용이 있는 benchmark를 CI에 묶지 않기 위한 사용자 결정이다.
- **Related analysis:** `Evidence: not yet analyzed`(운영 정책이므로 분석 근거 대상 아님).
- **Dependencies:** M2-BENCH-001–003.
- **Decision / validation needed:** 없음(사용자 정의 원칙).
- **History:** 2026-10-01 생성.

### M2-BENCH-005 — Immutable/versioned benchmark input·manifest

- **Status:** CURRENT
- **Progress:** not started
- **Summary:** Golden Sample 입력, 설정, 기대 산출물을 SHA-256/byte size로 묶은 versioned manifest로 고정한다. 승인된 version은 수정하지 않고 변경 시 새 version을 만든다.
- **Why it matters:** 같은 입력으로 비교해야 Before/After가 의미 있다.
- **Related analysis:**
  - [RENDERER_CONTRACT_ALIGNED_RECOMPARISON §6 Canonical v3 contract](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#6-canonical-v3-contract) — manifest-v3가 snapshot·raster·font·reference를 hash로 묶은 방식.
  - [RENDERER_PORTABLE_FONT_REFERENCE §10 Manifest Revision](../../analysis/RENDERER_PORTABLE_FONT_REFERENCE.md#10-manifest-revision) — 기존 version을 보존하고 새 revision을 만든 선례.
- **Dependencies:** M2-GOLDEN-001.
- **Decision / validation needed:** manifest schema 승인.
- **History:** 2026-10-01 생성.
