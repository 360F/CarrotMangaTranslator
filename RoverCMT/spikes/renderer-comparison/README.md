# Renderer comparison spike

This isolated harness compares Skia Canvas, node-canvas, and Playwright Chromium against immutable Carrot reference-v2 output. It is not RoverCMT production renderer code.

## Authoritative input

`fixtures/manifest-v2.json` is the only comparison input contract. It binds eight final-page snapshots, render images, lossless reference PNGs, and the exact portable font asset `NotoSansCJKkr-Regular.otf` 2.004 by SHA-256.

`fixtures/manifest.json` remains the Windows-local v1 diagnostic baseline and is read-only. Do not regenerate or substitute v1 references. Do not rerun OCR, translation, erase, typography, or font inference.

## Run

From this directory:

```powershell
npm install
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) ".playwright-browsers"
npx playwright install chromium
npm test
npm run compare -- --output <new-run-name>
```

The runner refuses to overwrite an existing output directory. Candidate output is written under `outputs/<run-name>/`; fixtures and references are never output targets.

Useful focused options:

```powershell
npm run compare -- --output <new-run-name> --fixture _004.jpg
npm run compare -- --output <new-run-name> --candidate skia-canvas
```

## Output contract

Each successful fixture/backend produces a PNG, duration, dimensions, SHA-256, observed memory, layout evidence, runtime information, and font evidence. Candidate failure is fixture-local and does not stop other candidates.

`run.json` contains the complete run. `visual-comparison/index.html` shows reference/candidate images and amplified diagnostic diffs. Pixel difference is never a pass/fail or winner criterion.

The checked run described in `docs/analysis/RENDERER_COMPARISON_SPIKE.md` is `outputs/comparison-2026-09-30-v2/`.

## Benchmark-only production reuse

The native adapters share a bundle of Carrot's wrapping and bubble-slot algorithms while injecting backend-specific text metrics. Playwright loads the compiled production PageArtwork page-export runtime. Both are explicitly benchmark-only; RoverCMT production runtime does not import parent Carrot source.

See the analysis report for exact versions, environment, timing, memory limitations, font loading, fixture differences, and remaining unknowns.
