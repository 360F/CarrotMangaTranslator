# RoverCMT Current Status

> **Current implementation planning and milestone tracking: [docs/milestones/README.md](milestones/README.md)**
>
> 2026-10-01부터 계획·active milestone·다음 작업·아이디어·폐기 결정의 source of truth는 milestone 문서다.
> 이 문서는 milestone 도입 이전 분석 단계(Phase 0)의 상태 기록으로 보존한다. 아래 "바로 다음 작업"과 "이후 순서"는 그 시점의 기록이며, 최신 다음 작업은 [M1 CURRENT](milestones/M1_LINUX_PORT/CURRENT.md#suggested-next-step)에서 확인한다.

## 현재 단계

Phase 0 — renderer comparison 측정 완료, human visual review 대기

Renderer feasibility/candidate 분석, fixture/font/reference 고정과
Skia Canvas/node-canvas/Playwright Chromium comparison harness 실행을 완료했다.

RoverCMT production implementation은 아직 시작하지 않았다.
Renderer winner와 production architecture도 아직 결정하지 않았다.

## Contract-aligned v3 update

The canonical v3 re-comparison is complete. Electron reference-v3, Skia, and Playwright consumed the same frozen page contract and exact portable font. Skia and Playwright rendered 8/8 fixtures; `_0411` now matches at 94px and eight lines in Electron, Skia, and Playwright. Remaining native differences are concentrated in several source-match blocks and require human visual review.

Detailed evidence:

- `docs/analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md`
- `spikes/renderer-comparison/outputs/comparison-2026-10-01-v3-contract-aligned/visual-comparison/index.html`

---

## 완료

- 프로젝트 기본 방향과 migration 원칙 정의
- Carrot automatic translation pipeline source trace
- 주요 component boundary와 PORTABLE / ADAPTABLE / REPLACE / OPTIONAL 분류
- Windows/Electron/runtime dependency와 upstream Linux compatibility 조사
- Linux independent Core 가능성 확인과 migration risk 재평가
- renderer feasibility/candidate analysis
- 8개 final snapshot fixture census와 manifest v1 보존
- portable Noto Sans CJK KR exact font와 lossless reference-v2 고정
- manifest-v2 hash/dimension/font contract 검증
- isolated renderer comparison harness 구현
- Windows에서 전체 8-fixture comparison 실행
- Skia Canvas 8/8, Playwright Chromium 8/8 PNG 생성
- node-canvas exact OTF/CFF font failure 격리 및 기록

상세 분석:

- `docs/analysis/INITIAL_MIGRATION_ANALYSIS.md`
- `docs/analysis/RENDERER_CANDIDATE_ANALYSIS.md`
- `docs/analysis/RENDERER_FIXTURE_CENSUS.md`
- `docs/analysis/RENDERER_FONT_RESOLUTION.md`
- `docs/analysis/RENDERER_PORTABLE_FONT_REFERENCE.md`
- `docs/analysis/RENDERER_COMPARISON_SPIKE.md`

---

## 현재 판단

Linux에서 독립적으로 실행되는 RoverCMT Core 구성은 현실적이다.
주요 detection, OCR, translation, inpainting runtime에는 Linux 실행 경로가 확인됐다.

Renderer comparison의 현재 사실은 다음과 같다.

- Skia Canvas 3.0.8은 exact font를 등록하고 8/8 PNG를 생성했다.
- Playwright 1.63.0 / Chromium 153은 exact font를 CDP로 확인하고 8/8 PNG를 생성했다.
- node-canvas 3.2.3은 현재 Windows Pango 환경에서 pinned OTF/CFF face를 load하지 못해 실패했다.
- Skia와 Playwright는 여러 fixture에서 font size와 line wrapping이 달랐다.
- 자동 pixel diagnostic은 보조값이며 시각 품질 결론이 아니다.

따라서 현재 남은 renderer risk는 구현 가능성보다 실제 bubble fit, clipping,
readability와 packaging/runtime cost의 trade-off를 사람이 판단하는 것이다.

---

## 바로 다음 작업

**Renderer comparison PNG human visual review**

다음 artifact에서 reference, Skia, Playwright와 amplified diagnostic diff를 직접 확인한다.

`spikes/renderer-comparison/outputs/comparison-2026-10-01-v3-contract-aligned/visual-comparison/index.html`

특히 `_004`, `_011`, `_012`, `_047`의 line wrapping, font size,
bubble fit, clipping과 readability를 검토한다.

시각 검토 전에는 renderer를 확정하지 않는다. Skia가 실용적이면 다음 기술 검증은
같은 exact dependency/font를 사용한 Linux smoke와 isolated-process memory 측정이다.
Native 품질이 부족하면 Playwright browser fallback의 배포/runtime 비용을 검토한다.

---

## 이후 순서

`Renderer Candidate Analysis
→ Renderer Comparison Spike
→ 사람의 시각 품질 / 성능 확인
→ Renderer 방향 결정
→ RoverCMT Core migration 시작`

Renderer 방향이 결정된 뒤 필요한 runtime을 작은 smoke test로 exact 조합 검증한다.

- HayaiOCR
- PaddleOCR
- ONNX Runtime + Koharu
- Gemma + selected local server
- selected inpainting backend
- image/render supporting runtime

각 component가 준비되면 대표 실제 페이지로 최소 end-to-end pipeline을 검증한다.

---

## 현재 상태

기존 CarrotMangaTranslator는 계속 reference implementation으로 유지한다.
RoverCMT production code는 아직 작성하지 않는다.

현재 checkpoint의 다음 행동은 생성된 comparison PNG의 human review와
Skia native 방향 또는 Playwright browser fallback 방향에 필요한 후속 검증 범위를
결정하는 것이다.
