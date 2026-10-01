# Carrot loader / minimum output contract

## Project Tracking

- [M1-COMPAT-001](../milestones/M1_LINUX_PORT/CURRENT.md#m1-compat-001--windows-carrot과의-output-interoperability)
- [M1 Step 1](../milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#step-1--core-architecture-contracts--cli-adapter)

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
- `importPageMaterialize.ts`: reference import probes dimensions, copies source raster, converts WebP, assigns IDs and records idle pages. Step 1 can use PNG files without implementing archive/import parity.
- `sharePackage.ts`: GUI share import is a separate ZIP contract (`manga-gemma-translator-share`, version 1, manifest). A library directory is not that share archive. The importer validates manifest/chapter entries and materializes images with new identities (`shareImportMaterialize.ts`), rather than opening arbitrary chapter JSON paths.

## Step 1 decision (user approved 2026-10-02)

User approved Node.js/TypeScript, JSON config and chapter JSON persistence. Use an isolated, newly created library output root, preserving the above chapter JSON layout. Never modify an existing Carrot library. Copy a single PNG or a folder's direct PNG files into chapter `pages/`; store Linux absolute paths containing the relocation marker. On Windows copy the generated library to a separate Carrot data root configured for validation, then verify open/use in Step 8. Do not merge into a live library by replacing its index.

Keep run diagnostics and dummy stage receipts outside strict Carrot records. Use a persistence port owned by Core; runtime providers must return pending context with page changes in one future commit. No multi-file transaction is claimed in Step 1: translation/context writes are unsupported until Step 4.

## Limits / remaining validation

Source compliance is evidence, not proof of interoperability. Real Windows open/edit/export, blocks, typography/fonts, artifacts, context, and ZIP share packaging are outside this initial skeleton. PNG input only is the minimum contract, not a decision to discard reference folder/archive/WebP import behavior; D10 remains for Step 8.
