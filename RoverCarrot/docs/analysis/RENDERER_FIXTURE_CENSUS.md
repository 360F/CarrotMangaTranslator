# Renderer Fixture Census & Reference Manifest

## Project Tracking

> 이 블록은 관련 milestone 링크만 담는다. 계획·상태(CURRENT/IDEAS/REJECTED)의 source of truth는 [docs/milestones](../milestones/README.md)다. 아래 분석 본문은 작성 시점의 근거 자료다.

Related milestones:
- [M2 Test Set / Benchmark](../milestones/M2_TEST_SET/README.md) — fixture 선정과 manifest 설계 선례

Tracking: [M2 CURRENT](../milestones/M2_TEST_SET/CURRENT.md)

## 1. Purpose

이 문서는 renderer 구현 전에 현재 Carrot final state를 고정해 Skia Canvas, node-canvas, Playwright Chromium에 동일한 입력을 제공하기 위한 fixture census다. OCR, 번역, erase, typography 재실행이나 renderer 품질 판정은 범위 밖이다. 기존 `library`와 export 결과는 읽기 전용이며 fixture에는 normalized metadata만 저장했다.

## 2. Corpus

- 권위 원본: `library/works/302a1e8a-7059-4644-8e23-ba0ef85f8d14/chapters/592a103c-0f9b-4416-bff5-8ec3a985600d/chapter.json`
- 실제 페이지: 49 (요청의 약 49와 일치)
- final blocks: 204; non-empty `translatedText`: 200; empty: 4
- 크기: 48 pages가 1280x1791, `_0411.png`만 1280x925
- authoritative source는 final `chapter.json`이다. `runs/*/overlay-items.json`은 사용하지 않았다.
- 최신 reference export: `C:\Users\great\Downloads\test_output\라이스샤워_2부-2026-09-27T11-30-41-464Z`

## 3. Census Method

`chapter.json`의 page/block 순서를 유지하고 실제 field/value만 집계했다. renderer 입력 계약은 `src/shared/textTypes.ts`의 `TranslationBlock`, `src/main/pageExportHtml.ts`의 `PageExportDocumentData`, current artwork 동작은 `RENDERER_CANDIDATE_ANALYSIS.md`를 근거로 삼았다. Render raster는 `src/main/pageExport.ts:450`의 `resolveExportImageSource`와 동일하게 readable `inpaintedImagePath`를 먼저, 실패하면 `imagePath`를 선택한다. Export 이름은 `src/main/jobs/pageImageExportNaming.ts`를 확인했으며, reference는 최신 timestamped export 안에서 source page filename과 정확히 일치시키고 실제 dimensions와 SHA-256을 검증했다.

표의 `tight*`는 `renderBbox ?? bbox` 면적이 페이지 normalized area의 0.15% 이하라는 선택용 heuristic이다. 실제 clipping 판정이 아니다. `long`은 한 block의 번역문이 40자 이상, `many-blocks`는 8 blocks 이상이다. `mixed`는 번역문에 한글과 Latin 또는 문장부호/symbol이 함께 있는 경우다.

## 4. Corpus Feature Summary

### 실제 존재

- 204 blocks 전부 horizontal, center alignment, implicit default font, `lineHeight=1.18`, `letterSpacing=0`, `fontWidthScale=1`, `textOpacity=1`이다.
- 204 blocks 전부 `outlineWidthScale=1`인 primary/inner outline을 가진다. outer outline은 없다.
- block `opacity=0.7`은 전부 존재하지만 `textTypes.ts` 주석상 editor-only block chrome opacity다. exported glyph opacity feature로 세면 안 된다.
- `bubbleLayout`은 178/204 blocks에 존재한다.
- explicit newline은 `_004.jpg` 1 block, `_032.jpg` 3 blocks에 존재한다. 나머지 자동 line wrapping 결과/line count는 데이터만으로 확정할 수 없다.
- 7 long-text pages, 7 tight-fit heuristic pages, 6 pages with >=8 blocks, 37 mixed-text pages가 있다.
- 모든 204 blocks에 `fontFamily`가 없다. 따라서 default CSS stack fallback 가능성이 실제로 존재한다.

### 존재하지 않음

- vertical text, custom/non-default font, bold, italic, alignment variation, non-zero rotation
- perspective transform, curve layout, warp/displacement, generated lettering
- outer outline, text shadow/effect, glow, text background, underline/strikethrough/emphasis
- multiple font/style runs 또는 rich-text run data
- unusual line-height/letter-spacing/width scale

### schema에는 있으나 이번 corpus에는 없음

`TranslationBlock`에는 vertical direction, `fontFamily`, `outerOutline*`, `textEffect`, `textGlow`, `perspectiveTransform`, `curveLayout`, `warpTransform`, `generatedLettering` 등이 정의돼 있지만 이 chapter의 final blocks에는 값이 없다. Synthetic fixture로 보충하지 않았다.

### UNKNOWN

- 자동 wrapping 후 실제 line count 및 visual clipping 여부
- Chromium이 default stack에서 실제 선택한 font file/face
- raster만 보고 추론해야 하는 translation transform이라는 별도 개념. 현재 schema에는 rotation/perspective/curve/warp가 각각 있으며 모두 미사용이다.

## 5. Per-Page Feature Census

모든 non-empty block은 horizontal/default-font/center/primary-outline이므로 반복 열은 생략한다. `translated`는 non-empty 번역 block 수다.

| page | blocks | translated | max chars | min box area | distinguishing notes |
|---|---:|---:|---:|---:|---|
| _001.jpg | 0 | 0 | 0 | 0 | |
| _003.jpg | 0 | 0 | 0 | 0 | |
| _004.jpg | 6 | 6 | 35 | 0.00963 | explicit-NL, mixed |
| _005.jpg | 5 | 5 | 48 | 0.01081 | long, mixed |
| _006.jpg | 2 | 2 | 20 | 0.01744 | mixed |
| _007.jpg | 6 | 6 | 32 | 0.00148 | tight*, mixed |
| _008.jpg | 4 | 4 | 24 | 0.01164 | mixed |
| _009.jpg | 7 | 7 | 56 | 0.00945 | long, mixed |
| _010.jpg | 6 | 6 | 38 | 0.00435 | mixed |
| _011.jpg | 8 | 8 | 129 | 0.00949 | many-blocks, long, mixed |
| _012.jpg | 10 | 10 | 46 | 0.00316 | many-blocks, long, mixed |
| _013.jpg | 6 | 6 | 39 | 0.00578 | mixed |
| _014.jpg | 3 | 3 | 27 | 0.00662 | |
| _015.jpg | 7 | 6 | 38 | 0.00050 | tight*, mixed, empty-text |
| _016.jpg | 6 | 6 | 33 | 0.00387 | mixed |
| _017.jpg | 2 | 2 | 13 | 0.02457 | mixed |
| _018.jpg | 10 | 10 | 38 | 0.00679 | many-blocks, mixed |
| _019.jpg | 7 | 7 | 37 | 0.01113 | mixed |
| _020.jpg | 6 | 6 | 37 | 0.00703 | mixed |
| _021.jpg | 9 | 9 | 33 | 0.00135 | many-blocks, tight*, mixed |
| _022.jpg | 3 | 3 | 27 | 0.00705 | mixed |
| _023.jpg | 2 | 2 | 19 | 0.00286 | mixed |
| _024.jpg | 2 | 2 | 6 | 0.00468 | mixed |
| _025.jpg | 5 | 5 | 25 | 0.00075 | tight*, mixed |
| _026.jpg | 3 | 2 | 20 | 0.00065 | tight*, mixed, empty-text |
| _027.jpg | 2 | 2 | 6 | 0.00154 | mixed |
| _028.jpg | 2 | 2 | 15 | 0.00357 | mixed |
| _029.jpg | 6 | 6 | 52 | 0.00280 | long, mixed |
| _030.jpg | 2 | 2 | 9 | 0.01511 | mixed |
| _031.jpg | 10 | 10 | 46 | 0.00504 | many-blocks, long, mixed |
| _032.jpg | 6 | 6 | 34 | 0.00847 | 3 explicit-NL blocks, mixed |
| _033.jpg | 4 | 4 | 23 | 0.01432 | mixed |
| _034.jpg | 0 | 0 | 0 | 0 | |
| _035.jpg | 3 | 2 | 18 | 0.00723 | empty-text |
| _036.jpg | 1 | 1 | 20 | 0.02338 | |
| _037.jpg | 3 | 3 | 26 | 0.01755 | mixed |
| _038.jpg | 3 | 3 | 18 | 0.01284 | mixed |
| _039.jpg | 3 | 3 | 25 | 0.01663 | mixed |
| _042.jpg | 1 | 1 | 5 | 0.02406 | |
| _043.jpg | 3 | 3 | 20 | 0.01932 | |
| _044.jpg | 1 | 1 | 8 | 0.08835 | |
| _045.jpg | 7 | 7 | 26 | 0.00103 | tight*, mixed |
| _046.jpg | 7 | 7 | 22 | 0.00430 | mixed |
| _047.jpg | 9 | 9 | 47 | 0.00075 | many-blocks, long, tight*, mixed |
| _048.jpg | 2 | 2 | 29 | 0.02269 | mixed |
| _049.jpg | 0 | 0 | 0 | 0 | |
| _050.jpg | 1 | 0 | 0 | 0.71016 | empty-text |
| _052.jpg | 1 | 1 | 7 | 0.00263 | mixed |
| _0411.png | 2 | 2 | 10 | 0.00587 | only 1280x925 page |

## 6. Selected Fixtures

8 pages로 실제 feature를 중복 최소화해 포괄한다.

| page | page ID | selection rationale |
|---|---|---|
| _004.jpg | e311fd1f-0bf2-4fc1-99f5-646dc1be76c2 | 일반 dialogue, explicit newline |
| _011.jpg | 74d0a78f-93fe-4c24-97b9-25c09382784d | corpus 최장 129-char block, wrapping stress, 8 blocks |
| _012.jpg | 50443352-6248-45ef-8d09-d9f99fe7ab59 | 최대 10 blocks, long/mixed text |
| _015.jpg | 6b059220-b404-4d21-89b1-8a8ec7ee1635 | 가장 작은 선택 box, empty translated block 처리 |
| _018.jpg | f8a2d41b-d26e-44ce-aaf4-8d0600c984fd | 최대 10 blocks, high text density |
| _029.jpg | 676ba29f-3ce3-4bf6-ae47-4ca34169ed3b | 52-char long/mixed text, 비교적 tight geometry |
| _047.jpg | 678fcdee-4806-4a15-9228-9286f1abf92c | 9 blocks, long text, very small box heuristic |
| _0411.png | 46fe6f58-2468-4e3b-9f9b-b8ce7dec4247 | 유일한 1280x925 및 PNG-named source page |

## 7. Coverage Matrix

| feature | _004 | _011 | _012 | _015 | _018 | _029 | _047 | _0411 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| typical dialogue | ✓ | | | | | | | |
| explicit newline | ✓ | | | | | | | |
| longest/wrapping stress | | ✓ | ✓ | | | ✓ | ✓ | |
| maximum block count | | | ✓ | | ✓ | | | |
| tight-fit heuristic | | | | ✓ | | ✓ | ✓ | |
| empty translated block | | | | ✓ | | | | |
| mixed language/symbol | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| primary outline | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| max corpus dimension 1280x1791 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| distinct 1280x925 dimension | | | | | | | | ✓ |
| default/system fallback | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Vertical, custom font, rotation, perspective, curve, warp, generated lettering은 corpus에 없으므로 coverage하지 않는다.

## 8. Reference PNG Mapping

최신 export에는 49 source names 모두에 대응하는 raster가 있다. 선택 8개는 이름과 dimensions가 모두 일치해 8/8 mapping 성공, missing 0이다. 다만 사용자의 “PNG”라는 일반 표현과 달리 current export mode는 source extension을 보존하여 7개가 JPEG이고 `_0411.png`만 PNG다. Manifest는 오해를 피하려고 `referenceImage`로 기록한다.

| page | reference filename | format | dimensions | mapping |
|---|---|---|---|---|
| _004.jpg | _004.jpg | JPEG | 1280x1791 | mapped |
| _011.jpg | _011.jpg | JPEG | 1280x1791 | mapped |
| _012.jpg | _012.jpg | JPEG | 1280x1791 | mapped |
| _015.jpg | _015.jpg | JPEG | 1280x1791 | mapped |
| _018.jpg | _018.jpg | JPEG | 1280x1791 | mapped |
| _029.jpg | _029.jpg | JPEG | 1280x1791 | mapped |
| _047.jpg | _047.jpg | JPEG | 1280x1791 | mapped |
| _0411.png | _0411.png | PNG | 1280x925 | mapped |

전체 absolute paths와 SHA-256은 `fixtures/manifest.json`에 있다. Existing export는 복사/이동/수정하지 않았다.

## 9. Image Inputs

선택 8개 모두 readable `inpaintedImagePath`가 있어 `inpainted` input으로 고정했다. 실제 raster dimensions는 reference와 일치한다. Repository-relative path, full SHA-256, dimensions는 manifest에 기록했다. 원본 raster를 fixture 디렉터리로 복제하지 않았다.

| page | input kind | dimensions | SHA-256 (prefix) |
|---|---|---|---|
| _004.jpg | inpainted | 1280x1791 | 51f49f4b54b7e5ce |
| _011.jpg | inpainted | 1280x1791 | e038738ac409c768 |
| _012.jpg | inpainted | 1280x1791 | 6852b0a0d42ac5c2 |
| _015.jpg | inpainted | 1280x1791 | ab14b1974b91b990 |
| _018.jpg | inpainted | 1280x1791 | f30b56ba9b44ea9e |
| _029.jpg | inpainted | 1280x1791 | 9f5ae65a6b3ed9f |
| _047.jpg | inpainted | 1280x1791 | 9279aabebbeb44d1 |
| _0411.png | inpainted | 1280x925 | aaca60cfc1dba908 |

## 10. Font Inventory

모든 선택 block에서 `fontFamily`가 absent다. `src/shared/blockFontCatalog.ts`의 `DEFAULT_BLOCK_FONT_STACK`은 `"Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif`이고, development data root에 `fonts/preferences.json`도 없어 `src/main/customFonts.ts`의 default preference (`defaultFontId: "default"`)가 적용된다. `pageExportHtml.ts`는 custom font만 file URL로 명시하고 default stack은 system resolution에 맡긴다.

따라서 8/8 fixtures 모두:

- logical font: `default`
- resolved CSS family: 위 default stack
- actual file path/format/hash: `UNRESOLVED_SYSTEM_FALLBACK`
- exact file resolve success: 0 fixtures / failure-unresolved: 8 fixtures

Bundled fonts가 repository에 존재하더라도 이 chapter는 해당 font ID를 지정하지 않으므로 임의로 대입할 수 없다. 현재 Chromium reference와 다른 renderer의 공정한 glyph metrics 비교를 막는 핵심 blocker다.

## 11. Fixture Manifest Design

`RoverCarrot/spikes/renderer-comparison/fixtures/manifest.json` version 1은 renderer-neutral data만 가진다.

- source chapter path/hash/page count
- latest read-only reference export identity
- page identity와 feature tags
- selected render image kind/path/dimensions/hash
- reference image status/path/dimensions/hash와 mapping evidence
- normalized page snapshot path/hash
- font logical resolution 및 unresolved status

각 `fixtures/pages/<page-id>.json`은 page dimensions, block order, translated text, bbox/renderBbox/bubble layout 및 실제 PageArtwork typography/effect/transform contract를 고정한다. Optional contract keys는 deterministic shape를 위해 `null`로 직렬화되지만 synthetic value를 만들지 않는다. OCR/source text, confidence, workflow/review metadata와 chapter 전체는 복사하지 않았다. Snapshot JSON은 UTF-8 without BOM, stable property/block order로 작성하고 그 bytes의 SHA-256을 manifest에 기록했다.

## 12. Missing / Unresolved Inputs

1. `UNRESOLVED_SYSTEM_FALLBACK`: current Chromium이 실제 사용한 font file/face와 그 hash를 source/data만으로 확정할 수 없다.
2. 자동 wrapping line count와 actual clipping은 render 실행 전에는 UNKNOWN이다. Census의 tight 표시는 geometry heuristic뿐이다.
3. 이 corpus에는 vertical/rotation/perspective/curve/warp/custom-font/generated-lettering fixture가 없다. 비교 결과는 그 기능들로 일반화할 수 없다.
4. Reference raster는 7 JPEG + 1 PNG다. Pixel-exact comparison은 JPEG encoding artifact를 고려해야 하며, 필요하면 동일 final state로 lossless reference를 별도 생성하는 후속 결정이 필요하다. 이번에는 재-export하지 않았다.

## 13. Readiness for Comparison Spike

입력 image, final snapshots, 8/8 references, dimensions, hashes는 준비됐다. 그러나 typography renderer 비교를 공정하게 시작할 상태는 **아니다**. Exact font file이 unresolved이기 때문이다. Font를 무시한 pipeline wiring 실험은 가능하지만 renderer fidelity 점수로 사용해서는 안 된다.

## 14. Exact Next Step

Renderer 구현 전에 한 가지를 먼저 결정하고 고정한다: current Chromium reference가 사용한 exact system font file을 식별해 hash와 배포 가능성을 기록하거나, 모든 candidate가 사용할 portable font file을 명시적으로 pin한 뒤 같은 font로 Chromium reference를 다시 생성한다. 그 다음 manifest/reference hash를 새 immutable revision으로 갱신하고 세 candidate spike를 시작한다. 기존 manifest를 조용히 덮어써 다른 fixture로 취급하지 않는다.
