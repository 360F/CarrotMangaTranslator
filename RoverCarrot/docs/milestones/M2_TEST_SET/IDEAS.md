# M2 — IDEAS

[M2 README](README.md) · [Planning index](../README.md)

아직 benchmark contract로 확정하지 않은 후보다. 사용자가 확정하기 전에는 CURRENT로 옮기지 않는다.

| ID | Title |
|---|---|
| [M2-JUDGE-001](#m2-judge-001--vision-llm-quality-judge) | Vision LLM quality judge |
| [M2-VISUAL-001](#m2-visual-001--자동-visual-regression-보조) | 자동 visual regression 보조 |
| [M2-BENCH-006](#m2-bench-006--성능-측정-반복횟수-정책) | 성능 측정 반복횟수 정책 |

---

### M2-JUDGE-001 — Vision LLM quality judge

- **Status:** IDEA
- **Summary:** baseline과 candidate 결과 이미지를 vision LLM에 보여주고 번역·배치 품질 차이를 판정하게 한다.
- **Why it matters:** 사람 검토 비용을 줄일 수 있다. 다만 판정 자체의 신뢰성이 검증되지 않았다.
- **Related analysis:** `Evidence: not yet analyzed`. 참고: [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §22](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#22-unknowns-requiring-measurement)는 AI glossary 정확도에 "human gold가 없다"고 기록한다(자동 판정의 기준 부재).
- **Related items:** [M2-BENCH-003](CURRENT.md#m2-bench-003--baseline-vs-candidate-비교와-timing-report).
- **Dependencies:** M2-GOLDEN-001.
- **Decision / validation needed:** 사람 판정과의 일치율 검증 방법. 최종 판정권은 사용자에게 남긴다.
- **History:** 2026-10-01 생성.

### M2-VISUAL-001 — 자동 visual regression 보조

- **Status:** IDEA
- **Summary:** pixel diff, changed-pixel ratio 등 자동 지표로 큰 회귀를 먼저 걸러내고 사람 검토를 보조한다.
- **Why it matters:** renderer spike에서 이미 이런 지표를 썼다. 단 그 문서는 이를 pass/fail 기준이 아닌 보조값으로 규정했다.
- **Related analysis:**
  - [RENDERER_CONTRACT_ALIGNED_RECOMPARISON §14 Pixel diagnostics](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#14-pixel-diagnostics) — "Pixel diagnostics remain aids only and are not pass/fail thresholds."
- **Related items:** M2-BENCH-003.
- **Dependencies:** M2-BENCH-005.
- **Decision / validation needed:** 자동 지표를 gate로 쓸지 보조로만 쓸지.
- **History:** 2026-10-01 생성.

### M2-BENCH-006 — 성능 측정 반복횟수 정책

- **Status:** IDEA
- **Summary:** timing 측정을 여러 번(예: 5회) 반복하고 median 등 통계로 보고한다.
- **Why it matters:** 기존 renderer 성능 수치는 "one-run observations"라고 명시되어 있다. 반복 정책이 없으면 비교의 신뢰도가 낮다.
- **Related analysis:**
  - [RENDERER_CONTRACT_ALIGNED_RECOMPARISON §13 Performance](../../analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md#13-performance) — 1회 관측이며 steady-state 보장이 아니라는 기록.
- **Related items:** M2-BENCH-001, M2-BENCH-002.
- **Dependencies:** 없음.
- **Decision / validation needed:** 반복 횟수, warm-up 포함 여부, 통계(median/mean/p90). 사용자가 확정해야 CURRENT로 옮긴다.
- **History:** 2026-10-01 생성.
