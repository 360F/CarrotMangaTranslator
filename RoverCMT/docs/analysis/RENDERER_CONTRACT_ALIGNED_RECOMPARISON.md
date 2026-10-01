# Renderer Contract-Aligned Re-comparison

## 1. Why a v3 re-comparison was required

The v2 comparison proved that Skia Canvas and Playwright could render all eight fixtures with the pinned portable font, but it did not prove that both candidates received the same production typography contract as the Electron reference. A renderer decision based on v2 would therefore mix backend differences with input and layout-decision differences.

This v3 run is evidence generation only. It does not select a renderer or a RoverCMT production architecture.

## 2. v2 contract flaw

Two mismatches were confirmed:

- The native `shared-layout.ts` treated stored `fontSizePx` as the autofit maximum. Production `overlayLayout.ts` uses a 256px generic upper bound, source-face matching, preferred size resolution, ordinary or non-monotonic fitting, and source-matched bubble refinement.
- The historical Playwright adapter supplied `sourceText: ""`, `confidence: 0`, and `sourceDirection: block.renderDirection` when converting v2 snapshots. Those defaults were not necessarily the source-match inputs used by the Electron reference.

The v2 `_0411` difference, about 35px/3 lines in Skia versus 94px/8 lines in Playwright, could not be attributed to Skia itself.

## 3. Source evidence inherited from Claude

Claude traced the production decision path to:

- `src/renderer/src/lib/overlayLayout.ts`
- `src/renderer/src/lib/sourceFontSizeMatching.ts`
- `src/renderer/src/lib/bubbleFontSizeFitting.ts`
- production wrapping and bubble-slot modules

The portable parts of the decision contract were retained. Backend-specific Canvas measurement remains injected by the isolated native benchmark bridge.

## 4. Working tree state inherited by Codex

At takeover:

- branch and HEAD were `RoverCMT` / `4aafb14c12f49195500a783195991a9e75e652a2`;
- there were no tracked modifications;
- Claude's work was entirely untracked;
- `build-fixtures-v3.cjs`, `generate-reference-v3.cjs`, `src/production-page.cjs`, canonical input JSON, eight frozen page snapshots, eight incomplete reference PNGs, and an Electron profile were present;
- no manifest-v3, candidate runner integration, v3 tests, final comparison, visual report, or analysis document had been completed.

No reset, checkout, restore, or clean operation was used. The incomplete results were preserved during diagnosis and removed only after a verified deterministic replacement existed.

## 5. `ERR_FAILED` root cause and resolution

All eight production reference PNGs were captured before the generator failed at the first font-verification navigation. Requiring `out/main/pageExport.js` alone did not reproduce the problem.

A lifecycle probe reproduced the exact failure:

1. create the only Electron `BrowserWindow`;
2. destroy it;
3. immediately create a font-check window and call `loadURL(file://...)`;
4. Electron has already begun its default quit after `window-all-closed`, so the new navigation is cancelled by `stopLoadingListener` with `ERR_FAILED (-2)`.

Adding a CLI-owned no-op `window-all-closed` listener made the same probe succeed. The generator now holds the application lifecycle until explicit `app.exit`. A Node wrapper removes the isolated Electron profile after the Electron process exits, avoiding the Windows `DIPS-wal` lock that prevented in-process profile deletion.

The fixed wrapper completed successfully, generated eight references and all verification metadata, removed its profile, and reproduced the earlier valid bytes exactly.

## 6. Canonical v3 contract

`fixtures/inputs-v3.json` and its eight `fixtures/pages-v3/*.json` snapshots freeze the production fields needed by reference and candidates, including:

- `sourceText`
- `sourceDirection`
- `textRole`
- `fontRole`
- `fontFamily`
- `confidence`
- `sourceFontFacePx`
- `sourceFontSizeConfidence`
- `sourceFontSizeMethod`
- `sourceFontFaceFallbackPx`

`fixtures/manifest-v3.json` binds those snapshots, render rasters, the exact Noto Sans CJK KR Regular 2.004 bytes, Electron reference PNGs, layout evidence, font verification, and render verification by SHA-256 and byte size.

The source chapter is recorded only as provenance for the one-time freezer. The strict v3 loader and all renderer paths do not read it.

## 7. Reference fairness

Electron reference-v3, Skia, and Playwright all reconstruct the production page through `toProductionPageV3` from the same frozen snapshot. Null optional fields are removed consistently. No renderer adapter adds source-match defaults.

Electron font verification uses the identical production page-export HTML and CDP `CSS.getPlatformFontsForNode` on every leaf text span. All eight pages used the pinned Noto Sans CJK KR Regular custom font with no unexpected fallback.

## 8. Implementation changes

- Added one-time v3 fixture freezer and immutable canonical inputs.
- Added reproducible Electron reference-v3 generator and post-exit profile-cleanup wrapper.
- Added strict manifest-v3 loader with complete hash, byte, PNG dimension, font, verification, and snapshot validation.
- Added runner `--manifest` and `--candidates` support while preserving the default v2 path.
- Changed Playwright v3 to consume `toProductionPageV3` without historical defaults.
- Adapted native layout to production minimum/maximum, source-face cap, page fallback, generic/source-match fit, generated-bubble search, and bubble refinement semantics.
- Added block-level path, fit bounds, source inputs, overflow, lines, and bubble evidence.
- Updated visual HTML to label the selected Electron reference version and show reference, both candidates, and amplified diffs together.
- Retained v2 artifacts unchanged.

## 9. Tests

`npm test` passes 10/10 tests. Coverage includes:

- all required v3 source-match fields;
- eight complete reference-v3 fixtures;
- renderer loading does not read the original chapter;
- v3 is bound to the unchanged v2 manifest and exact portable font;
- canonical page conversion;
- production 256px generic autofit upper bound;
- absence of an `_0411` special case;
- existing v2 loader and failure-isolation tests;
- dimension-preserving diagnostic diff behavior.

The Electron wrapper also completed an end-to-end reference regeneration. The regenerated reference PNGs and verification JSON were byte-identical to the independently validated prior capture.

## 10. Run environment

Authoritative run: `outputs/comparison-2026-10-01-v3-contract-aligned/`

- Windows 10.0.19045 x64
- Node.js 24.19.0
- Intel Core i7-9700K, 8 logical CPUs
- 34,288,582,656 bytes system memory
- run-time source HEAD: `4aafb14c12f49195500a783195991a9e75e652a2` with expected uncommitted spike work
- Skia Canvas 3.0.8
- Playwright 1.63.0 / Chromium 153.0.8010.12
- Electron reference: Electron 43.3.0 / Chromium 150.0.7871.212
- pinned font SHA-256: `6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a`

Immutable inputs verified before and after the comparison.

## 11. Fixture results

Skia and Playwright both rendered 8/8 fixtures successfully. Node-canvas was not rerun because the v2 Windows Pango exact OTF/CFF face failure remains a known environment limitation.

Layout comparison summary:

- `_004`: two differing blocks; one line-break difference and one 1px size difference.
- `_011`: three differing blocks; two 1px size differences and line-break differences.
- `_012`: one generic-autofit block differs by 4px, with the same four lines.
- `_015`: two visible 1px size differences; the empty block evidence now matches production null-line semantics.
- `_018`: two 1px size differences with the same lines.
- `_029`: no block layout difference.
- `_047`: five source-match blocks differ by 1-2px and/or wrapping.
- `_0411`: no block layout difference.

All recorded blocks report no overflow.

## 12. `_0411` before and after

Historical v2 diagnostic, first block:

- Skia: about 35px, 3 lines.
- Playwright: about 94px, 8 narrow lines.

Contract-aligned v3, first block:

- canonical path: generic autofit;
- search minimum: 10px;
- search maximum: 256px;
- fit box: 143.333 x 890.035px;
- Electron reference-v3: 94px, 8 lines, no overflow;
- Skia: 94px, the same 8 line strings, no overflow;
- Playwright: 94px, the same 8 line strings, no overflow.

The second `_0411` block is source-match in the frozen input (`sourceFontFacePx` 20.6423, confidence 0.6837, method `raster-core-v1`). Electron, Skia, and Playwright all selected 24px and one line. Skia recorded a resolved 24px cap and bubble-slot use; production page-export does not expose those two internal values directly.

No fixture-specific constant or `_0411` branch exists.

## 13. Performance

| Candidate           | Success | Cold start | First render | Warm mean | Eight-page total |
| ------------------- | ------: | ---------: | -----------: | --------: | ---------------: |
| Skia Canvas         |     8/8 |   46.31 ms |    890.18 ms | 476.20 ms |       4223.59 ms |
| Playwright Chromium |     8/8 |  503.84 ms |   1212.43 ms | 773.71 ms |       6628.41 ms |

Observed memory snapshots:

- Skia process RSS: 72.2 MiB initial minimum to 320.5 MiB observed maximum.
- Playwright browser process tree after render: 333.3 MiB to 446.1 MiB.

These are one-run observations, not steady-state capacity or cross-platform guarantees.

## 14. Pixel diagnostics

| Candidate           | Mean normalized RGB absolute error | Mean changed-pixel ratio |
| ------------------- | ---------------------------------: | -----------------------: |
| Skia Canvas         |                         0.00928934 |               0.02815567 |
| Playwright Chromium |                                  0 |                        0 |

Playwright output was byte/pixel identical to Electron reference-v3 for all eight fixtures in this run. This is expected evidence that the same production HTML contract was reconstructed successfully; it is not a renderer selection criterion.

Skia `_0411` diagnostic values were 0.01400479 mean normalized RGB error and 0.02889949 changed-pixel ratio. Pixel diagnostics remain aids only and are not pass/fail thresholds.

## 15. Remaining backend differences

Skia still differs from production Chromium in rasterization and in some text measurement decisions. The meaningful remaining layout differences are concentrated in source-match blocks, especially `_047`; selected sizes differ by 1-2px and several line breaks differ. `_012` has a 4px generic-autofit difference. These need visual evaluation for readability, centering, clipping, stroke appearance, and bubble balance.

Playwright's production page-export evidence does not expose resolved source cap or actual bubble-slot selection. The report marks those fields as unavailable rather than inventing values.

## 16. Human visual review pending

The review artifact is:

`outputs/comparison-2026-10-01-v3-contract-aligned/visual-comparison/index.html`

It places Electron reference-v3, Skia, Playwright, and amplified absolute diffs in the same fixture section. The local image-view helper failed with a Windows sandbox setup-refresh error, so no renderer-quality conclusion was made by the agent. Human visual review remains required.

## 17. Unresolved questions

1. Are the remaining Skia source-match wrapping differences visually acceptable?
2. Does `_012` remain well balanced despite the 27px versus 23px generic-autofit difference?
3. Do `_004`, `_011`, and `_047` show any clipping or materially worse reading rhythm?
4. Should native source-face conversion be calibrated only through a general cross-backend measurement contract, not reference-specific tuning?
5. Is a Linux run with the same Skia/font versions required before the architecture decision?
6. Which isolated steady-state workload should be used for production memory measurement?

## 18. Exact next step

Open the v3 visual comparison HTML and review all eight fixtures, prioritizing `_004`, `_011`, `_012`, and `_047`. Record a human judgment for readability, wrapping, centering, clipping, outline quality, and bubble balance. Only after that review should the project define the next validation scope for native Skia or browser-backed rendering.

No renderer winner is selected by this work.
