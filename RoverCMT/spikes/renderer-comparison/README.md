# Renderer comparison fixtures

This directory contains immutable metadata and normalized final-page snapshots for comparing Skia Canvas, node-canvas, and Playwright Chromium against current Carrot output. It contains no copied library images, reference exports, renderer implementation, or candidate output.

- `fixtures/manifest.json` is the entry point. Paths to Carrot library inputs are repository-relative; reference export paths are absolute because those files are external and read-only.
- `fixtures/pages/<page-id>.json` contains only final renderer-facing page and block state normalized from the authoritative final `chapter.json`.
- Verify every recorded SHA-256 before a comparison run. A mismatch means the fixture is no longer the same fixture.
- The current corpus uses Carrot's implicit default CSS font stack. Every fixture is marked `UNRESOLVED_SYSTEM_FALLBACK`; do not compare renderer typography until one exact font file is pinned and a new Chromium reference is produced with that same font.
- Candidate output belongs in a separate future directory and must never overwrite the referenced Carrot output.

See `RoverCMT/docs/analysis/RENDERER_FIXTURE_CENSUS.md` for census, selection rationale, limitations, and readiness.
## Portable font reference revision 2

`fixtures/manifest-v2.json` is the portable benchmark revision. It preserves the v1 page snapshots and render-image hashes, registers the replaceable font asset `benchmark-default-noto-sans-cjk-kr-regular-2.004`, and points to eight lossless PNGs in `reference-v2-noto-sans-cjk-kr-2.004/`.

- The exact asset is `assets/fonts/noto-sans-cjk-kr-2.004/NotoSansCJKkr-Regular.otf` from upstream tag `Sans2.004` / commit `523d033d6cb47f4a80c58a35753646f5c3608a78`.
- Run `generate-reference-v2.cjs` only when creating a new immutable revision; it refuses to overwrite the existing v2 directory.
- `inspect-portable-font-v2.cjs` verifies all fixture text and unique glyphs through Chromium CDP. The committed evidence is `reference-v2-noto-sans-cjk-kr-2.004/font-verification.json`.
- v1 remains a Windows-local Malgun Gothic diagnostic baseline. Do not rewrite v1 or substitute its references in place.
