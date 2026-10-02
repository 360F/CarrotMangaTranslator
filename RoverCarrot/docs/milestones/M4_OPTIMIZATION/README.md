# M4 — Optimization

**Status: not active** · [Planning index](../README.md) · [CURRENT](CURRENT.md) · [IDEAS](IDEAS.md) · [REJECTED](REJECTED.md)

## 목표

각 pipeline/stage 자체의 처리속도를 높이기 위해 가능한 최적화를 항목별로 실험하고 구현한다.

## 원칙 (사용자 정의, 2026-10-01)

- Detection / OCR / Translation / Inpainting / Typography / Layout / Renderer / Persistence / Runtime 등 **항목별로** 진행한다.
- M2 benchmark로 Before/After를 측정한다.
- 품질과 속도 사이 trade-off가 생기면 **자동으로 결정하지 않는다.** 결과와 근거를 사용자에게 보여주고 사용자가 결정한다.

## 범위 구분

- 여러 stage/page의 동시 실행은 [M3](../M3_PIPELINING/README.md)가 맡는다.
- 품질·정합성 개선(예: memory correction)이 속도 개선과 묶여 있는 아이디어도 그 영역(Translation 등)의 primary owner로 여기에 둔다.
- M1 이식 contract(prompt, memory 의미, 저장 의미)를 바꾸는 아이디어는 M1 baseline 이후에만 실험한다.

## IDEAS 영역별 목록

| 영역 | Items |
|---|---|
| Translation | [M4-TRANS-001 … 011](IDEAS.md#translation) |
| Inpainting | [M4-INPAINT-001, 002](IDEAS.md#inpainting) |
| Detection / Layout | [M4-DETECT-001](IDEAS.md#detection--layout) |
| Runtime | [M4-RUNTIME-001, 002](IDEAS.md#runtime) |
| Persistence | [M4-PERSIST-001](IDEAS.md#persistence) |
| Renderer | [M4-RENDER-001](IDEAS.md#renderer) |
| OCR / Typography | 아직 없음 |

## 가장 큰 근거 문서

- Translation: [TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS §19 Future Optimization Candidates](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#19-future-optimization-candidates)와 [§13 Performance Implications](../../analysis/TRANSLATION_LLM_REQUEST_CONTEXT_ANALYSIS.md#13-performance-implications). 이 분석에서 translation wall time은 생성(`predicted_ms`) 76%, prefill(`prompt_ms`) 16%, 나머지 약 8%였다(218건 합계).
- Inpainting / Persistence: [INPAINTING §7 Long-run / Page-count Scaling Investigation](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#7-long-run--page-count-scaling-investigation), [§14 Real Library / Run Evidence](../../analysis/INPAINTING_PIPELINE_MIGRATION_ANALYSIS.md#14-real-library--run-evidence).
- Detection: [DETECTION §23 Repeated Koharu Inference — Reuse Feasibility](../../analysis/DETECTION_PIPELINE_MIGRATION_ANALYSIS.md#23-repeated-koharu-inference--reuse-feasibility).
