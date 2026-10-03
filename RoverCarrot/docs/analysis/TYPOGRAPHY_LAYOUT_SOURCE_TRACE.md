# Typography / layout source trace

## Project Tracking

- [M1 implementation Step 5 / D18](../milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#step-5--typography--layout)
- [M1-CORE-001](../milestones/M1_LINUX_PORT/CURRENT.md#m1-core-001--linux-core-pipeline-port)
- [M1-DETECT-001](../milestones/M1_LINUX_PORT/CURRENT.md#m1-detect-001--koharu-layout-onnx-linux-runtime)
- [M1-RENDER-001](../milestones/M1_LINUX_PORT/CURRENT.md#m1-render-001--linux-renderer-skia-canvas-primary-playwright-chromium-fallback)

Source authority: read-only root fork `fd461737`. Paths below are root reference
paths. This trace describes the autoFont=false configured path. Validation and
open acceptance questions live in [STEP5_VALIDATION](../milestones/M1_LINUX_PORT/STEP5_VALIDATION.md).

## Typography call path (FACT)

`createWorkflowTypography.prepare` (`main/pageWorkflow/pageWorkflowTypography.ts`)
selects nonempty pages, prepares an analysis run with OCR prepass skipped, sets
whole-page options (`autoFontMatching=plan.autoFont`,
`aiFontSizeMatching=plan.autoSize`, natural layout disabled), then calls
`prepareWorkflowTypographyPage`. With autoFont=false no chapter font preparation
or automatic-font inference is needed. Work typography profile is outside the
Step 5 scope.

`prepareWorkflowTypographyPage` (`pageWorkflowTypographyInput.ts`) sets keep mode
and fontSizeAutoFit. `workflowOcrHints` invokes `buildKeepBlocksOcrResult` (rounds
pixel bounds) and attaches recognitionSegments only when geometryKey equals
`workflowRegionKey`. `workflowOverlayItems` creates sequential candidate IDs,
normalizes bboxes, copies original text/direction/roles, applies
`applyOcrCandidateGeometryLocks`, and attaches fixed-block-v6 candidate membership.
This is not a plain bbox/sourceText estimator call: geometry locks and source
line geometry are part of the source-size inputs.

`finalizePreparedPageResult` (`main/pipeline/pageResultBuilder.ts`) calls
`runPageTypographyStages` → `estimatePageSourceFontSizes` when autoSize is enabled.
It measures the immutable original BGRA raster, checks dimensions, measures each
eligible item, then refines page-peer hypotheses. The `sourceFontSize*` family
contains Otsu foreground extraction/component cleanup, projection-band estimation,
body/major-pitch/component evidence, OCR-line consensus, single-glyph guards,
ellipsis/punctuation hypotheses and gated page-peer refinement. Constants and
operation order are preserved in the Rover port. Source method is `raster-core-v1`.
Abstention produces no estimate. Non-abort errors log a warning and return an
empty estimate list; abort propagates.

Keep mode uses `buildKeepBlocksCompletedPage` →
`applyOverlayItemsToExistingBlocks` → `applyOverlayItemToExistingBlock` →
`applyKeepBlocksSourceFontSize` → `applySizeOptions` only for a successful estimate.
With autoFont=false, no font decision is applied. Typography's final
`mergeWorkflowTypography` copies only eligible size fields back by block ID,
protecting translation/source/geometry and formatting.

**fontSizePx stays the existing value** in this path. Successful source matching
adds face/confidence/method and switches fontSizeIntent to `source-match`,
autoFitText=false. Renderer performs the later optical/glyph-size fit. This keeps
Step 6's existing `fontSizePx` padding input and Step 7's source-match inputs.
`workflowOrigin.sizeApplied` becomes true only when an eligible output has a truthy
sourceFontFacePx; existing true flags remain true. AutoSize without overwrite
requires an origin, unapplied size, non-manual intent, and unchanged initial size.

`shared/blockFormat.ts` owns formatting defaults; Step 2 already applies those
when creating detection blocks. Typography keep mode does not apply new format
defaults or replace a user font/style.

## Layout call path (FACT)

`layoutWorkflowPage` (`main/pageWorkflow/pageWorkflowImages.ts`) selects IDs with
`workflowTargetBlocks('layout')`: overwrite or absent bubbleLayout. This selector
itself does **not** test translatedText. Missing translation is a separate
`workflowPrerequisiteIssue` condition when translation is not selected; it does
not abort final layout after a partial translation in a workflow that selected
translation. Actual geometry eligibility in `bubbleLayoutBlockEligibility.ts`
requires nonempty translatedText, positive bbox, no inpaintExcluded and no curveLayout.

`runBubbleLayoutPostprocess` receives balanced policy, manual overwrite only on
explicit layout overwrite, optional natural-layout locale, and default padding
ratio. It clones page/blocks before calling the runner, parses and allowlists
render-only patches, validates IDs/duplicates/bounds/profile shape, protects manual
geometry, applies optional natural layout, and returns final layout state. Final
pass failureMode defaults to required; detector/image errors propagate.

`createProductionBubbleLayoutRunner` (`bubbleLayoutFacade.ts`) derives revision
from **both** original and inpainted file path/size/mtimeMs. Its detector always
uses the **original page.imagePath**. Original detections are cached within one
runner/job, including a failed-promise removal so a prepass failure can retry.
Required errors propagate; best-effort errors clear stale generated layouts only
when a revision was obtained. The prepass and final staged workflow create separate
runner instances in Carrot; they do not automatically share detection results.

Detector path: `detectKoharuPageLayout` → original native image decode →
`prepareComicDetectorImage` (1152 square best resize, BGRA→ImageNet CHW) →
CPU/native or WASM runtime → `parseKoharuLayoutOutputs` (dets, labels, masks).
Rover reuses the approved Step 2 CPU runtime, parser and Chromium resize adapter.
No Step 5 cross-stage raw-output cache is added.

`processDetectedBubbleLayouts` associates detections, selects bubble candidates,
partitions shared ownership among **all eligible blocks**, refines masks with
bilinear sampling and signed-distance erosion, and builds logical-axis shape spans.
It does not filter competitors to only requested target IDs. Safe inset depends
on fontSizePx, effective outline width and policy. Padding/rebasing happens after
safe geometry. Generated output includes bubbleLayout and normalized renderBbox;
source bbox is untouched. SourceImageRevision hashes page revision, bbox/space,
resolved automatic render direction and model ID. Unusable results clear only
previous generated layouts, not user geometry. No ellipse/flood fallback is added.

`bubbleLayoutRunnerPatches.ts` validates every raw patch before target filtering,
then selects the render allowlist. `inpaintingLayoutState.ts` applies states,
deleting optional geometry when null and preserving source/translation unless
explicit text/direction state is included. Natural layout is disabled in the
configured path; its existing helper graph remains available for the configuration
option, without adding advanced sculpt/correction.

## Step 6 reuse (FACT / port boundary)

Carrot's erase prepass calls the same runner/postprocess with paddingRatio=0,
sharedOwnershipGapPx=0, includeTypographySegmentation=true, best-effort mode. These
options are available on Rover's LayoutRunner boundary and adapter. Shared-group
IDs and segmentation are job-local metadata, never persisted as extra block keys.
Step 5 does not execute the erase prepass or implement erasure.

Rover copies the pure dependency graph under `src/typography/ported`; individual
reference paths are in its `source-map.json`. Type-only imports are erased,
relative imports become local ESM, and unused lint directives/bindings are removed.
Selected exports isolate keep-block OCR hints, typography items and needed geometry
functions without importing automatic font matching or editor transforms. The
raster-loader seam and warning callback adapt Electron/logging dependencies;
source-size and shape algorithms remain reference-derived. `src/layout` reuses
that graph through injected runtime ports; Core/Pipeline never import adapters.
