# M1 Step 2 — Detection implementation validation

[Implementation plan / status](IMPLEMENTATION_PLAN.md#step-2--detection--koharu)
· [M1-DETECT-001](CURRENT.md#m1-detect-001--koharu-layout-onnx-linux-runtime)

2026-10-02 implementation and independent-review correction evidence, plus
2026-10-03 [checkpoint finishing fixes](#checkpoint-finishing-fixes-2026-10-03).
Correction started from clean `main = origin/main = 17e94c03`; finishing fixes from clean `main = origin/main = 644c7ad1`. Status: **DONE — 2026-10-03 사용자 checkpoint 승인**; Step 2 completion commit: [`4e8059e4`](https://github.com/360F/RoverCMT/commit/4e8059e4c071a22bb9e474392cf3a99147cada5a). Implementation commit: [`4a435446`](https://github.com/360F/RoverCMT/commit/4a435446); Phase A checkpoint sync: `1859ad91`. DONE was
decided at the user checkpoint; no numerical tolerance was invented. Step 3 has
not started.

## Boundary and preserved behavior

`runCli` composes `koharuDetectionStage(runtime)` → real output parser → sealed
region geometry/subdivision → DetectionResult → blocks/effect review → existing
Core/pipeline/persistence. The Detection stage declares its page reads/writes.
Core and pipeline do not import adapters. The original fork `fd461737` source was
read only; parser/geometry/subdivision were copied into independent Rover code.
Import paths, unused lint suppression and type-only index assertions changed;
thresholds, grouping, ordering and geometry constants did not.

The Page contract preserves optional `blockOrder` and `soundEffectReview`.
The invalid partial `pageWorkflow` shape and persisted empty-detection marker
were removed after independent review. Config adds optional `models.koharu`: a
blank string is unset, a nonempty value must be absolute, and the production CLI
requires it only when detect is selected. No orchestration redesign was added.

- Original raster → sharp decode → sRGB → black-premultiplied alpha removal →
  Chromium-style fixed-point Lanczos3 stretch → RGB CHW float32 ImageNet
  normalization → `[1,3,1152,1152]`. No EXIF rotation. Grayscale expands to RGB;
  sharp handles CMYK conversion. Full transparent alpha and grayscale are tested.
- Session is lazy, run-owned, sequential CPU and shared across all pages;
  creation follows the reference thread cap (1–8 intra-op, 1 inter-op), then
  release. No raw tensor/mask persistence or cross-stage result cache.
- Dialogue only becomes ordinary blocks. Effect regions stay in contract-v3
  review state and are excluded from staged OCR/automatic translation.
- Blocks retain normalized bbox, confidence, source direction `horizontal`,
  production presentation defaults, geometry key, optional subdivision and
  initial font/style metadata. Strict blocks omit `sourceDetectionIds`,
  `regionId` and `regionType`. Runtime manifests and developer validation retain
  dialogue provenance; production dialogue artifact persistence is a follow-up.
  SFX review keeps its schema-supported source IDs.
- Existing blocks skip detect unless internal `overwrite` is true;
  overwrite clears stale translation receipts. Empty detection runs again when
  called internally; a persisted rerun marker awaits full receipt semantics.
  No user CLI rerun/overwrite flag.
- CLI still accepts only `--input`/`--output`. Fake runtime injection is the
  internal `runCli({ runtime })` argument. Tests pass deterministic raw tensors
  through real parsing/geometry/stage/persistence. Executable config creation,
  existing-output failures and missing-model failures remain subprocess tests;
  the success path uses internal entry invocation. Progress/timing/log/byte and
  persistence assertions remain, with block/effect assertions added.
- Other stages remain Step 1 no-ops; their PASS lines do not claim OCR/translation,
  rendering or a completed translation receipt. The existing `mode="smoke"`
  label and output naming have been retained.

## Model and runtime (S0/S1)

`<KOHARU_MODEL>` is the existing local model, referenced in ignored config/context;
it was not copied into the repo, downloaded or staged.

| Check | Evidence |
|---|---|
| Filename | `rfdetr-seg-2xlarge.onnx` |
| Bytes | 148,442,003 |
| SHA-256 | `7cc10d4316371946b8441da3512261a8e148b129abcdb0ea6235ed1d1d06d351` |
| Input | `input`, float32 `[1,3,1152,1152]` |
| Outputs | `dets [1,300,4]`, `labels [1,300,5]`, `masks [1,300,288,288]`, float32 |
| Runtime | exact `onnxruntime-node 1.27.0`, Linux x64 CPU in-process |
| Native load | successful; `onnxruntime_binding.node`, `libonnxruntime.so.1` in `bin/napi-v6/linux/x64` (arm64 files also bundled) |
| Provider inventory | reported CPU/WebGPU bundled; CUDA/TensorRT not bundled; no Linux CUDA provider binary found. Selected CPU only |
| Repro install | `npm ci --ignore-scripts` succeeded in a new isolated install directory; no CUDA installation or network-request tracing |

Environment: Ubuntu 26.04.1 / Node 24.21.0 / npm 11.19.0; exact OS release, CPU
identity and native metadata are in ignored evidence. GPU is not required for
this CPU baseline. One observed run is not a performance benchmark.

## Reference binding (D31)

`<CARROT_DATA_ROOT>` is the development data root identified read-only by its
`library/works`, run manifests and verified model identity. Installed-app data
also exists; the development root's chapter/page/run binding was used throughout,
without mixing artifacts from the two roots.

- Work: `302a1e8a-7059-4644-8e23-ba0ef85f8d14`
- Chapter: `592a103c-0f9b-4416-bff5-8ec3a985600d`
- Page: `e311fd1f-0bf2-4fc1-99f5-646dc1be76c2`, 1280×1791 PNG
- Run: `1336145f-d411-40fe-a4b6-3632228d430d`, `attempt-1/hayai-regions.json`
- Original page SHA-256:
  `c40b59681cd8863503d275fea98a1a662cdf423c95ed5654d44a5ce2d551def7`

Actual absolute paths exist only in Git-ignored
`test-data/validation/m1-step2/validation-context.json`, which binds `dataRoot`,
`model`, `chapter`, `pageId`, `page`, `reference`, `modelSha256`. No credentials are
stored. Existing Carrot/library/model data was not changed or moved.

## Preprocessing investigation

The first sharp-native `resize(...kernel: 'lanczos3')` run yielded dialogue/effect
7/8 instead of reference 6/9. Thresholds/postprocessing were not adjusted.
An Electron 43.3.0 control decoded/resized the same original page. Historical
metadata did not record platform, so the earlier Windows attribution is
withdrawn. Independent review confirmed **Electron 43.3.0 / Chromium
150.0.7871.212 on Linux** in `m1-step2-independent/electron-ref/` metadata, with
the same tensor hash. Supplying that tensor to Linux CPU recovered reference
count/type/order. Future tool metadata includes `platform` and `arch`.
Compared with Electron, the sharp resize had 1,861,116 differing values out of
3,981,312, normalized mean absolute delta 0.010097108917163216 and max
0.3501400947570801. Thus using the name "Lanczos3" alone did not reproduce pixels.

The portable resize now reproduces Chromium software filter computation:
float32 weights, 14-bit fixed coefficients, center residual correction and
integer truncation after both passes. This preserves the verified production
resize meaning instead of tuning detector outputs. On this real opaque PNG and
the tracked synthetic RGB PNG, all CHW values match Electron exactly.

- Real-page tensor hash:
  `5b8a7084d75183e0d86aa3a412979d21d8e63eb8a8e36e26c271d5eb3735f529`
- Synthetic `tests/fixtures/page.png` tensor hash (automated characterization):
  `cb62ba6ec5bcec2be808b280ffd5bb65402cdf007f6942b334280ecfad3c8fa8`

Sources: [Electron 43.3.0 native image implementation](https://github.com/electron/electron/blob/v43.3.0/shell/common/api/electron_api_native_image.cc),
[Chromium filter policy](https://github.com/chromium/chromium/blob/main/skia/ext/image_operations.cc),
[convolution](https://github.com/chromium/chromium/blob/main/skia/ext/convolver.cc).
[Electron docs](https://www.electronjs.org/docs/latest/api/native-image) describe
quality as platform dependent and no EXIF decoding;
[sharp colour](https://sharp.pixelplumbing.com/api-colour/) and
[alpha operations](https://sharp.pixelplumbing.com/api-operation/) document the
portable decode operations. Chromium BSD notices are retained in
[THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md).

Limits: matching these two opaque PNGs does not establish all-format pixel parity.
JPEG/CMYK/ICC decoder rounding and semitransparent images (flatten before resize
rather than Skia RGBA convolution) may differ. No EXIF rotation was introduced;
no preprocessing cache or alternate detector was added.

## Final same-page results (S2/S3/S4)

Final regular portable command (no reference-tensor override) succeeds and leaves
`IN_PROGRESS — IMPLEMENTED, independent validation pending` evidence.

| Comparison | Result |
|---|---|
| Dialogue/effect count | reference 6/9, Rover 6/9 |
| Type/order/provenance | exact in ordered region comparison |
| Dialogue bbox | 6/6 exact, IoU 1 |
| Effect bbox | 7/9 exact; two adjacent region boundaries differ by +4.5px (one left edge, one right edge) |
| All-region IoU min/mean/max | 0.959525094441446 / 0.996616066806934 / 1 |
| Confidence | numeric differences remain; max absolute delta 0.0033999999999999586 |
| OCR subdivision | exact mode/count/boxes/order for all six dialogue regions, including absent subdivisions |
| Raw output shapes | all match expected contract; decode/session/inference/postprocess completed |

Per-region reference/actual, coordinate deltas, confidence deltas and provenance
are in `comparison.json`; subdivision detail is in `subdivision-comparison.json`.
These differences were left to independent review, not an invented IoU PASS
threshold; the effect bbox difference is now accepted for Step 2 only
([acceptance scope](#effect-bbox-difference-step-2-acceptance)).
With an identical reference preprocessing tensor the same residual differences
remain. The two effect +4.5px differences reproduce with Linux ORT CPU graph
optimization `all` and `extended` ([runtime evidence](#config-validator-dependencies-and-runtime-evidence)).
The reference manifest records no execution provider and its DirectML origin is
unconfirmed, so no cause is asserted.

Ignored evidence directories retain the first mismatched sharp run, the Electron
tensor control and final portable run. Final portable evidence is
`run-1790948077704/` (normal command); its runtime timings include session creation.
The first CPU session observation was 948.8701900000001ms; it is not a latency
promise. The exact timings and tensor/model hashes remain independently inspectable.

## Four-page user run (pre-correction) and ordinary validation

Pre-correction four-page CLI output: `test-data/output/m1-step2-cpu-20261002-2237/`
(ignored). It is superseded, not a final output: the actual strict schema rejects
it (FAIL, 58 issues; [Actual unmodified Carrot schema](#actual-unmodified-carrot-schema)).
The post-correction output is in [Fresh S2–S4 and production CLI](#fresh-s2s4-and-production-cli).
Four JPG pages persisted 10/2/10/20 dialogue blocks and 0/0/3/0 effects. One CPU
session served all pages, the CLI reported Detect PASS, no raw JSON terminal
output or crash.
Session creation 950.7283070000001ms; page inference observations
9131.48793 / 6957.548927999998 / 6700.814727999998 / 6465.290980000002ms
(first includes session initialization); postprocess
89.36279800000011 / 22.820310999999492 / 64.56880100000126 / 438.1417449999972ms.

All four copied original rasters preserve source bytes. 28 pre-existing input/
output files were SHA-256 checked unchanged, and repeating the existing output
returned FAIL without overwrite. Summaries and terminal capture are under the
ignored validation directory. The local user's config was extended only with
`[models].koharu`; existing input/output defaults were retained.

The original implementation run passed typecheck/lint/build and 40 tests; `npm run smoke` passes
15 tests; `npm run check:boundaries` passes. Ordinary validation needs no real
model, real config/logs or private comic. It covers preprocessing, malformed
output, thresholds, subdivision, skip/overwrite, model identity failures,
inference failure, stage failure persistence/downstream skip and CLI/log isolation.

## Independent rerun

From `RoverCarrot/`, after `npm ci --ignore-scripts`:

```bash
npm run check
npm run smoke
npm run check:boundaries
npm run validate:detect -- --model <KOHARU_MODEL> --data-root <CARROT_DATA_ROOT>
```

The default context path is the ignored binding above. For another machine,
create a matching context with actual absolute paths and pass
`--context <LOCAL_CONTEXT>`; do not copy personal paths into tracked documents.
Every validation invocation creates a new evidence directory, or accepts
`--output <NEW_EVIDENCE_DIR>`; missing data/model/context is an error, never
SKIPPED→PASS. A mismatched count/type/order returns BLOCKED/nonzero. Exact or
bbox-only differences still require independent acceptance. The terminal summary
prints count/type/order as the status gate and provenance/subdivision as
informational results; a provenance or subdivision mismatch is shown but does
not change status or exit code.

Optional preprocessing control, with an existing reference Electron executable:

```text
<REFERENCE_ELECTRON> tools/electron-detect-preprocess.mjs <REFERENCE_PAGE> <NEW_ELECTRON_EVIDENCE_DIR>
```

Use Windows-compatible paths when invoking the Windows executable from WSL.
The tool writes `electron-chw.bin` and metadata with an isolated profile.
Then compare/control inference via the separate developer validator:

```bash
npm run validate:detect -- --context <LOCAL_CONTEXT> --reference-tensor <ELECTRON_CHW_BIN>
```

This option belongs only to the developer validator, not the product CLI. It is
not fake runtime selection. The normal S2–S4 command must also be rerun without it.


## Independent-review correction (H1/M1/L1/L2/L4/L5/L6)

The review reproduced Detection but found a strict persistence regression.
`src/shared/ipcLibrarySchemas.ts` uses strict stored pages and blocks. A present
`pageWorkflow` requires all `PageWorkflowReceiptSchema` fields (`runId`,
`planKey`, `steps`, `findings`); the previous partial object was invalid even
when serialized as `{}`. `TranslationBlockObjectSchema` rejects the three
Rover-only provenance keys. The earlier Step 1 guard and smoke assertions had
incorrectly blessed those values. They now require their absence and assert the
persisted permitted fields, defaults, confidence, bbox, block order, review and
subdivision, using actual raw-tensor → stage → chapter writes.

No fake full receipt was created. Core's partial receipt shape was removed.
Existing-block skip and internal overwrite tests remain; empty-result rerun
markers are deferred until full receipt semantics exist. Production dialogue
provenance is used in `HayaiRegionManifest` at runtime, but there is no new
production run artifact writer. Persisting it outside strict records is a
follow-up; developer evidence retains actual manifests. Downstream subdivision
remains in the schema-supported `workflowOrigin.ocrSubdivision`. No resume,
artifact framework or stage-context redesign was introduced.

### Actual unmodified Carrot schema

Development-only bundling used **esbuild 0.25.12 + zod 3.25.76 in /tmp**, loading
this repository's actual root `LibraryChapterFileSchema` without source edits.
No root install, root dependency or tracked validation dependency was added.
Ordinary Rover tests use their own detection-only persisted-field assertions.

| Target | Actual strict parse |
|---|---|
| Reference Carrot chapter | PASS, zero issues |
| Existing Step 1 output (`manual-step1-001`) | PASS, zero issues |
| Prior Step 2 output (`m1-step2-cpu-20261002-2237`) | FAIL, 58 issues |
| Prior Step 2 with only block-key removal (in-memory copy) | FAIL, 16 receipt issues |
| Prior Step 2 with only receipt removal (in-memory copy) | FAIL, 42 block issues |
| Fresh fixed Step 2 output | PASS, zero issues |

Detailed issues are in ignored `fix-strict-schema.json`; all original chapters
were read only. Strict parse establishes schema compliance; Windows GUI
open/edit/export remains Step 8 validation.

### Config, validator, dependencies and runtime evidence

- Blank Koharu template now parses as unset. Detect selected without a model
  fails with the actionable `models.koharu ... absolute path` message; excluded
  detect runs without a model. Nonempty relative paths still fail, absolute
  paths parse. Tests cover all four cases, without altering input/output rules.
- Validator Usage now lists `--reference-tensor`. Comparison reports separate
  `sameType`, `sameOrder`, `sameProvenance`, `sameSubdivision`. Order uses unique
  mutual-best geometric overlap per region array, independently of IDs. Ties,
  absent overlap and non-bijective correspondence are unresolved/BLOCKED. This
  is identity correspondence, not an IoU acceptance threshold. Tests include
  ID-only changes, actual reorder, bbox residuals, type/subdivision/count
  differences and ambiguity. Provenance compares source IDs directly between
  reference/actual manifests; removal from blocks did not remove this check.
- Root's `onnxruntime-node` scoped `adm-zip: ^0.6.0` override was mirrored.
  Only adm-zip changed in the lock (0.5.18 → 0.6.1); no unrelated upgrades.
  `npm ci --ignore-scripts` succeeded in a new /tmp install and Rover's own
  dependency directory, with zero reported audit vulnerabilities. The new
  isolated source/test copy passes without a model, user config/logs or parent
  dependencies: check 44/44, smoke 15/15, boundaries PASS.
- Historical Electron artifacts without platform evidence are no longer called
  Windows controls. Confirmed Linux version/hash are recorded above. This does
  not claim Windows decoding parity for all formats.
- `graphOptimizationLevel: 'all'` is unchanged, matching reference Carrot CPU.
  In the independent review's control on this one reference page, the two
  effect +4.5px differences reproduced with Linux ORT CPU `all` and `extended`;
  `basic` and `disabled` matched all 15 reference bboxes. The review's note that
  `basic`/`disabled` ran slower is a single measurement per level, not a
  performance comparison; no repeated, multi-page or variance measurement
  exists, so no performance or cause conclusion is drawn. No optimization-level
  change was made.

### Fresh S2–S4 and production CLI

Normal `npm run validate:detect` creates `run-1790952491541/`, using the existing
model/context binding with no reference tensor override. Model size/full SHA
and native metadata passed. S2 inference succeeded; tensor hash is unchanged.
Its **entire actual manifest equals the prior final portable manifest**.

S3 remains dialogue/effect **6/9**, same count/type/geometric order/provenance.
Dialogue bbox 6/6 exact; effects 7/9 exact, effects at zero-based orders 5/6 have
+4.5px left/right edge deltas. IoU min/mean/max remains
**0.959525094441446 / 0.996616066806934 / 1**. Maximum absolute confidence delta
is **0.0033999999999999586**. S4 mode/count/crop boxes/order remains exact for all
six dialogue regions. No thresholds, parser, grouping, subdivision or
preprocessing changes were made.

Fresh production output: `test-data/output/m1-step2-fixed-20261002-234923/`.
Detect PASS; four JPG pages have **10/2/10/20 blocks and 0/0/3/0 effects**.
One actual CPU session serves all pages; stdout has no raw JSON, stderr empty.
Session creation 896.5634440000001ms; page inference
8865.094149 / 6947.933069000001 / 6974.107545999999 / 6387.03844ms (first includes
session initialization). Original raster bytes are exact. Re-running the same
output is refused and all output file hashes remain unchanged. All 55 baseline
input/output/config/root-package files remain byte-identical. Root node_modules
was absent at start and remains absent; reference source/lock is unchanged.
Local source check passes typecheck/lint/build, **44 tests**, **15 smoke tests**,
and boundaries. Evidence lives in ignored `fix-run-summary.json`, CLI captures,
`fix-bbox-audit.json`, and per-page developer manifests, never staged.

### Persisted bbox correction details

Normalization now exactly follows reference `pixelsToBbox`/`clampBbox`: divide
then multiply by 1000, finite-value clamp, x/y at most 999, w/h within
1..1000-x/y. Right/bottom-edge regression tests cover the previous escape.
S3 manifest coordinates are unchanged. Re-inference of all four source pages
reproduced every old persisted bbox with the old normalization; applying the
actual root reference helper to those same pixel boxes exactly equals every new
bbox. Confidence/subdivision remain unchanged. **33 of 42 blocks** changed
(9/1/7/16 by page), with 54 coordinate values changed; maximum absolute delta
**1.1368683772161603e-13 normalized units**. These are arithmetic-order rounding
corrections, not detector geometry changes or boundary clamp changes on these
four pages. Review geometry is reference-normalized as well.

Page/block below are one-based indices in the fresh chapter's page/block order;
only changed coordinates are listed. Complete boxes and old/new block IDs are
in ignored `fix-bbox-audit.json`.

| Page / block | Coordinate: before → after |
|---|---|
| 1 / 1 | `h`: 22.082152974504247 → 22.08215297450425 |
| 1 / 2 | `x`: 764.028 → 764.0279999999999; `w`: 93.47200000000007 → 93.47200000000005 |
| 1 / 4 | `x`: 652.9166666666666 → 652.9166666666667 |
| 1 / 5 | `x`: 170.278 → 170.27800000000002; `w`: 27.499999999999982 → 27.49999999999998; `h`: 67.22143531633617 → 67.22143531633616 |
| 1 / 6 | `x`: 246.66666666666666 → 246.66666666666669; `y`: 532.3616619452314 → 532.3616619452313 |
| 1 / 7 | `w`: 76.11133333333332 → 76.1113333333333 |
| 1 / 8 | `x`: 38.333333333333336 → 38.33333333333333; `y`: 719.8616619452314 → 719.8616619452313; `h`: 105.41595845136929 → 105.4159584513693 |
| 1 / 9 | `x`: 180.69466666666668 → 180.69466666666665; `w`: 110.83333333333333 → 110.83333333333334 |
| 1 / 10 | `w`: 79.58333333333333 → 79.58333333333334 |
| 2 / 1 | `h`: 25.554768649669498 → 25.5547686496695 |
| 3 / 1 | `x`: 833.472 → 833.4720000000001; `y`: 60.139282341831915 → 60.13928234183192; `w`: 24.027999999999942 → 24.027999999999945 |
| 3 / 4 | `x`: 152.91666666666666 → 152.91666666666669; `w`: 30.97200000000002 → 30.972000000000016; `h`: 53.33286118980167 → 53.332861189801676 |
| 3 / 5 | `x`: 826.528 → 826.5279999999999 |
| 3 / 6 | `y`: 299.72285174693104 → 299.7228517469311; `h`: 216.5269121813031 → 216.52691218130306 |
| 3 / 8 | `w`: 83.0553333333334 → 83.05533333333338 |
| 3 / 9 | `x`: 52.222 → 52.221999999999994 |
| 3 / 10 | `y`: 799.722851746931 → 799.7228517469312 |
| 4 / 1 | `y`: 46.25023607176582 → 46.25023607176581; `w`: 62.22266666666655 → 62.222666666666555; `h`: 178.33286118980166 → 178.3328611898017 |
| 4 / 2 | `y`: 60.139282341831915 → 60.13928234183192 |
| 4 / 3 | `x`: 402.9166666666667 → 402.91666666666663; `y`: 80.97261567516524 → 80.97261567516526; `w`: 37.916666666666664 → 37.91666666666667 |
| 4 / 4 | `x`: 531.3886666666667 → 531.3886666666666; `h`: 63.74929178470255 → 63.749291784702535 |
| 4 / 5 | `y`: 202.50047214353162 → 202.50047214353165 |
| 4 / 6 | `y`: 226.80594900849857 → 226.8059490084986 |
| 4 / 7 | `x`: 264.028 → 264.02799999999996 |
| 4 / 8 | `y`: 337.9169027384325 → 337.91690273843244 |
| 4 / 9 | `y`: 337.9169027384325 → 337.91690273843244; `h`: 91.52738432483477 → 91.52738432483476 |
| 4 / 11 | `h`: 126.24929178470252 → 126.24929178470254 |
| 4 / 12 | `w`: 114.30599999999988 → 114.3059999999999 |
| 4 / 13 | `y`: 532.3616619452314 → 532.3616619452313 |
| 4 / 15 | `x`: 145.972 → 145.97199999999998 |
| 4 / 16 | `x`: 857.778 → 857.7779999999999; `w`: 37.916666666666664 → 37.91666666666667; `h`: 112.36024551463646 → 112.36024551463647 |
| 4 / 18 | `h`: 150.5547686496695 → 150.55476864966948 |
| 4 / 20 | `w`: 51.806 → 51.806000000000004; `h`: 18.610009442870496 → 18.6100094428705 |

This correction left Step 2 **IN_PROGRESS**, pending a new Claude independent
review and user checkpoint; Step 3 OCR had not started.

## Checkpoint finishing fixes (2026-10-03)

Started from clean `main = origin/main = 644c7ad1` to address the Low findings of
the independent revalidation of `644c7ad1`. Detection implementation, geometry,
parser, adapter, pipeline, ORT optimization level, config contract and
dependencies are unchanged. Koharu inference, S3/S4 and the four-page run were not
repeated.

- **Strict persisted-field test (L1):** `tests/persisted-detection.mjs` now
  compares the exact page key set and the exact `workflowOrigin` key set
  (`geometryKey`/`initialFontSize`/`initialFontStyle` always;
  `recognitionBboxes`/`ocrSubdivision` only when the region carries them), and
  keeps the exact block and `soundEffectReview` key checks. A new test asserts
  that the helper rejects both defects below. Mutation re-check of the full suite
  in an isolated copy: with the previous helper, adding `workflowOrigin.regionId`
  or `page.detectionDiagnostics` passed 44/44; with the new helper each fails
  8 of 46 tests (CLI persisted chapter, the helper test and six single-file
  smoke tests), all at the new key-set assertions.
- **Validator summary:** policy unchanged. Count/type/order decide status
  (`BLOCKED`/nonzero on mismatch); provenance and subdivision remain
  informational ([Independent rerun](#independent-rerun); DETECTION §22 S4 asks
  for identical results or a listed difference). The terminal now prints every
  result; replaying the reference and the existing `run-1790952491541/` actual
  manifest, without new inference, gives:

  ```text
  Detection validation: IN_PROGRESS; evidence: <NEW_EVIDENCE_DIR>
    count       same — status gate (dialogue/effect: reference 6/9, actual 6/9)
    type        same — status gate
    order       same — status gate
    provenance  same — informational, status unchanged
    subdivision same — informational, status unchanged
  ```

  `subdivision-comparison.json` `exact` now reuses the same `sameSubdivision`
  verdict (equivalent result). Targeted tests cover provenance-only and
  subdivision-only mismatches (status unchanged) and count/type/order
  mismatches (`BLOCKED`).
- **Wording:** the strict-FAIL pre-correction four-page output is no longer called
  the final CLI output; the optimization-level speed note is limited to its
  single measurement; the DirectML cause attribution was removed.
- Validation: typecheck, lint, build, 46 tests, 15 smoke tests and boundaries pass.

### Effect bbox difference: Step 2 acceptance

User decision (2026-10-03): the two effect-region bbox differences of +4.5px
(zero-based effect orders 5/6; one left edge, one right edge) are accepted for the
current Step 2 acceptance. Dialogue bboxes are exact: 6/6 with IoU 1, with the
same count, type, order, provenance and subdivision (confidence values differ
numerically, as for all regions). The difference is effect-only: it changes only
two `soundEffectReview` region boxes. Effect regions are excluded from dialogue
blocks, staged OCR and automatic translation, so it does not affect current M1
Step 2 dialogue blocks or the OCR/translation path. It reproduces with Linux ORT
CPU graph optimization `all`/`extended`; no cause is asserted. This acceptance is
limited to that scope and defines no numerical tolerance.

These fixes left Step 2 awaiting the user checkpoint. The 2026-10-03 user
checkpoint approved Step 2 as **DONE** on the validation results of `4e8059e4`,
with the accepted effect bbox difference above. Step 3 OCR has not started.
