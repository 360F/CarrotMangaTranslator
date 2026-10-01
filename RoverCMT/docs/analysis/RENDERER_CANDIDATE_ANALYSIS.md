# RoverCMT Renderer Feasibility & Candidate Analysis

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M1 Linux Port](../milestones/M1_LINUX_PORT/README.md) — renderer 요구사항, 후보와 analysis 수준 기각 후보

Tracking: [M1 CURRENT](../milestones/M1_LINUX_PORT/CURRENT.md) · [M1 REJECTED](../milestones/M1_LINUX_PORT/REJECTED.md)

## 1. Executive Summary

Carrot final export는 MangaPage를 HTML에 직렬화하고 숨겨진 Electron BrowserWindow의 Chromium에서 production React PageArtwork를 렌더한 뒤 DevTools Page.captureScreenshot으로 PNG를 만든다. 실제 dependency는 DOM/CSS CJK shaping·fallback, Canvas measurement, CSS vertical writing, 다층 text stroke, SVG curve text, displacement-map warp, transform·clip·filter와 image composition이다. 큰 페이지는 tile capture 후 FFmpeg로 stitch한다.

Electron-free 후보는 가능하지만 shared layout만으로 시각 parity가 보장되지는 않는다. 다음 comparison spike 후보는 Skia Canvas, node-canvas, Playwright Chromium 세 가지다. 후보를 채택한 것은 아니다.

## 2. Current Carrot Render Path

1. src/main/jobs/pageImageExportJobRunner.ts가 page를 준비하고 renderSession.renderPage를 호출한다. PSD도 pagePsdExportRunner.ts에서 같은 session을 쓴다.
2. src/main/pageExport.ts:106 createPageExportRenderSession과 :264 renderPageWithTranslationBlocksForExport가 entry다.
3. :276 createExportWindow는 show:false BrowserWindow와 :289 offscreen:true, sandbox/context isolation을 설정한다.
4. :339 renderPageInSession은 inpaintedImagePath를 우선하고 raster budget을 검사하여 page.html을 만든다. src/main/pageExportHtml.ts가 page, image URL, font library와 sizes를 직렬화한다.
5. src/renderer/src/pageExport/browserEntry.tsx:32 startPageExport는 image decode와 loadBlockFonts를 병렬 실행한다. required font 누락은 실패다.
6. :57에서 PageArtwork를 flushSync로 렌더하고 image, warp maps, 두 animation frame 후 ready를 알린다.
7. pageExport.ts:565 waitForExportRenderReady가 dimensions를 검증한다.
8. src/main/pageExportCapture.ts:47 captureExportPageImage가 :270 Page.captureScreenshot을 호출한다. :144 captureTiledPageExport는 큰 raster를 tile로 캡처한다.
9. src/main/pageExportTileStitch.ts:214 stitchPageExportTiles가 runtime/assets/ffmpeg-path.cjs에서 FFmpeg를 찾아 tile을 합친다.

PageArtwork.tsx:180은 background image 위에 block을 순서대로 합성한다. :305 resolveBlockTextLayout이 geometry와 font data로 layout을 계산한다. :108 ArtworkBlockText는 generated lettering image, CurveText, OverlayText 중 하나를 고르고 WarpedTextContent로 감싼다. overlayBlockModel.ts:142는 rotation/translation, :155 부근은 perspective matrix3d를 만든다. OverlayText.tsx:232–236은 upright/vertical-rl, :379 이후는 main/outline/outer text planes다. CurveText.tsx:119는 Canvas measureText와 SVG glyph rotation/stroke를 쓴다. WarpedTextContent.tsx:76은 SVG displacement map CSS filter를 적용한다. pageExport/styles.css:26은 page를 clip한다.

## 3. Actual Renderer Requirements

| Capability | Carrot 실제 사용 | 현재 구현 | Rover 필요성 |
|---|---|---|---|
| CJK shaping | Yes | Chromium | Required |
| Custom font/fallback | Yes | blockFontLoading, document.fonts, CSS stacks | Required |
| Metrics/wrapping | Yes | Canvas measureText + shared wrapping | Required |
| Horizontal/vertical | Yes | horizontal-tb/vertical-rl, upright spacing | Required when present |
| Rich per-run style | Yes | font/size/weight/italic/opacity/color/width | Required |
| Inner/outer outline | Yes | three paint planes, CSS/SVG stroke | Required |
| Alignment/spacing | Yes | slots, line-height, letter-spacing | Required |
| Rotation/scale | Yes | CSS transform | Required |
| Perspective | Rendered when configured | matrix3d | Fixture-dependent |
| Curve/warp | Rendered when configured | SVG layout/displacement filter | Fixture-dependent |
| Clip/composition | Yes | overflow and ordered layers | Required |
| PNG/alpha | Yes | screenshot/transparent capture | PNG required; alpha if PSD retained |
| Large raster | Yes | tile+FFmpeg | Required; implementation may differ |

## 4. Reusable Layout vs Backend Responsibilities

Reusable/adaptable TypeScript는 bbox/renderBbox conversion, block order, reading direction, naturalTextLayout/bubbleLayout, slot geometry, wrapping control flow, curveGlyphLayout positions, font size/spacing/alignment decisions, rich-text parsing, grapheme segmentation, color/outline parameters, rotation/perspective data, raster limits와 tile plan이다.

Backend는 Unicode shaping, glyph choice, fallback, actual metrics, rasterization/hinting, vertical punctuation, inline whitespace, stroke/filter/warp, transform/clip composition, image decode/scale와 PNG encode를 제공해야 한다. 다른 shaper나 fallback face는 같은 wrapping algorithm에서도 line break와 font size를 바꿀 수 있다.

## 5. Candidate Survey

### Skia Canvas — STRONG_CANDIDATE

Official [repository](https://github.com/samizdatco/skia-canvas), [Canvas API](https://skia-canvas.org/api/canvas), [context API](https://skia-canvas.org/api/context). MIT. Linux glibc 2.28+/musl x64 prebuilt, headless Node N-API, CPU mode/Linux Vulkan, FontLibrary/fontconfig, text metrics, paths/transforms/clips, image와 PNG가 있다.

Shared wrapping/curve geometry를 Skia metrics에 연결하고 vertical columns/punctuation, multi-pass outline와 optional warp를 구현해야 한다. Chrome Canvas와 유사하다는 설명은 DOM/CSS parity가 아니다. CJK fallback, vertical metrics와 antialiasing을 실제 fixture로 검증해야 한다.

### node-canvas — POSSIBLE_WITH_EXTRA_LAYOUT

Official [repository](https://github.com/Automattic/node-canvas). MIT. Cairo-backed Node Canvas로 Linux x64 prebuilt, Pango/Cairo/fontconfig, registerFont, measureText, fillText/strokeText, transforms, clipping, image/PNG를 제공한다. v4의 확대된 platform binary는 공식 README상 pre-release다.

CSS vertical-rl, wrapping, curve와 warp는 없다. Shared wrapping에 Pango metrics를 넣고 vertical glyph placement, curve rotation, outline stroke/fill passes를 구현해야 한다. Skia와 다른 mature native text stack이므로 비교 가치가 있다.

### Playwright Chromium — REFERENCE_FALLBACK

Official [browser/headless docs](https://playwright.dev/docs/browsers), [screenshots](https://playwright.dev/docs/screenshots). Apache-2.0. Linux Chromium/headless shell과 Node/TS API를 제공한다. 현 React/CSS renderer, vertical writing, FontFace, SVG/filter와 screenshot behavior를 가장 많이 보존한다.

Browser binary/subprocess, Linux packages/sandbox, 높은 cold start와 memory가 남는다. Electron-free이지만 Chromium-free는 아니며 품질 상한과 fallback으로 가치가 있다.

### @napi-rs/canvas — reserve

[Official repository](https://github.com/Brooooooklyn/canvas)는 Linux Skia Node-API, custom fonts, image/PNG를 제공한다. 기술적으로 가능하지만 첫 spike에서 Skia binding 두 개를 비교할 정보 가치는 낮다. Skia Canvas packaging/API가 막힐 때 대체한다.

## 6. Candidate Comparison Matrix

| Criterion | Skia Canvas | node-canvas | Playwright |
|---|---|---|---|
| Class | STRONG_CANDIDATE | POSSIBLE_WITH_EXTRA_LAYOUT | REFERENCE_FALLBACK |
| Linux x64/headless | Yes | Yes | Yes |
| Integration | direct N-API | native addon | driver+browser |
| CJK/fallback | Skia/fontconfig; verify | Pango/fontconfig; verify | Chromium; closest |
| Vertical/wrapping | manual/shared | manual/shared | current CSS/DOM |
| Stroke/curve/warp | multipass/manual | multipass/manual | current CSS/SVG |
| Transform/clip | strong | Canvas standard | current CSS/SVG |
| Fonts/image/PNG | Yes | Yes | Yes |
| Integration cost | Medium-high | High | Low-medium |
| Expected parity | Unknown/promising | Unknown | Highest |
| Runtime cost | native addon | addon/libs | Chromium process |

## 7. Rejected Candidates

- SVG+resvg alone — REJECT: rasterizer이며 shaping/fallback/wrapping/vertical engine이 아니다. HarfBuzz와 layout을 별도로 모두 추가해야 한다.
- Satori+resvg — REJECT: subset HTML/CSS/Yoga라 writing-mode, browser inline layout, displacement warp와 complex paint contract를 보존하지 못한다.
- CanvasKit/WASM — first spike REJECT: official [Skia quickstart](https://docs.skia.org/docs/user/modules/quickstart/)는 shaping/font manager를 제공하지만 Node headless surface와 WASM memory/copy가 native Skia보다 복잡하다.
- Sharp/libvips — renderer로 REJECT: image composition/encoding에는 좋지만 CJK shaping/fallback/vertical/curve layout 전체가 없다.
- Raw SVG without shaping — REJECT: SVG text만으로 deterministic fallback/wrapping이 생기지 않는다.
- @napi-rs/canvas는 기술 탈락이 아니라 중복 때문에 reserve다.

## 8. Recommended 2–3 Spike Candidates

1. Skia Canvas: 가장 직접적인 native Node/headless 후보이며 paint/font primitive가 넓다.
2. node-canvas: Pango/Cairo라는 다른 stack으로 CJK 품질과 integration cost를 비교한다.
3. Playwright Chromium: 현 품질 보존 가능성이 가장 높은 non-Electron fallback이며 Chromium 유지 비용을 수치화한다.

Electron 자체는 후보가 아니라 reference다.

## 9. Existing Carrot Fixture Sources

읽기 전용 조사에서 최신 corpus를 확인했다.

- library/works/302a1e8a-7059-4644-8e23-ba0ef85f8d14/chapters/592a103c-0f9b-4416-bff5-8ec3a985600d/chapter.json
- 같은 chapter의 pages/, inpainted/, runs/
- 49 pages이며 예를 들어 _004.jpg는 1280×1791, 6 blocks와 대응 inpainted PNG가 있다.

chapter.json blocks에는 translatedText, bbox/renderBbox와 spaces, bubbleLayout, directions, rotation, font size/intent/source face, line-height, letter-spacing, width-scale, word-break, alignment, colors/opacity, outline, bold/italic/background, auto-fit 등 renderer 입력이 있다. 고급 block은 TranslationBlock schema의 font/rich text/curve/warp/perspective/effect/generated-lettering도 가질 수 있다.

Fixture 권위는 final chapter.json에서 정규화한 MangaPage/PageArtworkSnapshot이다. runs/*/overlay-items.json은 intermediate attempt라 후속 typography edit를 누락할 수 있다.

Final PNG는 library 고정 경로가 아니다. pageImageExportOutput.ts가 설정/사용자 output directory를 고르고 pageImageExportJobRunner.ts가 쓴다. 이미 생성된 reference PNG 경로를 page ID와 별도 immutable manifest로 연결해야 한다. 기존 결과는 이동·수정·삭제하지 않는다.

## 10. Proposed Comparison Harness

same immutable manifest에서 final page snapshot, source/inpainted image path+hash, exact font files/catalog+hash, existing reference PNG+hash를 읽는다. 이를 Skia Canvas, node-canvas, Playwright adapter에 주고 각각 PNG와 metrics JSON만 새 spike output directory에 쓴다.

OCR/translation/erase/font inference는 재실행하지 않는다. dimensions, block order/text, fonts, layout and transforms를 고정한다. backend/version/platform/font inventory와 wrapping에 사용한 metrics를 기록한다. Pixel diff는 보조 overlay로만 쓴다.

실제 feature census 후 보통/긴/작은 bubble, vertical, fallback/non-default font, outline, rotation/perspective, 실제 존재하는 curve/warp, generated lettering와 largest page를 포함한 8–15 pages를 고른다.

## 11. Measurements and Visual Inspection Criteria

자동: cold start, first page, warm page, multi-page total, parent+child peak RSS, failure/timeout, dimensions, optional file size.

사람 A/B: position, wrapping, shaping, fallback, size, alignment, vertical orientation/spacing, inner/outer outline, rotation/perspective, curve/warp, clipping, bubble fit, generated lettering composition, edge quality와 readability. 가능하면 candidate label을 blind 처리한다. Anti-aliasing 차이는 허용하고 pixel equality를 요구하지 않는다.

## 12. Remaining Unknowns

- 실제 보존 page 중 vertical/curve/warp/perspective/outer outline/fallback/generated lettering를 사용하는 subset
- reference 생성 시 exact custom/system fallback font files
- 실제 Korean/Japanese fonts에서 Skia/Pango metrics와 punctuation/fallback이 Chromium과 다른 정도
- displacement warp/CSS filter parity 비용과 scoped browser fallback 필요성
- native renderer의 최대 page memory와 tile/FFmpeg 대체 필요성
- 사용자가 생성한 final PNG directory의 정확한 위치/이름
- Linux Playwright Chromium과 Windows Electron Chromium의 font/raster 차이

## 13. Exact Next Step

1. 기존 reference PNG를 이동 없이 찾아 hash한다.
2. selected chapter final blocks를 read-only census하여 실제 feature를 집계한다.
3. 8–15 representative pages와 exact fonts/images/page snapshots의 immutable manifest를 만든다.
4. production과 분리된 세 adapter를 구현한다.
5. 동일 snapshot을 render하고 metrics와 side-by-side review sheet를 만든다.
6. 사람의 PNG 비교 후 native 채택, scoped browser fallback 또는 Chromium 유지 여부를 결정한다.

이 분석은 architecture나 renderer를 확정하지 않는다.
