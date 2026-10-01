# Renderer Portable Font Reference

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M1 Linux Port](../milestones/M1_LINUX_PORT/README.md) — portable font 라이선스
- [M2 Test Set / Benchmark](../milestones/M2_TEST_SET/README.md) — manifest revision 선례

Tracking: [M1 CURRENT](../milestones/M1_LINUX_PORT/CURRENT.md) · [M2 CURRENT](../milestones/M2_TEST_SET/CURRENT.md)

## 1. Purpose

Renderer Comparison의 모든 backend가 동일한 exact font bytes를 사용하도록 portable benchmark font를 고정하고, 기존 8개 final snapshots와 render images를 그대로 사용한 Carrot Chromium lossless reference revision 2를 만든다. 이는 RoverCMT 제품의 영구 default-font 결정이나 renderer 구현이 아니다.

## 2. Selected Portable Font

- Asset ID: `benchmark-default-noto-sans-cjk-kr-regular-2.004`
- Role: `default-dialogue`
- File: `NotoSansCJKkr-Regular.otf`
- Family: `Noto Sans CJK KR`
- Subfamily: `Regular`
- PostScript name: `NotoSansCJKkr-Regular`
- Static language-specific Korean OTF를 선택했다. Variable/OTC/전체 collection은 포함하지 않았다.

## 3. Upstream Identity

- Official repository: https://github.com/notofonts/noto-cjk
- Official release: https://github.com/notofonts/noto-cjk/releases/tag/Sans2.004
- Tag: `Sans2.004`
- Full commit: `523d033d6cb47f4a80c58a35753646f5c3608a78`
- Immutable source path: `Sans/OTF/Korean/NotoSansCJKkr-Regular.otf`
- Immutable raw source: https://raw.githubusercontent.com/notofonts/noto-cjk/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf
- Release notes: version 2.004, 2021-04-28 (https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/Sans/NEWS.md)

Floating `main`이나 `latest`가 아니라 tag가 가리키는 full commit의 single static Regular file을 사용했다.

## 4. License / Redistribution

Root `LICENSE`와 font embedded name ID 13은 SIL Open Font License 1.1을 명시한다.

- Immutable license source: https://github.com/notofonts/noto-cjk/blob/523d033d6cb47f4a80c58a35753646f5c3608a78/LICENSE
- Local preserved text: `assets/fonts/noto-sans-cjk-kr-2.004/LICENSE.txt`
- Unmodified font는 license text를 함께 보존하면 software와 bundle/redistribute할 수 있다.
- Font 자체를 단독 판매하지 않고 OFL 조건을 유지한다.

따라서 benchmark test/spike asset으로 repository에 포함할 수 있다. Malgun Gothic은 복사하지 않았다.

## 5. Font File Identity

| Field | Value |
|---|---|
| Path | `RoverCMT/spikes/renderer-comparison/assets/fonts/noto-sans-cjk-kr-2.004/NotoSansCJKkr-Regular.otf` |
| Format/signature | static OpenType/CFF, `OTTO` |
| Family | Noto Sans CJK KR |
| Subfamily | Regular |
| Full name | Noto Sans CJK KR |
| PostScript | NotoSansCJKkr-Regular |
| Version | `Version 2.004;hotconv 1.0.118;makeotfexe 2.5.65603` |
| File size | 16,433,112 bytes |
| SHA-256 | `6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a` |
| License file SHA-256 | `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2` |

Identity는 existing fontTools로 name/cmap tables를 read-only 검사했다.

## 6. Fixture Glyph Coverage

Manifest v1의 8 snapshots, 57 non-empty blocks에서 고유 non-whitespace Unicode scalar 280개를 추출했다. OTF의 모든 Unicode cmap을 합쳐 확인한 결과:

- actual glyphs: 280
- covered: 280
- missing: 0
- categories: Hangul 272, punctuation 7, symbol 1
- Latin/digits: 선택 text에 없음

Missing glyph에 system fallback을 허용하지 않았다.

## 7. Explicit Chromium Loading Method

Production source는 변경하지 않았다. `generate-reference-v2.cjs`는 compiled production primitives를 사용한다.

1. `out/main/pageExport.js`의 `createPageExportRenderSession`
2. `out/main/pageExportHtml.js`의 `createPageExportHtmlSource`
3. production `out/page-export/runtime.js` / `PageArtwork`
4. benchmark-only custom font record와 `defaultFontId`를 HTML source port에 제공
5. existing `pageExportHtml`이 exact OTF file URL의 `@font-face`를 생성
6. blocks의 absent `fontFamily`는 catalog의 designated default asset으로 resolve

Noto family를 production default나 application-wide setting에 hard-code하지 않았다. Asset ID → family → face → file → hash 계약은 manifest v2에만 존재한다.

## 8. Reference Revision 2

Output: `RoverCMT/spikes/renderer-comparison/reference-v2-noto-sans-cjk-kr-2.004/`

| Page | Dimensions | Format | SHA-256 |
|---|---:|---|---|
| `_004` | 1280x1791 | PNG | `8f6661fd8b9d779fd5093fbe8b7c081ea730a2cdd8458c20b9cd58a9203293ee` |
| `_011` | 1280x1791 | PNG | `8c053a62f279dbb7003a4e8ebeb9594cb6235ebba2de5b8ce907fd6ce52c4459` |
| `_012` | 1280x1791 | PNG | `a159fee79178f2b15aee5667318eef09093f324fcc44f5387c0c1496da99514c` |
| `_015` | 1280x1791 | PNG | `8f978b315df32e2d3a376586fc6e7f721a6d4a47d44881a5e2f2f6834a31420f` |
| `_018` | 1280x1791 | PNG | `aefa251a4a29d7f02809c63025901ed5daf8f888f8c2cb2795fa004b75bd162b` |
| `_029` | 1280x1791 | PNG | `82dfaa095dc60c4b882986ca85dff317f441be290d85b412e8dd6f027fd99091` |
| `_047` | 1280x1791 | PNG | `0bf4dda04b4447a5c01397c947f7df430ffba7f3352701d2fcafe5d6623c68bc` |
| `_0411` | 1280x925 | PNG | `53466eae52aa2c77243d9c7d147c2ed44ab0498340c3a2b2e53193054ff07e02` |

8/8 decode와 dimensions를 Electron `nativeImage`로 검증했다. `render-verification.json`에 full byte sizes, input snapshot/image hashes와 runtime identity가 있다.

## 9. Font Resolution Verification

`inspect-portable-font-v2.cjs`는 같은 Electron의 hidden Chromium에서 exact OTF를 file-backed `@font-face`로 load하고 CDP `CSS.getPlatformFontsForNode`를 실행했다.

- Electron 43.3.0 / Chromium 150.0.7871.212 / Windows x64
- 8 fixtures
- 57/57 full text block nodes
- 280/280 individual non-whitespace glyph nodes
- actual family: `Noto Sans CJK KR`
- actual PostScript face: `NotoSansCJKkr-Regular`
- `isCustomFont=true`
- unexpected/multiple fallback: 0

Evidence는 `reference-v2-noto-sans-cjk-kr-2.004/font-verification.json`에 보존한다. CSS family 선언만으로 성공 판정하지 않았다.

## 10. Manifest Revision

새 manifest는 `fixtures/manifest-v2.json`이다. 기존 `manifest.json`은 overwrite하지 않았다.

- `version: 2`, `revision: portable-font-reference-v2`
- v1 path와 SHA-256으로 `derivedFrom`
- 동일 chapter identity
- 동일 page IDs, snapshot paths/hashes, render image paths/hashes
- replaceable `fontAssets[]` registry와 `fontRoles` mapping
- exact upstream/release/commit/path/license/font hash
- 8 repository-relative PNG paths/dimensions/bytes/hashes
- Electron/Chromium/platform identity
- render/font verification sidecar paths/hashes

## 11. Reproducibility

Helper는 실행 전에 chapter, snapshot, render image와 font hash를 검증하고 mismatch에서 실패한다. Output directory가 이미 있으면 overwrite를 거부한다. Hardware acceleration은 parity QA와 같이 disabled, device scale factor는 1로 고정했다. Reference output과 asset path는 repository-relative다.

Re-running into the same v2 directory is intentionally prohibited. Runtime/toolchain 변경으로 새 bytes가 필요하면 새 immutable revision/directory를 만든다.

## 12. Future Multi-Font Compatibility

이번 revision은 `default-dialogue` role 하나만 사용하지만 manifest contract는 다음 mapping이다.

`font role → font asset ID → family/subfamily/PostScript → file → SHA-256`

향후 `emphasis`, `vertical`, `sfx`, `user-custom` asset을 별도 등록할 수 있다. Single global font production abstraction이나 multi-font manager는 만들지 않았다.

## 13. Remaining Unknowns

- Skia/Pango와 Chromium의 layout/raster 차이는 아직 비교하지 않았다.
- 현재 fixture에는 Latin/digits, vertical, curve/warp, multiple faces가 없어 그 범위는 검증되지 않았다.
- OTF coverage와 Chromium custom-face resolution은 확인했지만 future backend마다 OTF/CFF loading behavior를 smoke test해야 한다.
- GPU-enabled Chromium과 disabled reference의 antialiasing 차이는 comparison 해석 시 기록해야 한다.
- 최종 검증 시 v1 manifest가 가리키던 Downloads의 old external reference directory가 filesystem에서 사라져 8/8 old reference를 재해시할 수 없었다. 이번 작업은 해당 경로를 수정하지 않았으며 v1 manifest에 기존 path/hash는 남아 있다. v2 comparison에는 repository-local v2 PNG가 있으므로 직접 blocker는 아니지만 v1 baseline 재검토에는 blocker다.

## 14. Readiness for Renderer Comparison

**READY.** Exact redistributable font bytes, 280/280 glyph coverage, CDP custom-face verification, 8/8 lossless references, immutable manifest v2와 hashes가 준비됐다. 이는 spike 시작 준비 완료를 뜻하며 renderer winner나 production architecture를 확정하지 않는다.

## 15. Exact Next Step

`fixtures/manifest-v2.json`만 입력 계약으로 사용해 Skia Canvas, node-canvas, Playwright Chromium candidate spike를 별도 output directory에서 시작한다. 각 backend는 `fontRoles.default-dialogue`가 가리키는 exact OTF bytes와 hash를 명시적으로 load하고, fallback·runtime/version·timing/memory를 기록한다. 기존 v1 manifest와 v2 references는 절대 overwrite하지 않는다. 현재 missing인 v1 external references를 추측으로 재구성하지 않는다.
