# Renderer Comparison Spike Report

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M1 Linux Port](../milestones/M1_LINUX_PORT/README.md) — v2 비교 결과와 renderer 결정 입력
- [M2 Test Set / Benchmark](../milestones/M2_TEST_SET/README.md) — 비교 report 형식 선례

Tracking: [M1 CURRENT](../milestones/M1_LINUX_PORT/CURRENT.md) · [M2 CURRENT](../milestones/M2_TEST_SET/CURRENT.md)

## 1. Scope and decision status

This spike compares Skia Canvas, node-canvas, and Playwright Chromium in an isolated harness using only `fixtures/manifest-v2.json` as the authoritative input contract. It does not change RoverCMT production code, the fixture corpus, reference images, the portable font, or library data.

The work produces engineering evidence for a later renderer decision. It does not declare a winner or select the production architecture. Pixel differences are diagnostics, not an automated acceptance threshold.

## 2. Harness

Location: `RoverCarrot/spikes/renderer-comparison/`

- `src/manifest.cjs`: strict manifest-v2 loading, path safety checks, SHA-256/byte/dimension verification, and before/after immutable inventory comparison.
- `src/shared-layout.ts`: benchmark-only reuse of the selected Carrot wrapping, balanced paragraph, and bubble-slot logic. Text measurement is injected by each backend.
- `src/native-adapters.cjs`: Skia Canvas and node-canvas adapters with explicit font evidence.
- `src/playwright-adapter.cjs`: Chromium adapter driven through the production page-export runtime and CSS, with CDP font inspection on every rendered leaf span.
- `src/run-comparison.cjs`: isolated candidate initialization/render failures, timeouts, timing, observed RSS, PNG and metadata generation, and immutable input verification.
- `src/visual-report.cjs`: side-by-side reference/candidate pages plus amplified absolute RGB differences.
- `test/`: manifest verification and visual-report unit coverage.

The manifest contains eight fixtures: `_004`, `_011`, `_012`, `_015`, `_018`, `_029`, `_047`, and `_0411`. It binds the final-page snapshots, render images, lossless reference PNGs, and exact portable font `NotoSansCJKkr-Regular.otf` version 2.004 by SHA-256.

## 3. Reproducibility and environment

Authoritative run: `outputs/comparison-2026-09-30-v2/`

Recorded environment:

- Windows 10.0.19045 x64
- Node.js 24.19.0
- Intel Core i7-9700K, 8 logical CPUs
- 34,288,582,656 bytes system memory
- Repository commit at execution: `d8b303b`
- `skia-canvas` 3.0.8
- `canvas` 3.2.3 with Cairo 1.18.4, Pango 1.56.4, FreeType 2.14.3
- Playwright 1.63.0
- Chromium 153.0.8010.12
- Carrot reference environment: Electron 43.3.0 / Chromium 150.0.7871.212

The run inventory verified every manifest-bound input before execution and verified the same inventory again after execution. Both checks passed. Each successful PNG also records its dimensions, byte size, and SHA-256.

## 4. Results

| Candidate | Initialization | Successful fixtures | Cold start ms | First render ms | Warm render mean ms | Total render ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Skia Canvas | success | 8/8 | 45.25 | 850.10 | 414.03 | 3748.31 |
| node-canvas | success, exact-font rendering rejected | 0/8 | 633.85 | n/a | n/a | n/a |
| Playwright Chromium | success | 8/8 | 495.85 | 1092.72 | 724.08 | 6161.27 |

Observed memory evidence:

- Skia process RSS after rendered fixtures: 73.7 MiB minimum and 356.1 MiB maximum.
- Playwright browser process-tree RSS after rendered fixtures: 324.0 MiB minimum and 440.3 MiB maximum.
- These are observed snapshots from one run, not steady-state guarantees or a cross-platform benchmark.

### Skia Canvas

Skia rendered all eight fixtures at the manifest dimensions using the exact portable font file. The adapter records the registered family, font path, version, bytes, and SHA-256. Output metadata and PNG checks passed for all fixtures.

### node-canvas

node-canvas initialized, but Windows Pango did not resolve the registered exact face. The probe reported `Sans`; metadata records `actualLoadedFont: null`, `fallbackFaceReported: Sans`, `registrationSucceeded: false`, and `fallbackDetected: true`.

The adapter therefore rejected all eight renders instead of silently producing fallback-font PNGs. These failures were isolated: Skia and Playwright completed normally, and each node-canvas fixture has an explicit failure record.

### Playwright Chromium

Playwright rendered all eight fixtures through the compiled production page-export runtime and production CSS. The benchmark adapter supplied only schema-neutral fields absent from the renderer snapshot but required by the strict production parser.

CDP inspection covered every leaf text span. Each fixture reported the expected Noto Sans CJK KR family/PostScript face and a custom font loaded from the exact manifest-bound font bytes. Output dimensions and PNG checks passed for all fixtures.

## 5. Layout evidence

The harness records backend layout evidence in addition to pixels. Representative differences between Skia and Playwright include:

- `_004`: 38 px versus 35 px selected text size and different line breaks.
- `_011`: two blocks at 27/35 px versus 26/32 px, with different breaks.
- `_012`: the narrow block is 12 px over two lines in Skia versus 23 px over four lines in Playwright.
- `_015`: only an empty-block evidence representation differs (`[]` versus `null`); no non-empty block difference was observed.
- `_018`: two blocks at 30/26 px versus 25/24 px.
- `_029`: two blocks at 40/31 px versus 36/29 px.
- `_047`: no recorded layout-evidence difference.
- `_0411`: 35 px over three lines in Skia versus 94 px over eight narrow lines in Playwright.

These differences identify areas for human review and later architecture trade-off analysis. They are not quality rankings by themselves.

## 6. Pixel diagnostics

Across the eight successful outputs, the diagnostic mean values were:

| Candidate | Mean normalized RGB absolute error | Mean changed-pixel ratio |
| --- | ---: | ---: |
| Skia Canvas | 0.0142957 | 0.0404743 |
| Playwright Chromium | 0.0113727 | 0.0332528 |

The report deliberately does not turn these numbers into pass/fail gates. Reference antialiasing, Chromium version skew, compositing, font rasterization, and backend-specific layout behavior all affect pixel values. The HTML review artifact is the intended human inspection surface.

## 7. Review artifacts

- Run summary: `outputs/comparison-2026-09-30-v2/run.json`
- Visual index: `outputs/comparison-2026-09-30-v2/visual-comparison/index.html`
- Candidate metadata: each candidate directory contains `candidate.json`, per-fixture metadata, PNG output or explicit failure JSON, and layout/font evidence.
- Amplified RGB diff images: `visual-comparison/diffs/`

The environment image-view helper failed during this task because its Windows sandbox setup refresh failed. The HTML report and all PNG/diff artifacts were still generated and preserved, but the assistant could not complete an independent image-viewer inspection in this session. Human visual review therefore remains open.

## 8. Verification

Completed:

- Spike build and unit tests: 4/4 passing.
- Focused root ESLint check for `src/shared-layout.ts`: passing.
- Full v2 comparison: completed with immutable inputs verified before and after.
- Skia and Playwright: 16 successful PNGs total, all at expected dimensions.
- Candidate failure isolation: verified by the eight node-canvas exact-font failures while other candidates completed.

The repository-wide lint command is not clean for this isolated spike. The current global lint scope scans downloaded Playwright browser JavaScript, generated `lib` output, and CommonJS comparison/reference helpers while enforcing renderer-oriented `require` restrictions. Minor local warnings found during the run were fixed, but global lint configuration and existing reference helpers were intentionally not changed as part of the spike.

## 9. Decision inputs still needed

Before selecting a production renderer, reviewers should decide:

1. Whether Chromium-compatible page-export parity is more important than the lower cold-start and render times observed for Skia in this run.
2. Whether the recorded Skia line-breaking and selected-size differences are acceptable or require further layout calibration.
3. Whether node-canvas should be dropped on the basis of the Windows exact-font failure or retested on the target Linux deployment environment.
4. Which steady-state workload and memory sampling method should be used for a production capacity benchmark.
5. Whether Chromium 153 versus the Electron reference Chromium 150 version skew needs a pinned follow-up run.

No renderer winner or RoverCMT production architecture is selected by this report.