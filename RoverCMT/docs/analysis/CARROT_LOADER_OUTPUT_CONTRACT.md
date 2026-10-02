# Carrot loader / minimum output contract

## Project Tracking

- [M1-COMPAT-001](../milestones/M1_LINUX_PORT/CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability)
- [M1 Step 1](../milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter)
- [M1-INPUT-001](../milestones/M1_LINUX_PORT/CURRENT.md#m1-input-001--carrot-inputimport-parity)

2026-10-02 source trace. Reference: fork `fd461737`; current repository HEAD before work: `4f808e213cd0ed5042f25079ab85ab90c5f056a5`. No real Windows open/use validation performed here.

## Loader facts

Source paths below are repository-root reference files, not Rover runtime dependencies.

- `src/main/libraryStore/libraryPaths.ts`: library root contains `index.json` and `works/<workId>/work.json`; chapters live at `works/<workId>/chapters/<chapterId>/chapter.json`.
- `libraryFiles.ts`: index/work/chapter reads use strict schemas from `src/shared/ipcLibrarySchemas.ts`, then validate IDs, duplicate order IDs, work/chapter location and page image paths. Page IDs must be unique; each pageOrder entry must refer to a page. A plain directory of rendered images does not restore blocks/context.
- Minimum index: `{workOrder: [workId]}`. Work: `id`, `title`, `chapterOrder`, `createdAt`, `updatedAt`; `readingDirection` optional.
- Minimum chapter: `id`, `workId`, `title`, `sourceKind`, `status`, `pageOrder`, `pages`, `createdAt`, `updatedAt`. Source kind accepts `images` or `folder` (also archive/PDF variants). Status accepts idle/running/completed/partial/failed.
- Minimum stored page: `id`, `name`, `imagePath`, positive integer `width`, `height`, `blocks`, `analysisStatus`, `createdAt`, `updatedAt`. `dataUrl` is not stored. Empty blocks are valid. Strict schemas prohibit extra Rover-only keys.
- `libraryFiles.ts` requires supported image paths within the library AND owning chapter. Raster existence is checked when opened (`assertChapterImagePath`). Inpainting and mask paths have the same scope restriction.
- `chapterImageRelocation.ts` can relocate an old absolute path using `/works/<workId>/chapters/<chapterId>/` and its suffix. Fallback probes `pages/<basename>` and `inpainted/<basename>`. This supports copying a library between machines in source terms; actual Windows behavior remains Step 8 validation.
- `chapterSnapshots.ts`: reorders pages, adds an empty dataUrl and normalizes blocks; recalculates chapter completion from page state. A successful skeleton run must not imply translated page completion.
- `workContextFiles.ts`: missing style-guide and story-memory files have defaults. Malformed existing context fails schema checks. They are not required for an empty imported chapter.
- `pageWorkflowMutations.ts`: page content/receipt, work and pending style guide/story memory are committed via one library transaction, with revision/timestamp checking. Later translation persistence must preserve that combined commit meaning.
- `importPageMaterialize.ts`: reference import probes dimensions, copies source raster, converts WebP, assigns IDs and records idle pages. Full input/import trace: [Input / import capability](#input--import-capability-d10-source-trace-2026-10-02).
- `sharePackage.ts`: GUI share import is a separate ZIP contract (`manga-gemma-translator-share`, version 1, manifest). A library directory is not that share archive. The importer validates manifest/chapter entries and materializes images with new identities (`shareImportMaterialize.ts`), rather than opening arbitrary chapter JSON paths.

## Step 1 decision (user approved 2026-10-02)

User approved Node.js/TypeScript, JSON config and chapter JSON persistence. Use an isolated, newly created library output root, preserving the above chapter JSON layout. Never modify an existing Carrot library. Copy a single PNG or a folder's direct PNG files into chapter `pages/`; store Linux absolute paths containing the relocation marker. On Windows copy the generated library to a separate Carrot data root configured for validation, then verify open/use in Step 8. Do not merge into a live library by replacing its index.

Keep run diagnostics and dummy stage receipts outside strict Carrot records. Use a persistence port owned by Core; runtime providers must return pending context with page changes in one future commit. No multi-file transaction is claimed in Step 1: translation/context writes are unsupported until Step 4.

## Limits / remaining validation

Source compliance is evidence, not proof of interoperability. Real Windows open/edit/export, blocks, typography/fonts, artifacts, context, and ZIP share packaging are outside this initial skeleton. PNG input only is the minimum contract, not a decision to discard reference folder/archive/WebP import behavior; D10 remains for Step 8.

## Input / import capability (D10 source trace, 2026-10-02)

Reference fork `fd461737` 기준 source trace다. 사용자-facing entry point(IPC/dialog/drop)에서 materialization/decode까지 추적했고, 실행 검증은 하지 않았다. `FACT`는 source에서 직접 확인한 것, `INFERENCE`는 source로부터의 추론, `UNCONFIRMED`는 source만으로 확정할 수 없는 것이다. 이 절은 Carrot 사실만 기록한다. M1 parity 분류와 구현 계획은 [M1-INPUT-001](../milestones/M1_LINUX_PORT/CURRENT.md#m1-input-001--carrot-inputimport-parity)이 관리한다.

### Entry points (FACT)

| Entry point | IPC channel / 함수 | dialog filter / 판정 | 처리 |
|---|---|---|---|
| 이미지 파일 선택(복수) | `import:preview-images` → `importPreviewIpc.ts:registerImageImportPreviewIpc` → `importWorkflow.ts:previewImages` | `png, jpg, jpeg, webp` | 1 chapter(`sourceKind: images`) |
| 폴더 선택 | `import:preview-folder` → `previewFolder` | directory | 1 chapter(`folder`), direct file만 |
| archive 선택 | `import:preview-zip` → `importContainerPreviewIpc.ts` → `importPreparedPreview.ts:prepareArchiveImportPreview` | `zip, cbz, rar, cbr`(`src/shared/archive.ts`) | ZIP/CBZ: `previewZip`; RAR/CBR: native runner |
| PDF 선택 | `import:preview-pdf` → `preparePdfImportPreview` | `pdf` | native runner rasterize |
| 일괄 가져오기(폴더) | `import:preview-zip-folder` → `prepareArchiveFolderImportPreview` | directory | 여러 chapter(`mode: batch`) |
| drag & drop | `import:preview-dropped` → `library/libraryImportDrop.ts:classifyDroppedImportPaths` → `previewDroppedSource` | 아래 규칙 | 위 경로와 같은 함수로 위임 |
| 웹 페이지 URL | `web-import:scan` / `web-import:prepare` → `webImportSessionManager.ts` | URL 문자열 | 다운로드한 이미지를 `images` chapter로 |
| `.mgtshare` 공유 패키지 | `share:preview-import` / `share:import` → `sharePackage.ts`, `shareImportMaterialize.ts` | `mgtshare` | Carrot이 export한 작품 패키지 복원(원본 만화 input이 아님) |

- 모든 원본 input 경로는 preview(`ImportPreviewResult`) → GUI 선택 → `import:create` → `importWorkflow.ts:createImportFromPreviewUnlocked` → page마다 `importPageMaterialize.ts:materializePageRecord`로 합류한다. 사용자는 preview에서 chapter/page 선택을 바꿀 수 있고, 새 작품 또는 기존 작품에 chapter로 추가할 수 있다.
- drop 규칙(`classifyDroppedImportPaths`): directory는 단독일 때만 `folder`; PDF·archive도 단독일 때만 허용; 나머지는 모두 지원 이미지 확장자여야 `images`, 하나라도 아니면 `unsupported-files`로 거부(무시가 아님). 상대 경로·stat 실패는 unsupported.
- clipboard 이미지 붙여넣기 import는 없다. renderer의 clipboard 사용은 텍스트/block 편집용이다(`useBlockClipboard.ts` 등).
- linked workspace(`linked-workspace:*`, `ImportLinkedWorkspaceSection.tsx`)는 import 시 켜는 **결과 mirror 출력** 기능이다. input 경로가 아니다(`linkedWorkspacePaths.ts`의 확장자 집합은 `format: source` 출력 이름 결정용).
- review text import(`review:import-text`), conditional batch YAML import는 page input이 아니다.

### 직접 이미지 형식 (FACT)

- allowlist는 `src/main/libraryStore/storage.ts:isSupportedImagePath` 하나다: `.png .jpg .jpeg .webp`(대소문자 무시). folder/ZIP/drop/loader(`libraryFiles.ts`)가 같은 함수를 쓰고, RAR runner(`rar_import.rs:supported_extension`)도 같은 4개만 고른다.
- 확장자는 **후보 필터**일 뿐이다. 실제 형식은 content signature로 판정한다(`imageHeaderProbe.ts:probeImageMachine`: PNG signature+IHDR, JPEG `FFD8`, RIFF/WEBP). 확장자와 content가 달라도(예: PNG bytes인 `.jpg`) 지원 3형식 중 하나면 받아들이고, 저장 확장자를 content 기준으로 다시 정한다(`importPageMaterialize.ts:resolveImportOutputExt`).
- 저장 형식: PNG → `.png` 원본 copy; JPEG → 원본 copy, 확장자 `.jpg`(원본이 `.jpeg`면 `.jpeg`); **WebP → ffmpeg로 PNG 변환 후 `.png`**(`importImages.ts:convertValidatedWebpImportImage` → `simplePageRuntime.ts:convertImageToPngFileThroughRuntime` → `runtime/assets/image-file-validation.cjs`). 저장 이름 `NNN-<pageId><ext>`.
- metadata: width/height는 header probe에서 얻는다. JPEG은 EXIF orientation 5–8이면 width/height를 **회전 후 값으로 swap**해 기록하고 파일은 회전하지 않는다(`imageHeaderProbeJpeg.ts`). 저장 후 다시 probe해 크기가 같은지 확인하고 ffmpeg(`-frames:v 1`)로 전체 decode 검증한다(`validateStoredImportImage`).
- 한계: 파일 256 MiB(`MAX_IMPORT_IMAGE_BYTES`), 120,000,000 pixel(`imageDecodeLimits.ts`), 한 변 100,000(`MAX_IMAGE_DIMENSION`), decode timeout 120 s.
- JFIF: `.jfif` 확장자는 allowlist에 없다. dialog filter, folder 목록, drop 모두에서 제외된다. JFIF content를 `.jpg`로 이름 붙인 파일은 JPEG으로 처리된다.
- GIF, BMP, TIFF, AVIF, HEIC, SVG: allowlist·probe·runner 어디에도 없다. 웹 import는 `image/(avif|bmp|gif|svg+xml|tiff|x-icon)` content-type을 명시적으로 `unsupported`로 skip한다(`webImportDownload.ts:isKnownUnsupportedImageType`).
- Animated WebP: probe가 `ANMF` chunk를 허용하고 canvas 크기를 쓴다. ffmpeg `-frames:v 1`이므로 첫 frame만 PNG가 되는 것으로 보인다(`INFERENCE`). 번들 ffmpeg가 animated WebP를 decode하는지는 `UNCONFIRMED`.

### Directory (FACT)

- `previewFolder`: 선택 폴더의 **direct file만**(`importSources.ts:listImageFiles`, non-recursive). 하위 폴더는 무시된다.
- 정렬: `storage.ts:sortNaturally` = `localeCompare(undefined, {numeric: true, sensitivity: "base"})`(대소문자 무시 natural order).
- 지원하지 않는 확장자 파일은 조용히 무시된다.
- header가 잘못된 지원 확장자 파일은 **제외(excluded)**하고 preview에 `invalid-image-header`로 표시한다(`importImages.ts:inspectImportImageFiles`). 유효 page가 하나도 없을 때만 오류다. header는 맞지만 pixel data가 손상된 파일은 commit 중 ffmpeg 검증에서 실패하며, page를 순차 materialize하는 library transaction 전체가 실패한다(`createImportFromPreviewUnlocked`).
- 일괄 가져오기(`previewZipFolder` + RAR): 최상위 `.zip/.cbz`와 `.rar/.cbr` 각각을 chapter로, 이미지가 있는 하위 폴더(최대 depth 8, 500 folder, 5,000 page; `listNestedImageFolders`)를 각각 chapter로 만든다. 최상위 폴더 자체의 직접 이미지는 chapter가 되지 않는다. 하위 폴더 chapter title은 상대 경로다. 최종 chapter 순서는 ZIP·폴더·RAR chapter 전체를 title 기준 natural sort한 것이다(`importPreparedPreview.ts`). RAR은 최상위만 보고 하위 폴더 안 archive는 보지 않는다.

### Archive (FACT)

| 형식 | 경로 | 구현 | page 탐색·정렬 |
|---|---|---|---|
| ZIP, CBZ | `importSources.ts:listImageEntriesInZip`, materialize 시 `zipSafety.ts:openZipArchiveReader` | `yauzl`(Node) | 모든 depth의 비-directory entry 중 지원 확장자. 전체 entry path로 natural sort(대소문자 무시) → **1 chapter로 평탄화**. 예산: entry 10,000, 압축 해제 총 4 GiB, 압축률 100, page 256 MiB, 중복 entry 이름 거부 |
| RAR, CBR | `importSourceRunner.ts:stageImportSource("rar")` → `tools/mgt-import-source-runner`(Rust, 앱에 번들) | crate `rars` 0.6 | 지원 확장자, directory·`__MACOSX`·`._*`·`.DS_Store`·`Thumbs.db`·`desktop.ini` 제외. 이름 natural sort(소문자화) 후 temp에 `page-NNNNNN.<ext>`로 추출 → 일반 file page로 materialize. encrypted entry·multi-volume·중복 이름은 실패 |
| PDF | `stageImportSource("pdf")` → 같은 runner | crate `hayro` 0.7 | 모든 page를 300 DPI 목표(한계 내 축소)로 PNG rasterize. 암호화 PDF 실패. 최대 2,000 page |
| 7z | 없음 | — | `src/`·runner 어디에도 7z 처리 없음 |

- ZIP entry는 preview 단계에서 content probe를 하지 않는다. materialize 때 `probeImageBuffer`가 실패하면 import 전체가 실패한다. ZIP은 RAR과 달리 `__MACOSX/._*` 같은 metadata entry를 거르지 않으므로, 그런 entry가 지원 확장자를 가지면 import가 실패하는 것으로 보인다(`INFERENCE`). 손상·암호화 ZIP 동작은 yauzl 오류 전파로 추정한다(`UNCONFIRMED`).
- runner 결과는 manifest schema, 파일 목록, byte 크기를 재검증하고 `inspectImportImageFiles`에서 하나라도 제외되면 전체 실패한다.

### URL / web page import (FACT)

- 일반 **web page URL**을 받는다. 특정 사이트 provider는 없다. URL policy가 private/local 주소를 거부한다(`webImportUrlPolicy.ts`).
- 격리 session의 hidden Electron `BrowserWindow`에 page를 load·scroll하고, DOM에서 `img` `currentSrc`/`srcset`, `data-srcset`류 lazy 속성, CSS `background-image`, iframe을 수집한다(`webImportPageDiscovery.ts`, 최대 5,000 URL). 화면 위치(y, x, 발견 순) 기준으로 정렬하고 URL 중복을 제거한다.
- 다운로드(`webImportDownload.ts`, 동시 6, 총 2 GiB, scan 90 s): content-type의 알려진 미지원 형식은 skip하고, content probe로 PNG/JPEG/WebP만 받는다. SHA-256 중복은 skip한다.
- 사용자가 GUI에서 후보를 선택하면 `createPreparedWebImportPreview`가 `images` chapter를 만든다(page 이름 `1.png`…, `storageStem`). 이후는 일반 file page materialization이다(WebP → PNG).
- archive URL 다운로드, 단일 이미지 URL 전용 경로는 없다. 단일 이미지 URL을 page로 load했을 때 discovery가 그 이미지를 찾는지는 실행 검증하지 않았다(`UNCONFIRMED`).
