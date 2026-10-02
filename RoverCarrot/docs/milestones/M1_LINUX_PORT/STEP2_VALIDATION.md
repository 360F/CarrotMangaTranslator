# M1 Step 2 — Detection implementation validation

[Implementation plan / status](IMPLEMENTATION_PLAN.md#step-2--detection--koharu)
· [M1-DETECT-001](CURRENT.md#m1-detect-001--koharu-layout-onnx-linux-runtime)

2026-10-02 implementation-session evidence. Final acceptance belongs to the
independent validation session and user checkpoint; no numerical tolerance or
DONE decision was invented. Step 3 has not started.

## Boundary and preserved behavior

`runCli` composes `koharuDetectionStage(runtime)` → real output parser → sealed
region geometry/subdivision → DetectionResult → blocks/effect review → existing
Core/pipeline/persistence. The Detection stage declares its page reads/writes.
Core and pipeline do not import adapters. The original fork `fd461737` source was
read only; parser/geometry/subdivision were copied into independent Rover code.
Import paths, unused lint suppression and type-only index assertions changed;
thresholds, grouping, ordering and geometry constants did not.

The old Page contract lacked `blockOrder`, `soundEffectReview` and the empty
detection marker; optional fields now preserve these persisted values. Config
adds optional `models.koharu`, required by the production CLI when detect is
selected. This is a minimal extension, without redesigning the orchestration.

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
  initial font/style metadata. Rover additionally persists ordered provenance
  `sourceDetectionIds`/region identifiers on blocks (reference only stored
  dialogue provenance in the region manifest).
- Existing blocks/empty marker skip detect unless internal `overwrite` is true;
  overwrite clears stale translation receipts. No user CLI rerun/overwrite flag.
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
Windows Electron 43.3.0 with an isolated profile decoded/resized the same original
page. Supplying that tensor to Linux CPU recovered reference count/type/order.
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
These differences require independent review, not an invented IoU PASS threshold.
With an identical reference preprocessing tensor the same residual differences
remain; CPU vs the reference DirectML inference is the remaining likely cause
(inference, not proven by a fresh DirectML replay).

Ignored evidence directories retain the first mismatched sharp run, the Electron
tensor control and final portable run. Final portable evidence is
`run-1790948077704/` (normal command); its runtime timings include session creation.
The first CPU session observation was 948.8701900000001ms; it is not a latency
promise. The exact timings and tensor/model hashes remain independently inspectable.

## Four-page user run and ordinary validation

Final actual CLI output: `test-data/output/m1-step2-cpu-20261002-2237/` (ignored).
Four JPG pages persisted 10/2/10/20 dialogue blocks and 0/0/3/0 effects. One CPU
session served all pages, Detect PASS, no raw JSON terminal output or crash.
Session creation 950.7283070000001ms; page inference observations
9131.48793 / 6957.548927999998 / 6700.814727999998 / 6465.290980000002ms
(first includes session initialization); postprocess
89.36279800000011 / 22.820310999999492 / 64.56880100000126 / 438.1417449999972ms.

All four copied original rasters preserve source bytes. 28 pre-existing input/
output files were SHA-256 checked unchanged, and repeating the existing output
returned FAIL without overwrite. Summaries and terminal capture are under the
ignored validation directory. The local user's config was extended only with
`[models].koharu`; existing input/output defaults were retained.

`npm run check` passes typecheck/lint/build and 40 tests; `npm run smoke` passes
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
bbox-only differences still require independent acceptance.

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
