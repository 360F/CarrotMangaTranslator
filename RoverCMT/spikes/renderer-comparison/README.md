# Renderer comparison spike

This isolated harness compares renderer candidates against immutable Carrot Electron references. It is evidence-generation code, not RoverCMT production renderer code, and it does not select a winner.

## Contracts

### Contract-aligned v3 (current)

`fixtures/manifest-v3.json` is the current comparison contract. It binds eight canonical frozen page snapshots, render images, Electron reference-v3 PNGs, layout/font/render verification, and exact Noto Sans CJK KR Regular 2.004 bytes.

Every v3 renderer reconstructs its page through `src/production-page.cjs`. Renderers do not read the original chapter. The one-time `build-fixtures-v3.cjs` freezer is the only v3 step that reads the chapter to copy required source-match fields.

### Historical v2

`fixtures/manifest-v2.json`, `reference-v2-noto-sans-cjk-kr-2.004/`, and `outputs/comparison-2026-09-30-v2/` remain read-only historical evidence. V2 used incomplete native font-size semantics and historical Playwright source-field defaults, so do not use it alone for renderer selection.

`fixtures/manifest.json` remains the Windows-local v1 diagnostic baseline and is also read-only.

## Install and test

From this directory:

```powershell
npm install
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) ".playwright-browsers"
npx playwright install chromium
npm test
```

## Rebuild v3 inputs and reference

The checked canonical fixtures and reference should normally be reused. To regenerate from scratch, first move the existing v3 files out of their authoritative paths; both freezer and generator refuse overwrite.

```powershell
npm run build:fixtures:v3
npm run reference:v3
```

`reference:v3` launches Electron with an isolated profile, keeps the CLI application alive between the production render session and font-verification window, and removes the profile after Electron exits.

## Run v3 comparison

```powershell
npm run compare:v3 -- --output <new-run-name>
npm run compare:v3 -- --output <new-run-name> --fixture _0411.png
```

The v3 script runs Skia Canvas and Playwright Chromium. Node-canvas is omitted because the historical Windows Pango probe could not load the pinned OTF/CFF exact face and correctly rejected fallback rendering.

The generic v2-compatible entry point remains:

```powershell
npm run compare -- --output <new-run-name>
npm run compare -- --output <new-run-name> --candidate skia-canvas
```

The runner refuses to overwrite any output directory.

## Output contract

Each successful fixture/backend records PNG dimensions and SHA-256, duration, observed memory, font evidence, runtime details, line breaks, selected font size, overflow, and layout evidence. V3 native evidence additionally records layout path, search bounds, source-match inputs, resolved cap when available, and bubble-slot usage. Production page-export fields that are not observable are marked unavailable rather than inferred as facts.

`run.json` is the complete machine-readable result. `visual-comparison/index.html` shows Electron reference, candidates, and amplified diagnostic diffs together. Pixel difference is never a pass/fail or winner criterion.

Authoritative checked runs:

- v3: `outputs/comparison-2026-10-01-v3-contract-aligned/`
- historical v2: `outputs/comparison-2026-09-30-v2/`

See:

- `docs/analysis/RENDERER_CONTRACT_ALIGNED_RECOMPARISON.md`
- `docs/analysis/RENDERER_COMPARISON_SPIKE.md`
