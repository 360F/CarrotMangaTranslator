import type { MangaPage } from "../../shared/libraryTypes";
import { bboxToPixels, clamp } from "../../shared/geometry";
import { estimatePageSourceFontSizes } from "../pipeline/sourceFontSizeEstimator";
import type { SourceFontSizeEstimate } from "../pipeline/sourceFontSizeGeometryTypes";
import { workflowOverlayItems } from "./pageWorkflowTypographyInput";
import {
  DEFAULT_SOURCE_FACE_TO_EM_RATIO,
  SOURCE_MATCH_OPTICAL_SCALE,
} from "../../shared/sourceFontSizeConstants";

const MIN_LEGACY_RATIO = 0.75;
const MAX_LEGACY_RATIO = 1.3;
const MIN_NOMINAL_SIZE_PX = 6;
const MAX_NOMINAL_SIZE_PX = 160;

export type PreparedSourceErasePage = Readonly<{
  page: MangaPage;
  scaleByBlockId: ReadonlyMap<string, number>;
}>;

export async function prepareSourceErasePage(
  page: MangaPage,
  signal?: AbortSignal,
): Promise<PreparedSourceErasePage> {
  const items = workflowOverlayItems(page);
  const estimates = await estimatePageSourceFontSizes({
    enabled: true,
    items,
    page,
    signal,
  });
  const trusted = estimates.map(trustedFacePx);
  const scaleByBlockId = new Map<string, number>();
  const blocks = page.blocks.map((block, index) => {
    const legacy = resolveLegacyScale(block.fontSizePx);
    const scale = resolveSourceEraseScalePx({
      trustedFacePx: trusted[index],
      pagePeerFacePx: resolvePagePeerFacePx(page, index, trusted),
      ocrGeometryFacePx: resolveOcrGeometryFacePx(block),
      sourceBboxFacePx: resolveSourceBboxFacePx(block, page),
      legacyFontSizePx: legacy,
    }).value;
    scaleByBlockId.set(block.id, scale);
    return { ...block, fontSizePx: scale };
  });
  return { page: { ...page, blocks }, scaleByBlockId };
}

export function sourceFaceToNominalEquivalentPx(facePx: number): number {
  return (
    (facePx / DEFAULT_SOURCE_FACE_TO_EM_RATIO) * SOURCE_MATCH_OPTICAL_SCALE
  );
}

export function resolveSourceEraseScalePx(input: {
  trustedFacePx?: number;
  pagePeerFacePx?: number;
  ocrGeometryFacePx?: number;
  sourceBboxFacePx?: number;
  legacyFontSizePx: number;
}): {
  source: "measured" | "page-peer" | "ocr-geometry" | "source-bbox" | "legacy";
  value: number;
} {
  const legacy = resolveLegacyScale(input.legacyFontSizePx);
  const candidates = [
    ["measured", input.trustedFacePx],
    ["page-peer", input.pagePeerFacePx],
    ["ocr-geometry", input.ocrGeometryFacePx],
    ["source-bbox", input.sourceBboxFacePx],
  ] as const;
  const selected = candidates.find(
    ([, value]) => value !== undefined && Number.isFinite(value) && value > 0,
  );
  return selected
    ? {
        source: selected[0],
        value: clampSourceNominalEquivalent(Number(selected[1]), legacy),
      }
    : { source: "legacy", value: legacy };
}

function clampSourceNominalEquivalent(facePx: number, legacy: number): number {
  return clamp(
    Math.round(sourceFaceToNominalEquivalentPx(facePx)),
    Math.max(MIN_NOMINAL_SIZE_PX, Math.round(legacy * MIN_LEGACY_RATIO)),
    Math.min(MAX_NOMINAL_SIZE_PX, Math.round(legacy * MAX_LEGACY_RATIO)),
  );
}

function trustedFacePx(
  estimate: SourceFontSizeEstimate | undefined,
): number | undefined {
  return estimate?.method === "raster-core-v1" &&
    Number.isFinite(estimate.facePx) &&
    estimate.facePx > 0 &&
    estimate.confidence >= 0.5
    ? estimate.facePx
    : undefined;
}

function resolvePagePeerFacePx(
  page: MangaPage,
  blockIndex: number,
  trusted: readonly (number | undefined)[],
): number | undefined {
  const block = page.blocks[blockIndex];
  if (!block) return undefined;
  const peers = page.blocks.flatMap((candidate, index) =>
    index !== blockIndex &&
    candidate.sourceDirection === block.sourceDirection &&
    trusted[index] !== undefined
      ? [Number(trusted[index])]
      : [],
  );
  return median(peers);
}

function resolveOcrGeometryFacePx(
  block: MangaPage["blocks"][number],
): number | undefined {
  const segments = block.workflowOrigin?.recognitionSegments ?? [];
  const crossAxes = segments.flatMap((segment) => {
    const value =
      block.sourceDirection === "vertical"
        ? segment.x2 - segment.x1
        : segment.y2 - segment.y1;
    return Number.isFinite(value) && value > 0 ? [value] : [];
  });
  if (crossAxes.length) return median(crossAxes);
  const boxes = block.workflowOrigin?.recognitionBboxes ?? [];
  return median(
    boxes.flatMap(([x1, y1, x2, y2]) => {
      const value = block.sourceDirection === "vertical" ? x2 - x1 : y2 - y1;
      return Number.isFinite(value) && value > 0 ? [value] : [];
    }),
  );
}

function resolveSourceBboxFacePx(
  block: MangaPage["blocks"][number],
  page: MangaPage,
): number | undefined {
  const box = bboxToPixels(block.bbox, page.width, page.height);
  const crossAxis = block.sourceDirection === "vertical" ? box.w : box.h;
  const lineCount = Math.max(
    1,
    block.sourceText.split(/\r?\n/u).filter((line) => line.trim()).length,
  );
  const facePx = crossAxis / lineCount;
  return Number.isFinite(facePx) && facePx > 0 ? facePx : undefined;
}

function resolveLegacyScale(value: number): number {
  return Number.isFinite(value) && value > 0
    ? clamp(value, MIN_NOMINAL_SIZE_PX, MAX_NOMINAL_SIZE_PX)
    : 20;
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
