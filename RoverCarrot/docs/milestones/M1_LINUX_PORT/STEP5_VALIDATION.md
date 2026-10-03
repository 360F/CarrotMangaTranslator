# Step 5 — Typography / Layout validation

Implementation-agent evidence, 2026-10-03. Started at clean `099d8584`, verified
starting state supplied by Claude; handoff baseline `fb652920`. Reference is
read-only fork `fd461737`. Steps 3/4 remain provisional, independent review
DEFERRED. This document does not mark Step 5 DONE or edit handoff/ledger state.

Implementation and CPU self-validation are ready for Claude's first-pass review.
Real four-page GPU OCR/managed translation E2E and fresh Electron decoder checks
are **prepared, not executed** here. Stored runtime differences below remain
unaccepted; no tolerance was added.

## Requirements and source trace

Authority: [Step 5 Scope / Validation](IMPLEMENTATION_PLAN.md#step-5--typography--layout),
[Reference-driven validation](IMPLEMENTATION_PLAN.md#reference-driven-validation),
[M1 baseline decision](CURRENT.md#m1-baseline-decision-2026-10-03).
D17 remains OPEN/nonblocking: autoFont=false implemented, autoFont=true refused.
D18 source trace is supplied in the new
[TYPOGRAPHY_LAYOUT_SOURCE_TRACE](../../analysis/TYPOGRAPHY_LAYOUT_SOURCE_TRACE.md).
Existing analysis documents were not edited.

Important traced behavior:

- Typography input is `workflowOverlayItems`, including geometry locks, OCR
  source-line evidence and fixed-block candidate membership. Recognition segments
  are used only when workflow geometryKey matches the current region.
- `estimatePageSourceFontSizes` measures original BGRA raster, performs
  reference projection/component/body/peer analysis and may abstain. Non-abort
  errors warn and fail closed; abort propagates.
- AutoFont=false keep mode applies source-size options only for successful
  estimates. `mergeWorkflowTypography` applies the existing eligibility rules and
  size field allowlist. **fontSizePx remains unchanged**; source-match fields are
  deferred glyph-fitting inputs for Step 7. Step 6 can read the existing size.
- `workflowTargetBlocks('layout')` selects overwrite/absent layout. Nonempty
  translatedText is required by `isBubbleLayoutBlockEligible`, along with valid
  bbox, no curveLayout and no inpaintExcluded. Carrot's preflight missing-translation
  check is distinct from final layout execution; partial translation does not
  introduce a new stage failure. Blank translated blocks produce no geometry.
- Original raster is always re-detected by Koharu. `inpaintedImagePath` is used
  with original path in stat-based revision hashing, not as detector input.
- Ownership calculation sees all eligible competitors; persisted patches are
  then limited to target IDs, validated and restricted to render fields. Manual
  layouts are preserved unless explicitly overwritten. Bad/duplicate/unknown
  patches and required detector errors propagate.
- Formatting defaults already exist in Step 2 detection. Keep-block typography
  preserves formatting. No new automatic font matching, typography profile,
  sculpt, renderer, erase implementation or scheduling optimization was added.

## Changed / added files and mapping

| Reference function / area | Rover location / purpose |
|---|---|
| workflowOverlayItems, workflowOcrHints, OCR geometry locks/membership | `src/typography/ported/main/pageWorkflow/pageWorkflowTypographyInput.mjs`, `ported/main/pipeline/*Geometry*.mjs`: exact source inputs |
| sourceFontSizeEstimator and sourceFontSize* family | `src/typography/ported/main/pipeline/sourceFontSize*.mjs`: raster estimator and page-peer refinement |
| applyKeepBlocksSourceFontSize → applySizeOptions | `src/typography/typography.mjs`, `ported/main/pipeline/overlayFontSize.mjs`: autoFont=false keep-mode slice |
| mergeWorkflowTypography / workflowTypographyFields | corresponding `ported/main/pageWorkflow` / `ported/shared` modules: overwrite/manual/initial-size gating and merge |
| nativeImage original BGRA loader | `src/adapters/typography-raster.mjs` + `.d.mts`: sharp sRGB/black alpha flatten/BGRA adapter; injected into estimator |
| layoutWorkflowPage | `src/layout/layout.mjs`, `stage.ts`, `.d.mts`: targets, balanced layout, optional natural-layout behavior |
| bubbleLayoutFacade | `src/adapters/bubble-layout.mjs` + `.d.mts`: stat revision, original-image detection port, job-local cache/retry, required/best-effort behavior |
| processDetectedBubbleLayouts and dependencies | `src/typography/ported/main/bubbleLayout/*.mjs`: association, ownership, mask refinement, spans, padding and renderBbox |
| runBubbleLayoutPostprocess, runner patches, layout state | `src/typography/ported/main/inpainting/*.mjs`: clone/isolation, validation, manual protection and allowlisted state application |
| blockFormat / textWrapping / naturalTextLayout / geometry | `src/typography/ported/shared/*.mjs`: existing formatting and layout helper graph; selected geometry exports avoid editor transforms |
| Rover stages | `src/typography/stage.ts`, `src/layout/stage.ts`: explicit reads/writes/resources, programmatic factories |
| CLI composition / config | `src/cli/app.ts`, `config-file.ts`, `core/config.ts`, `core/contracts.ts`: optional `[typography]` table and adapter composition |
| standalone build / boundaries | `tools/copy-ocr-assets.mjs`, `tests/boundaries.mjs`: local ESM copying and sharp adapter-only allowlist |
| differential / integration tests | `tests/typography-reference.mjs`, `typography.test.mjs`: read-only source oracle and nine focused tests |
| CPU real-data validation | `tools/validate-typography.mjs`: raster/items/estimates, CPU parser, shape/patch/facade differential and all stored-field differences |
| orchestrator tools | `tools/typography-smoke.mjs`, `electron-typography-reference.mjs`: real CLI E2E and unmodified reference raster/preprocess execution |
| documentation | `README.md`, this document, new source trace: use, mapping, evidence and outstanding verification |

`src/typography/ported/source-map.json` lists every copied reference module.
Imports/types were mechanically adapted to local ESM; unused lint directives and
bindings were removed without algorithm changes. Only needed exports of
workflow typography input, keep-block OCR hints and shared geometry were selected.
Automatic font matching dependencies were not copied. The Electron loader seam
requires an injected raster adapter, and the estimator's warning goes through an
injected callback into the run log instead of an Electron/global logger.
No npm dependencies/lockfile or runtime/model assets were added.

## State / runtime coupling

Typography reads original raster path/size, source text/direction/roles, source
bbox/space, recognitionSegments, workflowOrigin and existing size/intent. It writes
only the six size fields plus sizeApplied (and reference fontApplied projection,
with autoFont disabled). Page-peer size refinement couples blocks within a page;
there is no cross-page font profile.

Layout reads original raster and optional inpainted revision, translated text,
source geometry, fontSizePx, outline, render direction/intent and existing layout.
It writes bubbleLayout/renderBbox/renderBboxSpace and optional natural text/direction
state. Koharu CPU session is run-owned and lazily reopened after OCR closes the
initial detection session. Cache is runner/job-local, not a global or cross-stage
raw-output cache. The pipeline is still sequential and owns stage order/commit.
Core and Pipeline import no adapters.

Step 6 reuse is exposed through LayoutRunner: `paddingRatio=0`,
`sharedOwnershipGapPx=0`, `includeTypographySegmentation=true`, best-effort mode.
Job-local shared-group IDs and masks are not persisted as block keys. Step 5 does
not invoke this prepass. Erase and render remain no-ops.

## Self-validation: actual commands and evidence

Commands executed from `RoverCarrot/`. Evidence root:
`test-data/validation/m1-step5/session-20261003-implementation/` (ignored).
All created evidence/output paths were new; existing evidence was preserved.

| Command | Exit / actual result | Evidence |
|---|---|---|
| `npm run check` | 0; typecheck/lint/build, **81/81** Node tests including Step 4 translation/lifecycle regressions | `check-final.log`, `.exit` |
| `npm run smoke` | 0; build, **15/15** existing input/CLI smoke tests | `smoke.log`, `.exit` |
| `npm run check:boundaries` | 0; runtime local, Core/Pipeline adapter-free | `boundaries.log`, `.exit` |
| `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/python` | 0; **14/14** | `python.log`, `.exit` |
| `node tools/validate-ocr.mjs test-data/validation/m1-step5/session-20261003-implementation/ocr-context.json cpu` | 0; reference and Rover processes 0; **3 pages/21 items**, full Python JSON, normalization, stored structure and text/source **21/21 exact**, no unbound/top-level differences | `ocr-cpu.log`, `.exit`, new `differential-cpu-*/comparison.json` |
| `node tools/validate-typography.mjs test-data/validation/m1-step3/validation-context-durable.json <KOHARU_MODEL> test-data/validation/m1-step5/cpu-differential-20261003-4` | 0; **46 nonempty pages/260 blocks/248 estimates**, **5 layout pages/21 patches**, fresh reference exact; stored differences below | `differential-final.log`, `.exit`; `cpu-differential-20261003-4/comparison.json`, `chapter.json` |
| `node /tmp/step5-cpu-stage.mjs` | 0; **real Core→pipeline→typography→erase(no-op)→layout→libraryPersistence**, fixed translated page, 2 source-matched/layout blocks saved into new output | `cpu-stage.log`, `.exit`, `cpu-stage-summary.json`, copied `cpu-stage.mjs` |
| `node /tmp/step5-schema.mjs test-data/validation/m1-step5/cpu-differential-20261003-3/chapter.json test-data/validation/m1-step5/session-20261003-implementation/strict-schema-final.json` | 0; actual unmodified Carrot LibraryChapterFileSchema, 53 pages/248 source-match blocks/21 layouts, **zero issues** | `schema-final.log`, `.exit`, `strict-schema-final.json` |
| `node /tmp/step5-schema.mjs test-data/output/m1-step5-cpu-stage-20261003-1/works/14c6579a-f536-4675-bfe6-745bac879f6f/chapters/07024d85-2be3-4d6f-9c19-52907cb32efb/chapter.json test-data/validation/m1-step5/session-20261003-implementation/strict-schema-cpu-stage.json` | 0; real persisted stage output, 1 page/2 source-match/layout blocks, **zero issues** | `schema-cpu-stage.log`, `.exit`, `strict-schema-cpu-stage.json` |
| `node /tmp/step5-difference-analysis.mjs` | 0; exact in-memory vs persisted distinction; all 59 persisted differences recorded | `difference-analysis.log`, `.exit`, `.json` |
| `npm run lint` after validation-tool metadata extension | 0 | `lint-final.log`, `.exit` |
| `git diff --check` (read-only) | 0 | terminal |

`<KOHARU_MODEL>` was exactly the installed pinned Step 2 ONNX file; the real path
is recorded in ignored `e2e.toml`, not in tracked files. OCR context is a byte copy
of `m1-step3/validation-context-durable.json`, preserving all input bindings and
sending new outputs beside the copy. CPU OCR is a real Hayai execution, not a mock.

Schema bundling used existing `/tmp` esbuild **0.25.12** and zod **3.25.76**,
rebundling root `src/shared/ipcLibrarySchemas.ts` read-only into a new `/tmp` file.
Script copies are in new evidence. No root install or runtime dependency was added.
Strict parse establishes schema compliance, not Windows GUI open/use (Step 8).

Earlier logs are preserved, not acceptance evidence: initial unused bindings,
missing selected geometry exports, unconditional smoke composition, insufficient
synthetic fixture, first differential missing parent directory, and a TOML
null-prototype test assertion failed. These were corrected; no comparator tolerance
was introduced. The existing model-free smoke contract is retained. Synthetic
size fixture uses a single CJK glyph supported by the reference's single-glyph path;
real 260-block comparison independently covers complex source-size behavior.

## Fresh reference and fixed-input binding

Source functions are transpiled in memory from **unmodified root TS**, not from
Rover port files. The source oracle isolates typography overlay input/keep-block
OCR helper exports, retaining their actual called dependencies. Model/image/log
ports are supplied explicitly; the tests never claim an Electron decoder run.

The installed chapter binding is
`library/works/e87507ab-c752-4f9b-b0c0-75901c4c1110/chapters/0a4d6eaf-de01-4533-887c-10c0ab74c057/chapter.json`:
53 pages, 46 nonempty, 260 blocks. Its SHA-256 plus all raster paths/SHA/dimensions
and BGRA digests are recorded in `comparison.json`. Windows paths are mapped to
read-only WSL raster paths; original path strings remain in typography inputs so
workflow geometry keys are not silently invalidated. Previous source-size fields
and intent are removed in an in-memory **fixed fresh input**, preserving source,
translation, geometry, formatting and origin. Overwrite is explicit for this
validation. Historical input is not reconstructed or claimed identical.

- All 260 overlay items and fresh estimate arrays match reference exactly.
- All typography merged page fields match reference, not only selected size values.
- Five CPU re-detections use approved Step 2 preprocessor/session. Reference output
  parser receives the same full CPU tensors; masks/detections compare exactly.
- Geometry/profile/patch arrays compare exactly on identical detections, no tolerance.
- Reference runner postprocess and full reference facade (injected detection/asset
  ports, real file stats) compare exactly with Rover, including stat revision hash
  and entire returned page/layout state. Reference inference is not claimed as a
  separately launched Windows/DML runtime.
- Five page IDs: `0a2318ed`, `1cda522e`, `d91be91a`, `07140551`, `05a43417`
  (full IDs in evidence). The latter three include Step 3 bound OCR pages; the
  first two layout-bearing chapter pages include all three stored bubble layouts.

The final differential's `runtimeReferenceDifferences=0` means no difference was
found **on the supplied identical CPU inputs**; without the optional Electron
reference directory it is not a claim of independently executed decoder parity.

## Every stored-result difference and analysis

The in-memory comparison records **107 field differences**. **48** are own
properties with undefined values versus absent stored keys, on the 12 abstaining
blocks' fontSizeIntent/sourceFontFacePx/confidence/method. Reference merge also
creates those undefined properties. JSON serialization omits them, so they cause
no persisted difference. The original 107-entry inventory remains preserved;
a separate exact serialized-schema comparison records **59 persisted differences**.
There is no rounding, tolerance, field deletion from comparison, or geometry
normalization used to hide a difference.

| Persisted field | Differences | Analysis |
|---|---:|---|
| fontSizePx, fontSizeIntent, sourceFontSizeConfidence, sourceFontSizeMethod, autoFitText | 0 | Same persisted values/presence for all 260 blocks |
| sourceFontFacePx | 2 | Last binary floating-point digits; fresh unmodified reference produces Rover's values. Full historical decoder/engine execution is not available in stored result |
| renderBbox / renderBboxSpace | 18 + 18 | Fresh layouts on 18 blocks with no stored layout; all three existing render boxes/spaces match exactly. Historical stage selection/input state is not bound |
| bubbleLayout | 21 | 18 newly present; 3 existing differ in revision/confidence; one of those also differs in shape spans, detailed below |

The two exact source-size differences (no tolerance accepted):

- Block `7201de16-…-block-1`: fresh **49.25410759459772**, stored
  **49.254107594597734**; delta **-1.4210854715202004e-14**.
- Block `624f682c-…-block-3`: fresh **61.93699728101624**, stored
  **61.93699728101623**; delta **7.105427357601002e-15**.

Floating-point/engine or historical raster/input variance is an **inference**, not
an established cause. The same fresh root code producing identical Rover values
rules out a detected algorithm-port difference on this fixed raster. Source math
uses repeated square-root/geometric means; no opt-in rounding was added.

For the three existing layouts, sourceImageRevision intentionally differs because
the differential geometry uses a fixed raster-identity revision, while saved
Carrot hashes Windows paths and historical original/inpainted stat values. A
second fresh-facade differential checks actual stat-based hashing separately.
Revision differences alone do not indicate geometry divergence.

- Page `1cda522e` block 1: confidence fresh **0.8100134056933025**, stored
  **0.8107595575473909**; both have 90 spans. **10 span scalars differ**, maximum
  absolute logical-ratio difference **0.003865182436610992**. Render box is exact.
- Page `d91be91a` block 1: confidence fresh **0.8625187847019686**, stored
  **0.8625170564206182**; all 92 spans exact, render box exact.
- Same page block 2: confidence fresh **0.8225480737527266**, stored
  **0.8225481679361097**; all 84 spans exact, render box exact.

Source-mask sampling/profile building is exactly equal to fresh root code on CPU
outputs. Provider/raw-mask variation or historical input is a plausible cause,
but stored artifacts do not bind the original runtime/instance logits and
historical image/stat/padding state. We cannot prove the cause from the chapter.
All differences are retained in full, including spans; no tolerance is introduced.

**Superseded by user decision (2026-10-03):** the historical stored-output differences above are **accepted** for Step 5, scoped item by item in [Known differences: Step 5 acceptance](#known-differences-step-5-acceptance). The original "not accepted / USER_DECISION_REQUIRED" status is kept here as history.

## Known differences: Step 5 acceptance

**User decision (2026-10-03, option (a)):** the historical stored-output differences listed below are accepted for Step 5. Basis: on identical inputs, the unmodified Carrot reference executed fresh and the Rover port agree exactly (260 blocks / 248 estimates / 21 layout patches, `runtimeReferenceDifferences = 0`), so no porting error is identified within the checked scope.

Scope and limits of this acceptance:
- It covers **only the five items in the table** (exact page, block, field and values). It defines **no numeric tolerance** and is **not a precedent**: larger differences, other blocks or fields, observable-output changes or new runtime differences still require their own user decision.
- Comparators are unchanged: they still report these differences (no tolerance, allowlist, normalization or field exclusion was added for them).
- Cause: **unresolved**. The bubble-layout differences are not attributed to Windows DirectML vs Linux CPU or to any other cause; historical runtime, provider, decoder and inputs of the stored chapter are not bound.

Values are read from `test-data/validation/m1-step5/cpu-differential-20261003-4/comparison.json` (`persistedDifferences`). "Fresh reference" and "Rover" are equal for every item (`runtimeReferenceDifferences = 0`); "historical" is the stored Carrot `chapter.json` value.

| # | Page | Block | Field / path | Historical Carrot | Fresh reference = Rover | Abs. difference | Observable output impact | Acceptance | Cause |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `7201de16-dca0-40e0-b987-4439ea8e87ae` | `…-839e2f9e-d369-454e-b160-bf070a38c592-block-1` | `sourceFontFacePx` | 49.254107594597734 | 49.25410759459772 | 1.4210854715202004e-14 | none observed: `fontSizePx`, `fontSizeIntent`, `sourceFontSizeConfidence`, `sourceFontSizeMethod`, `autoFitText` equal | accepted (Step 5 only) | unresolved |
| 2 | `624f682c-0b82-48b2-a682-18defc17f3cb` | `…-eae11d14-1d3d-4c36-aa8c-d5c7abd1c3a8-block-3` | `sourceFontFacePx` | 61.93699728101623 | 61.93699728101624 | 7.105427357601002e-15 | none observed (same fields as #1 equal) | accepted (Step 5 only) | unresolved |
| 3 | `1cda522e-5799-4dac-a6e0-dc1c26e987d1` | `…-c2a05d60-d05c-4b8b-9639-63d0f7164001-block-1` | `bubbleLayout.confidence`; `bubbleLayout.regions[0].spans[*]` | confidence 0.8107595575473909; spans: 90 | confidence 0.8100134056933025; spans: 90 | confidence 7.461518540884e-4; 10 of 360 span scalars differ, max 0.003865182436610992 (e.g. span 15 `inlineStart` 0.17988559059987627 → 0.17602040816326528) | `renderBbox` / `renderBboxSpace` exactly equal; span shape differs for the renderer's text slots (renderer is Step 7; not measured here) | accepted (Step 5 only) | unresolved |
| 4 | `d91be91a-5ecc-45c7-9e46-a1384e2156d5` | `…-7d57d884-f739-4967-b862-24e753d24afd-block-1` | `bubbleLayout.confidence` | 0.8625170564206182 | 0.8625187847019686 | 1.7282813504e-6 | all 92 spans and `renderBbox` exactly equal | accepted (Step 5 only) | unresolved |
| 5 | `d91be91a-5ecc-45c7-9e46-a1384e2156d5` | `…-7d57d884-f739-4967-b862-24e753d24afd-block-2` | `bubbleLayout.confidence` | 0.8225481679361097 | 0.8225480737527266 | 9.41833831e-8 | all 84 spans and `renderBbox` exactly equal | accepted (Step 5 only) | unresolved |

Also recorded, not part of the acceptance: `bubbleLayout.sourceImageRevision` differs on items 3–5 because the differential uses a fixed raster-identity revision while the stored value hashes historical Windows paths/stats (a separate fresh-facade check covers stat-based hashing); and 18 blocks have fresh `bubbleLayout`/`renderBbox` where the stored chapter has none (historical stage selection/input state is not bound). These are not output divergences on the same inputs.

**Fresh reference execution environment** (for interpreting the parity above): Linux x86_64 (Ubuntu 26.04.1 LTS on WSL2), Node.js 24.21.0; reference = unmodified root TypeScript of fork `fd461737`, transpiled in memory and executed read-only (never the Rover port); raster decode via sharp (same decoder as Rover; not Electron `nativeImage`); Koharu layout re-detection with the Step 2 pinned `rfdetr-seg-2xlarge.onnx` (SHA-256 `7cc10d4316371946b8441da3512261a8e148b129abcdb0ea6235ed1d1d06d351`) on `onnxruntime-node` 1.27.0 **CPU** in-process (no GPU); the reference output parser receives the same CPU tensors. Dataset: installed-app Carrot chapter `library/works/e87507ab-…/chapters/0a4d6eaf-…` (53 pages, 46 non-empty, 260 blocks), all raster SHA-256/dimensions/BGRA digests in `comparison.json`. Command (from `RoverCarrot/`): `node tools/validate-typography.mjs test-data/validation/m1-step3/validation-context-durable.json <KOHARU_MODEL> test-data/validation/m1-step5/cpu-differential-20261003-4`. Interpretation: **the reference implementation and the Rover port agree in the same Linux/CPU environment**. This does not show equality with the historical Windows runtime; the historical stored-output differences above stay as separate evidence. The prepared Electron decoder check was not run.

## Changes to provisional Steps 1–4 and regressions

- `core/contracts.ts` / `core/config.ts` add only optional typography settings.
  Existing fields/order/path/translation config semantics remain unchanged.
- `cli/config-file.ts` adds optional `[typography]` validation and template comments,
  without personal paths. autoFont=true is refused pending D17. No public CLI flag
  or config location changes. Optional overwrite applies to programmatic existing
  page state; the CLI remains fresh import, not resume.
- `cli/app.ts` composes new stages when managed translation is configured or an
  explicit typography table is supplied. Existing unconfigured Step 4 model-free
  smoke path remains available. Detector close before OCR and managed translation
  session/request/memory lifecycle are unchanged; layout lazily reopens CPU runtime.
- `tools/copy-ocr-assets.mjs` copies new local ESM assets; `tests/boundaries.mjs`
  permits sharp only in the new raster adapter. No Core/Pipeline adapter import.
- Step 2/3/4 algorithm, Python worker, translation modules, runtime recipes,
  pending-memory publication and output refusal were not modified.

All previous 72 Node tests (including Step 4 translation tests), smoke 15, Python
14 and actual Step 3 CPU OCR 21/21 differential passed. No earlier observable
contract change is required or accepted. Existing test-data/runtime builds and
previous evidence were neither altered nor overwritten.

## Exact prepared Claude commands (NOT executed here)

From `RoverCarrot/`, existing model/config bindings are copied into **new ignored**
`test-data/validation/m1-step5/session-20261003-implementation/e2e.toml`.
It points to the four-page Step 4 comic and a new output
`test-data/output/m1-step5-20261003-orchestrator-1`, configured GPU OCR, pinned
b9553 managed Gemma 4 26B Q6_K and typography defaults. The output did not exist
when prepared. Never rerun against an existing output; copy the TOML into a new
evidence directory and change only output for a repeat.

```bash
npm run build
node tools/typography-smoke.mjs test-data/validation/m1-step5/session-20261003-implementation/e2e.toml
node tools/validate-ocr.mjs test-data/validation/m1-step5/session-20261003-implementation/ocr-context.json gpu "$PWD/test-data/runtime/hayai-cu130/bin/python"
```

First command pair invokes production `runCli`, with no fake stage/model. It
requires completed four-page stages, nonempty translations, source-match fields,
no failed layout events, and no inpaintedImagePath (erase still no-op). It reports
actual persisted chapter path and per-page block/translation/size/layout counts.
Not every block must be translated: Step 4's established missing-slot behavior is
preserved. Inspect source fields, eligibility, geometry, managed session exit and
GPU worker cleanup, and strict-parse that actual chapter with the unmodified schema.
Do not use the Step 4 translation-only smoke tool for Step 5; it deliberately
asserts the Step 4 three-stage selection.

GPU/container operational rules are solely Claude's authorized responsibility;
this implementation agent performed no GPU/container or service action. Follow
[GPU validation 운영](IMPLEMENTATION_PLAN.md#gpu-validation-운영-2026-10-03-사용자-결정)
and preserve owned-process logs and any container restoration evidence.

Fresh decoder/input check with an **existing reference Electron executable**
(`REFERENCE_ELECTRON` must be bound by Claude; no guessed path or installed
Carrot application launch):

```bash
"$REFERENCE_ELECTRON" tools/electron-typography-reference.mjs test-data/validation/m1-step3/validation-context-durable.json test-data/validation/m1-step5/electron-reference-orchestrator-1

```

Resolve the existing model binding from the prepared isolated TOML:

```bash
STEP5_KOHARU=$(node --input-type=module -e 'import {readFileSync} from "node:fs"; import {parseConfigToml} from "./dist/cli/config-file.js"; console.log(parseConfigToml(readFileSync("test-data/validation/m1-step5/session-20261003-implementation/e2e.toml","utf8"),process.cwd()).models.koharu)')
node tools/validate-typography.mjs test-data/validation/m1-step3/validation-context-durable.json "$STEP5_KOHARU" test-data/validation/m1-step5/electron-differential-orchestrator-1 test-data/validation/m1-step5/electron-reference-orchestrator-1
```

The Electron tool executes unmodified reference raster loader, estimator and
preprocessor, saves BGRA/CHW/estimates and engine versions in its new evidence
folder. Optional-directory differential checks raster/CHW hashes and complete
serialized estimate arrays exactly, records mismatches and exits 1 if any. No
Electron execution was performed in this sandbox. If reference Electron is
unavailable, leave this check pending rather than claiming decoder parity.

## Claude orchestrator verification

Implementation of Step 5 in this document: Codex (implementation agent). Validation in this section: Claude orchestrator, first pass, 2026-10-03. Independent review: **DEFERRED** ([Deferred Review Ledger](IMPLEMENTATION_PLAN.md#deferred-review-ledger)).

| Check | Result | Evidence |
|---|---|---|
| `npm run check` / `npm run smoke` / `npm run check:boundaries` / `python3 -m unittest discover -s tests/python` | exit 0: 81/81, 15/15, PASS, 14/14 | terminal |
| Real four-page CLI on GPU (`node tools/typography-smoke.mjs <isolated e2e.toml>`: detect → GPU OCR (cu130) → managed Q6_K translation → typography → erase (no-op) → layout, `HF_HUB_OFFLINE=1`) | exit 0, wall 2:26.66. Blocks 10/2/10/20; translated 10/2/10/18; `sourceFontFacePx` set on 10/2/10/19; `bubbleLayout` + `renderBbox` on 8/2/10/18. 4 page-scoped llama-server children, each SIGTERM → exit 0; no Rover process left | `test-data/output/m1-step5-claude-gpu-r1-20261003-171728/`, `test-data/validation/m1-step5/claude-gpu-r1/` |
| Strict Carrot schema (unmodified root `LibraryChapterFileSchema`, bundled by Claude) on that GPU output | PASS / 0 issues | — |
| User llama-server container (`gemma-heretic`, ID `37542310ef62…`) | stopped with `docker stop` and restored by trap with `docker start` of the same ID; afterwards `running`/`healthy`, restart `unless-stopped`, port 8081, `/health` and `/v1/models` 200 | `claude-gpu-r1/container/` |
| Historical stored-output differences | accepted by the user, item by item: [Known differences: Step 5 acceptance](#known-differences-step-5-acceptance) | — |
| Electron decoder/preprocessor/reference-estimator check | **not run** (no Electron runtime used); decoder parity with the historical Windows run is not claimed | — |

## Scope protection

No Git mutation (including fetch/add/commit/push), handoff/ledger/CURRENT edit,
root reference edit, existing analysis edit, Carrot data-root/model edit,
existing evidence overwrite, runtime/build-output edit, Docker/sudo/apt/system
service operation or termination of other processes occurred. Existing runtime
and settings were read only. The regression suite only controls its own fake
server children. New outputs/evidence were exclusively under Step 5 paths. Local
CPU ONNX sessions were closed after validation. No tracked model/binary/cache or
personal absolute path was added.
