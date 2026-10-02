# Renderer Library Feature Census

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M2 Test Set / Benchmark](../milestones/M2_TEST_SET/README.md) — fixture에 없는 실제 library 사례

Tracking: [M2 CURRENT](../milestones/M2_TEST_SET/CURRENT.md)

## 1. Purpose

현재 Renderer Comparison fixture(`fixtures/manifest.json`, `manifest-v2.json`)는 한 chapter에서 뽑은 8 pages이며 horizontal / default font / center / primary outline만 포함한다. 이 문서는 Carrot의 **실제 final library data 전체**를 read-only로 조사해, fixture가 다루지 않는 renderer feature가 실제 저장 데이터에 쓰인 사례가 있는지 확인하고 향후 fixture 후보를 고른다.

범위 밖: renderer 구현/수정, fixture 생성, manifest 변경, OCR·번역·typography·erase·export 재실행, production RoverCMT code. Library, export, 기존 문서와 spike 파일은 수정하지 않았다.

## 2. Scope and Authority

### 2.1 조사한 library

Carrot data root는 개발 실행 시 repository root, packaged 실행 시 `data-root.txt`가 가리키는 폴더다(`src/main/appPaths.ts:100`, `src/main/dataRoot.ts:15`). `D:\`, `%APPDATA%`, `%LOCALAPPDATA%`, Downloads, Documents 전체에서 `chapter.json`을 검색한 결과 두 data root, 4 chapters가 전부였다. `%APPDATA%\manga-gemma-translator`는 없고 `%LOCALAPPDATA%\manga-gemma-translator`에는 `llama.cpp`만 있다.

| ID | Data root | Work / Chapter | Title (요약) | Pages | Blocks | Non-empty | Chapter SHA-256 (prefix) | 마지막 저장 |
|---|---|---|---|---:|---:|---:|---|---|
| A | repo `library/` | `302a1e8a…` / `592a103c…` | Rice no! … 2 (현 fixture 원본) | 49 | 204 | 200 | `d100b63e889fdef8` | 2026-09-27 20:30 |
| B | repo `library/` | `457f9359…` / `af091799…` | `_yanyo_yanyanyo1` (4 images) | 4 | 42 | 42 | `8b770ab45a1c15b5` | 2026-09-27 16:08 |
| C | repo `library/` | `b1b74425…` / `408fb247…` | Rice no! … (3261704) | 42 | 178 | 170 | `593599d8df40fb28` | 2026-09-27 20:17 |
| D | installed app `%LOCALAPPDATA%\Programs\carrot-manga-translator\data\library` | `5cb36517…` / `46e79bc1…` | Rice no! … (3261704) | 42 | 179 | 171 | `1b41896cf0145a2a` | 2026-09-27 17:33 |
| **합계** | | | | **137** | **603** | **583** | | |

C와 D는 같은 원본(3261704)을 서로 다른 data root에서 따로 처리한 chapter다. 번역문이 일부 다르지만 feature 다양성의 독립 표본으로 보기 어렵다. 따라서 실질적인 원본은 3개다.

### 2.2 권위

- 권위 원본은 각 chapter의 final `chapter.json` `pages[].blocks[]`다.
- `runs/*/overlay-items.json` 같은 intermediate artifact는 스캔하지 않았다.
- D data root의 `results/<title>/result/*.jpg` export는 2026-09-26 13:18에 만들어졌고 final chapter(2026-09-27 17:33)보다 오래됐다. 따라서 final state의 reference로 쓰지 않는다.
- 두 data root 모두 `fonts/preferences.json`이 없다. `fonts/` 폴더는 repo root에 없고, installed root에서는 비어 있다. 두 root의 `settings.json` 설정은 `ui.autoFontMatchingDefault=false`, `ui.pageWorkflowDefault.autoFont=false`, `ui.sfxAutoFontMatchingDefault=false`, `ui.aiFontSizeMatchingDefault=true`이고, `blockFormatDefaults`는 `DEFAULT_BLOCK_FORMAT_DEFAULTS`(`src/shared/blockFormat.ts:184`)와 같은 identity 값에 `wordBreak="keep-all-overflow"`만 더한 것이다. 이 설정은 새 block이 만들어질 때만 반영된다. renderer가 실제로 읽는 값은 block에 저장된 값이다.

## 3. Method

1. Schema는 `src/shared/textTypes.ts:83` `TranslationBlock`으로, inline style은 `src/shared/richTextMarkup.ts`로 확인했다.
2. 각 field가 렌더링에 실제로 쓰이는지는 export 경로의 production renderer에서 확인했다: `PageArtwork.tsx`, `overlayBlockModel.ts`, `OverlayText.tsx`, `textRunVisualStyles.ts`, `textOutline.ts`, `textEffect.ts`, `textGlow.ts`, `generatedLettering.ts`, `overlayLayout.ts`, `sourceFontSizeMatching.ts`, `naturalTextLayout.ts`.
3. Python script로 4 chapters의 603 blocks 전체에 대해 key의 존재 여부와 값 분포를 집계했다. 각 feature마다 absent, default/identity, 실제 렌더링을 바꾸는 값을 구분했다.
4. Rich-text는 field가 아니라 `translatedText` 안의 markup이다. Parser grammar(`parseSegment`)가 `*`, `[`, `\` 세 문자에서만 style을 시작한다는 점을 확인한 뒤 이 세 문자를 전수 검색했다.
5. 번역문에 나오는 고유 non-whitespace 문자 577개를 benchmark font(`NotoSansCJKkr-Regular.otf` 2.004)와 `C:\Windows\Fonts\malgun.ttf`의 cmap에 fontTools로 read-only 대조했다.
6. 조사 script와 원시 출력은 session scratchpad에만 두고 repository에 추가하지 않았다.

## 4. Feature Census

`occurrence`는 렌더링을 바꾸는 값을 가진 block 수다. 모든 chapter에서 해당 key가 아예 없으면 `key 0/603`으로 적는다.

| Feature | Field / 판정 기준 | 저장된 실제 값 | Occurrence | Renderer 동작 (값이 있을 때) |
|---|---|---|---:|---|
| Vertical text | `renderDirection="vertical"` (`normalizeRenderDirection`) | 603/603 `"horizontal"`; `sourceDirection` 603 `"horizontal"`; `layoutIntent`/`layoutIntentSuppressed` key 0 | **0** | `vertical-rl`, upright spacing, vertical autofit bound |
| Reading direction | work `readingDirection` | 3 works 모두 `"auto"` | n/a | block renderer 입력이 아니다(page 순서/UI) |
| Custom/non-default font | `fontFamily` | key 0/603. `fonts/preferences.json` 없음 → `DEFAULT_BLOCK_FONT_STACK` | **0** | catalog font 또는 custom `@font-face` |
| Bold | `bold=true` 또는 `**…**` | 603 `false`; markup 0 | **0** | weight 800 또는 `fontWeight` |
| Exact weight | `fontWeight` | key 0/603 | **0** | `resolveFontWeight` exact face |
| Italic | `italic=true` 또는 `*…*` | 603 `false`; markup 0 | **0** | italic face/synthesis |
| Alignment variation | `textAlign != "center"` | 603 `"center"` | **0** | slot 안의 left/right 정렬 |
| Rotation | `rotationDeg` truthy | 603 key 존재, 값은 전부 `0` (identity) | **0** | CSS `rotate()` (`overlayBlockModel.ts:135`) |
| Perspective | `perspectiveTransform` 존재 | key 0/603 | **0** | `matrix3d` content transform |
| Curve layout | `curveLayout` + horizontal + no newline | key 0/603 | **0** | SVG `CurveText` |
| Warp/displacement | `warpTransform` non-identity | key 0/603 | **0** | SVG `feDisplacementMap` |
| Outer outline | `outerOutlineWidthPx>0` 또는 inline tag | key 0/603; markup 0 | **0** | 세 번째 paint plane(`hasAnyOuterOutline`) |
| Primary outline 변형 | `outlineWidthPx`, `outlineWidthScale!=1`, `outlineColor!=#ffffff` | `outlineWidthPx` key 0; scale 603 `1`; color 603 `#ffffff` | **0** | 기본값: `round(clamp(fontSize*0.055, .35, 4))*1` px stroke. 이 기본 outline은 이미 fixture에 있다 |
| Text color/opacity | `textColor!=#111111`, `textOpacity<1` | 603 `#111111`, 603 `1` | **0** | fill color/opacity |
| Shadow | `textEffect.enabled && opacity>0` | key 0/603 | **0** | CSS `drop-shadow` layer |
| Glow | `textGlow.enabled && blur>0 && opacity>0` | key 0/603; inline glow 0 | **0** | `text-shadow` glow |
| Text background | `textBackgroundEnabled` | key 0/603 | **0** | text box fill layer |
| Underline/strike/emphasis | `underline`/`strikethrough`/`emphasisMark` 또는 tags | key 0/603; markup 0 | **0** | text-decoration / emphasis dots |
| Generated lettering | `getActiveGeneratedLettering` non-null | key 0/603; `imageGenerationBlocked` key 0 | **0** | text 대신 image asset |
| Rich-text runs | `*`, `[`, `\`가 있는 `translatedText` | 0/603 blocks | **0** | run별 font/size/color/outline/glow |
| Line height | `lineHeight != 1.18` | 603 `1.18` | **0** | line pitch, autofit height bound |
| Letter spacing | `letterSpacing != 0` | 603 `0` | **0** | tracking |
| Width scale | `fontWidthScale != 1` | 603 `1` | **0** | 장평 transform, autofit width |
| Word break | `wordBreak` | 603 `"keep-all-overflow"` | fixture에 있음 | wrapping policy |
| Block opacity/background | `opacity`, `backgroundColor` | 603 `0.7`, 603 `#fef3c7` | **editor-only** | `showBlockChrome`일 때 chrome에만 쓰인다(`overlayBlockModel.ts:174`). export glyph에는 영향 없음 |
| `inpaintExcluded` | | key 0/603 | 0 | export에서는 chrome이 없어 영향이 없다 |
| Source-match font sizing | `fontSizeIntent="source-match"` + usable `sourceFontFacePx` | A 196, C 171, D 173 = **540/603**, 모두 `raster-core-v1`이고 confidence ≥ 0.5, `autoFitText=false` | **540** | font metrics로 size cap을 계산하고 mask-fit으로 크기를 찾는다. **fixture에도 있다(56/58)** (§6.1 참고) |
| Generic autofit | source-match 없음, `autoFitText=true` | 63/603 (B 42 전부, A 8, C 7, D 6) | 63 | binary-search fit. fixture에 2 blocks |
| Text source fallback | `textDisplayMode != "translation-only"` | 603 `"translation-only"` | **0** | 빈 번역이면 `sourceText`를 대신 렌더 |
| Empty translated block | translation-only + 빈 text | A 4, C 8, D 8 | 20 | 아무것도 렌더하지 않음. fixture에 있음(_015) |
| `bubbleLayout` 형태 | region 수, direction | 466 blocks 모두 region 1개, horizontal, `detected` / `koharu-layout-rfdetr-seg-2xl-115` | multi-region 0 | slot geometry |
| Off-page `renderBbox` | `renderBbox`가 0–1000 범위 밖 | 0/466 | **0** | page clip |

결론: 고급 typography/transform/effect feature는 **4 chapters, 603 blocks 전체에서 한 번도 쓰이지 않았다.** `rotationDeg`, `outlineWidthScale`, `lineHeight` 같은 일부 key는 모든 block에 있지만 값은 전부 identity/default다. 나머지 고급 field는 key 자체가 없다. 위 settings(auto font off, 수동 편집 흔적 없음)와 합쳐 보면 모든 library가 자동 pipeline의 default format 그대로 저장된 것이다.

## 5. Found: fixture가 다루지 않는 실제 사례

고급 feature는 없었다. 대신 현재 fixture 8 pages에 없는 **실제 rendering 조건**이 확인됐다.

### 5.1 Latin/digit 혼용 text

Fixture의 280 glyph에는 Latin과 digit이 0개다(`RENDERER_FONT_RESOLUTION.md` §4). Library에는 다음 사례가 있다.

| Chapter | Blocks | 예시 page (page ID) | 예시 text |
|---|---:|---|---|
| A | 1 | `_052.jpg` (`08f63a40-695e-46ae-a954-3d3a5c14d6ff`) | `HERO 제공` |
| B | 2 | `FI5LRNDaUAk-pCu.jpg` (`28011f2d-5b9b-4f3a-b9b8-cd548cdadb5d`) | `5~7위` |
| C | 6 | `page_024.jpg` (`ae438650-f6fd-4e21-aff0-00b43c2bc33b`) | `언니! 80m!!` |
| D | 7 | `page_042.jpg` (`78c33148-3d63-4aaf-8f6e-7ae6bbf4b62c`) | `코믹 마켓 C105`, `2024/12/29`, SNS handle과 email 형식의 연락처(`@`, `-`, `.` 포함; 원문은 문서에 옮기지 않음) |

- Renderer 동작: 한글과 Latin glyph metrics가 섞이면 line width, wrapping, face-ratio probe(`sourceFontSizeMatching.ts`의 `visibleProbe`)가 달라진다.
- 검증 공백: 현재 비교로는 Latin/digit shaping, kerning, baseline, 혼용 행의 wrapping 차이를 판정할 수 없다.

### 5.2 Default font에서의 실제 glyph fallback

577개 고유 문자 중 **`･` (U+FF65 HALFWIDTH KATAKANA MIDDLE DOT)는 Malgun Gothic cmap에 없다.** Noto Sans CJK KR에는 577/577이 모두 있다.

- 위치: B `FI5LOgBaQAAR7we.jpg` (`6dd0abc4-eed4-4ded-9167-5ad457251a4c`) block 5, 18회(`'트레이너 군'이라고 부르는 건･･････ 다른･･････ 호칭으로･･････`)
- 현재 Carrot default stack에서 Chromium은 이 glyph를 다른 system face로 fallback해야 한다. 어느 face인지는 CDP로 확인하지 않았다(§7).
- 그 밖에 fixture에 없는 symbol: `▶`(B), `♪`(C/D `page_008`, `page_015`, `page_040`), `─`(C/D `page_019`), `—`(C/D `page_014`, `page_022`), `…`(C `page_041`), `「」 @ / - ( )`(D `page_042`, C/D `page_015`). 이 문자들은 두 font에 모두 있다.
- 검증 공백: 현재 fixture는 단일 face로만 resolve된다(v1 Malgun 57/57, v2 Noto 280/280). 따라서 renderer별 fallback chain(Skia/fontconfig, Pango, Chromium)의 차이는 전혀 검증되지 않는다. Portable font를 pin한 v2 계약에서는 이 fallback이 사라진다. Default-stack 경로의 품질은 별도 문제로 남는다.

### 5.3 여러 줄의 explicit newline

Fixture 최대는 `_032.jpg`의 4줄이다.

- D `page_042.jpg`: block 1개에 **8줄**, 116자. source-match 경로이며 `renderBbox`가 없다.
- B `FI5LOgBaQAAR7we.jpg`: 10 blocks 중 8개가 multi-line(최대 4줄)이다. 모두 generic autofit이고 `bubbleLayout`이 없다.
- C/D `page_007.jpg`, `page_027.jpg`: 4줄 blocks가 여러 개 있다.

Renderer 동작: hard break는 natural wrapping을 우회한다. source-match의 자동 fit은 newline이 있으면 꺼진다(`overlayLayout.ts`의 `automaticSourceFit`에 `!/[\r\n]/`). 따라서 newline block은 다른 크기 결정 경로를 탄다.

### 5.4 극단적인 unbroken text / overflow

- D `page_019.jpg` (`ca14b594-ed23-4901-8303-c3a272434cd4`) block 0: `떠벌`만 반복한 **2,813자, 공백 없이 2,809자가 이어지는 run**이다. `keep-all-overflow`, source-match, `renderBbox`가 있다.
- 같은 원본의 C `page_019.jpg`에서 가장 긴 block은 157자다. D 쪽은 번역 LLM이 degenerate repetition을 낸 결과로 보인다.
- Renderer 동작: `MIN_FONT_SIZE_PX`까지 줄어든 뒤 overflow/clipping이 일어나고, 긴 run의 강제 break와 layout 계산 비용도 크다.
- 검증 공백: fixture 최대는 129자이고 공백도 있다. 극단적 overflow에서 renderer별 clipping 위치, 시간, memory는 비교되지 않는다. 품질 비교보다는 robustness/timeout 후보다.

### 5.5 새 page 크기, 원본 raster, 높은 block 밀도

| 조건 | 실제 사례 | Fixture 현황 |
|---|---|---|
| 1500x2118 (3.18MP, library 최대) | B 4 pages 전부 | 최대 1280x1791 (2.29MP) |
| 1280x1790 | C/D `urahyoshi_044.jpg` 등 3 pages | 없음 |
| inpainted 없이 원본 `imagePath`로 render | B 4 pages (`inpaintedImagePath` 없음) | 8/8 inpainted |
| 20 blocks/page | B `FI5LRNDaUAk-pCu.jpg` | 최대 10 |
| 13 blocks/page | C/D `page_023.jpg` | 최대 10 |
| `bubbleLayout`/`renderBbox` 없는 page 전체, generic autofit만 | B 42 blocks 전부 | 2 blocks |

Renderer 동작 차이는 feature보다 입력 조건이다. 큰 raster는 tile capture 경계(`captureTiledPageExport`)에 가까워지고, 원본 raster는 export image resolution의 fallback 분기(`resolveExportImageSource`)를 쓴다. 밀도가 높으면 성능 측정 대표성이 커진다.

## 6. Fixture contract의 검증 공백

### 6.1 Source-match 크기 결정 입력이 snapshot에 없다

Library 540/603 blocks, fixture 56/58 blocks가 `fontSizeIntent="source-match"`, `autoFitText=false`다. 이 경로에서 renderer는 다음 값으로 최종 font size를 정한다(`sourceFontSizeMatching.ts`, `overlayLayout.ts`).

- `sourceFontFacePx`, `sourceFontSizeConfidence` (≥ 0.5), `sourceFontSizeMethod` (`raster-core-v1`)
- `sourceText` (8 grapheme 기준 신뢰도 판정과 page fallback 자격), `sourceDirection`, `textRole`, `fontRole`, `sourceFontFaceFallbackPx`
- 같은 page의 다른 blocks (page-local median fallback)
- 대상 font의 실제 glyph bbox(`measureText`의 `actualBoundingBoxAscent+Descent`)와 `SOURCE_MATCH_OPTICAL_SCALE=1.06`

`fixtures/pages/*.json` snapshot에는 `fontSizeIntent`와 `autoFitText`는 있지만 위 source 입력은 **하나도 없다.** 반면 `generate-reference-v2.cjs`는 snapshot이 아니라 원본 `chapter.json`의 page를 `session.renderPage(page)`에 넘긴다. Snapshot은 block id와 크기 검증에만 쓴다.

결과: snapshot만 읽는 candidate adapter는 source cap을 계산할 수 없다. geometry font size를 상한으로 fit하게 되므로 reference v2와 **다른 font size**를 만들 수 있다. Renderer 품질 차이와 입력 누락을 구분할 수 없게 된다. 이 공백은 다른 작업자의 spike 구현 방식에 따라 이미 해결됐을 수도 있다. 이 문서는 manifest와 구현을 확인·수정하지 않았다. 해결 방향(§9)만 제안한다.

### 6.2 그 밖의 공백

- 모든 fixture page가 A chapter 하나에서 나왔다. B의 non-bubble/generic-autofit 전용 page 유형이 없다.
- Default-stack glyph fallback(§5.2)은 v1 reference에서만 의미가 있다. v2 portable 계약에서는 재현되지 않는다.

## 7. Unknown / 추가 검증 필요

1. `･` fallback face: Carrot default stack에서 Chromium이 실제 어떤 face로 fallback하는지는 CDP `CSS.getPlatformFontsForNode`로 확인해야 한다(`inspect-chromium-fonts.cjs` 방식). 이번 작업은 cmap 대조까지만 했다.
2. D `page_019` 2,813자 block: 실제 layout evidence(font size, overflow)와 render 시간은 render해 봐야 안다. LLM 결함 산출물이므로 fixture로 넣을지는 사용자 판단이다.
3. Source-match 크기 재현성: snapshot 입력만으로 reference v2의 `data-layout-evidence.fontSizePx`와 같은 크기가 나오는지는 비교 harness에서 측정해야 한다.
4. B/C/D 후보 page의 final-state reference 부재: C/D의 기존 export는 final보다 오래됐거나(D, 9/26) 위치를 모른다(C). B는 export를 찾지 못했다. Fixture로 추가하려면 v2 방식으로 final state에서 새 reference를 만들어야 한다.
5. Corpus 대표성: library는 사실상 3개 원본이고 모두 자동 pipeline의 default format이다. 고급 feature가 0건인 것은 **이 사용자의 현재 library**에 대한 사실일 뿐, Carrot 사용자 전반에서 안 쓰인다는 근거가 아니다. Intermediate run artifact와 삭제된 과거 library는 조사하지 않았다.

## 8. Recommended Fixture Candidates

모두 `analysisStatus="completed"` pages다. 우선순위는 정보 가치 대비 추가 비용 순이다.

| 순위 | Chapter / page | Page ID | 추가하는 조건 | 비고 |
|---:|---|---|---|---|
| 1 | A `_052.jpg` | `08f63a40-695e-46ae-a954-3d3a5c14d6ff` | Latin text (`HERO`) | 현 fixture와 같은 chapter라 manifest 연속성 비용이 가장 낮다 |
| 2 | D `page_042.jpg` | `78c33148-3d63-4aaf-8f6e-7ae6bbf4b62c` | 8줄 newline, Latin/digit, `@ / - 「」`, source-match 단일 block | installed data root. final reference 없음 |
| 3 | B `FI5LOgBaQAAR7we.jpg` | `6dd0abc4-eed4-4ded-9167-5ad457251a4c` | `･` Malgun 누락 glyph, `▶`, 1500x2118, 원본 raster, generic autofit, bubbleLayout 없음, multi-line 8 blocks | fallback과 새 크기를 한 page로 다룬다 |
| 4 | B `FI5LRNDaUAk-pCu.jpg` | `28011f2d-5b9b-4f3a-b9b8-cd548cdadb5d` | 20 blocks (최대 밀도), digit, 1500x2118 | 성능 측정 대표 |
| 5 | C `page_008.jpg` | `b831f31f-5507-40c9-94b0-c5a0cbb0c9bf` | `♪`, 3줄 newline, 9 blocks | repo data root. `page_015` (`48a6f7f4-549a-4364-b9b3-0812074ac18a`)는 `♪ ( )` 대안 |
| 6 | C `page_024.jpg` | `ae438650-f6fd-4e21-aff0-00b43c2bc33b` | 한글+digit+Latin 단위 (`80m!!`) | 2와 중복되므로 선택 사항 |
| 7 (robustness) | D `page_019.jpg` | `ca14b594-ed23-4901-8303-c3a272434cd4` | 2,813자 unbroken overflow, `─`, digit | 품질 점수가 아니라 timeout/overflow 검사용. 사용자 판단 |

1–5를 추가하면 현재 8 pages에 5 pages가 더해져 13 pages가 된다. 이는 `RENDERER_CANDIDATE_ANALYSIS.md` §10의 8–15 pages 범위 안이다. Vertical, custom font, rotation, perspective, curve, warp, effect, generated lettering 후보는 **실제 data가 없어서 없다.** 원칙에 따라 synthetic fixture는 제안하지 않는다.

## 9. Summary

### 실제 데이터에서 발견되어 향후 fixture에 추가해야 할 것

- Latin/digit 혼용 text: 16 blocks, A/B/C/D 모두
- Default font의 실제 glyph fallback: `･` U+FF65, B 1 page, 18회. `▶ ♪ ─ — … 「」 @ /`처럼 fixture에 없는 symbol
- 8줄 explicit newline(D `page_042`)과 non-bubble 페이지의 multi-line blocks(B)
- 1500x2118 page, 원본 raster render, 13–20 blocks/page, 페이지 전체가 generic autofit인 경우(B)
- (robustness) 2,813자 unbroken overflow block(D `page_019`)
- Fixture contract 보완: source-match 크기 결정 입력(`sourceFontFacePx` 등)을 candidate 입력에 포함하는 것. 새 feature가 아니라 이미 fixture 56/58 blocks가 쓰는 경로다

### schema/renderer에는 있지만 실제 library에서는 발견되지 않은 feature

Vertical text, custom/non-default font(`fontFamily`, `fontWeight`), bold, italic, alignment variation, non-zero rotation, perspective, curve, warp, outer outline, primary outline 변형(width px/scale/color), text color/opacity 변형, shadow(`textEffect`), glow(`textGlow`), text background, underline/strikethrough/emphasis, generated lettering, image-generation-blocked, rich-text/multiple style runs, unusual line-height, non-zero letter-spacing, non-default width scale, `textDisplayMode`가 translation-only가 아닐 때의 source text fallback, multi-region bubble layout, off-page `renderBbox`. 모두 603/603 blocks에서 key가 없거나 identity/default 값이다.

### 판단할 수 없거나 추가 검증이 필요한 것

- `･`의 실제 Chromium fallback face (CDP 확인 필요)
- 2,813자 block의 실제 layout/timeout 동작과 fixture 편입 여부 (사용자 결정)
- Snapshot 기반 candidate가 source-match 크기를 reference v2와 같게 재현하는지 (진행 중인 spike 구현 확인 필요)
- B/C/D 후보 page의 final-state reference (새로 생성 필요)
- 현재 library 밖(다른 사용자, 삭제된 library, intermediate run)에서 고급 feature가 쓰이는지. 이번 조사로는 알 수 없다

## 10. Exact Next Step

1. 진행 중인 Renderer Comparison 작업자와 §6.1을 먼저 확인한다. candidate 입력에 source-match 필드를 넣는 새 immutable manifest revision을 만들지, reference의 `data-layout-evidence` font size를 입력으로 pin할지 결정한다. 이 결정 전에 source-match block의 크기 차이를 renderer 품질 차이로 해석하지 않는다.
2. 그 다음 manifest revision에서 §8의 1–5 page를 추가한다. 각 page의 reference는 v2 방식(portable font 명시 load, 새 경로, overwrite 금지)으로 final state에서 새로 만든다. 기존 manifest와 reference는 건드리지 않는다.
3. Default-stack fallback 품질을 비교 범위에 넣을지 결정한다. 넣는다면 B `FI5LOgBaQAAR7we.jpg`를 CDP로 검사한 machine-bound 진단 revision을 portable benchmark와 분리해 기록한다.
4. Vertical, transform, effect, custom font는 실제 사용 데이터가 생길 때까지 비교 범위에서 제외된 상태로 둔다. Renderer 결정 문서에는 "이 기능들은 검증되지 않음"을 명시적인 제한으로 남긴다.
