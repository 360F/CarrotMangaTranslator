import { resolveFontWeight } from "../../../../src/shared/blockFontWeight";
import { isGeneratedBubbleLayout } from "../../../../src/shared/bubbleLayout";
import {
  bboxToPixels,
  clamp,
  resolveEffectiveRenderBbox,
  resolveFontWidthScale,
} from "../../../../src/shared/geometry";
import { MIN_READABLE_FONT_SIZE_PX } from "../../../../src/shared/readableTextBox";
import { parseRichText } from "../../../../src/shared/richTextMarkup";
import { SOURCE_MATCH_OPTICAL_SCALE } from "../../../../src/shared/sourceFontSizeConstants";
import { resolveBlockTextWordBreak } from "../../../../src/shared/textWrapping";
import type { BBox, TranslationBlock } from "../../../../src/shared/textTypes";
import {
  compareBalancedParagraphs,
  measureBalancedBubbleParagraph,
} from "../../../../src/renderer/src/lib/balancedBubbleTextWrapping";
import { resolveSourceMatchedBubbleFontSize } from "../../../../src/renderer/src/lib/bubbleFontSizeFitting";
import { resolveBubbleTextSlotPlans } from "../../../../src/renderer/src/lib/bubbleTextLayout";
import { measureStyledWrappedTextInSlots } from "../../../../src/renderer/src/lib/bubbleTextWrapping";
import {
  measureStyledGraphemes,
  measureStyledWrappedText,
  type BlockTextLine,
  type TextMeasurementContext,
} from "../../../../src/renderer/src/lib/overlayTextWrapping";
import { resolvePageSourceFontFaceFallbacks } from "../../../../src/renderer/src/lib/sourceFontSizeMatching";

const MIN_FONT_SIZE_PX = MIN_READABLE_FONT_SIZE_PX;
const MAX_AUTOFIT_FONT_SIZE_PX = 256;
const MIN_MATCHED_FONT_SIZE_PX = 4;
const MAX_MATCHED_FONT_SIZE_PX = 200;
const REFERENCE_FONT_SIZE_PX = 100;
const MAX_PROBE_GRAPHEMES = 80;
const MIN_CORNER_FRAGMENT_GRAPHEMES = 8;
const MAX_CORNER_FRAGMENT_AREA_SHARE = 1 / 8;
const CENTRAL_HALF_MAX_CENTER_OFFSET = 1 / 4;

export type NativeLayoutLine = {
  text: string;
  width: number;
  left: number;
  top: number;
  availableWidth: number;
  lineHeight: number;
};

export type NativeBlockLayout = {
  blockId: string;
  rect: { left: number; top: number; width: number; height: number };
  fontSizePx: number;
  lines: NativeLayoutLine[];
  overflow: boolean;
  usedBubbleSlots: boolean;
  layoutPath: "explicit" | "source-match" | "generic-autofit" | "fallback";
  fitBounds: { searchMinPx: number; searchMaxPx: number; selectedPx: number };
  sourceMatch: {
    fontSizeIntent: TranslationBlock["fontSizeIntent"] | null;
    sourceText: string;
    sourceDirection: TranslationBlock["sourceDirection"] | null;
    sourceFontFacePx: number | null;
    sourceFontFaceFallbackPx: number | null;
    sourceFontSizeConfidence: number | null;
    sourceFontSizeMethod: string | null;
    resolvedCapPx: number | null;
  };
};

type NativeMeasurement = {
  fontSizePx: number;
  lines: BlockTextLine[];
  fits: boolean;
  usedBubbleSlots: boolean;
};

type BubbleMeasurement = NonNullable<
  ReturnType<typeof measureStyledWrappedTextInSlots>
>;

export function resolveNativePageSourceFontFaceFallbacks(
  blocks: readonly TranslationBlock[],
  pageSize: { width: number; height: number },
): ReadonlyMap<string, number> {
  return resolvePageSourceFontFaceFallbacks(blocks, pageSize);
}

/**
 * Benchmark-only adaptation of production overlayLayout. Production decision
 * semantics are retained; only Canvas text measurement is injected by the
 * native backend. This module is bundled into the isolated spike.
 */
export function layoutNativeBlock(
  block: TranslationBlock,
  pageSize: { width: number; height: number },
  context: TextMeasurementContext,
  fontFamily: string,
  sourceFontFaceFallbackPx?: number,
): NativeBlockLayout {
  const text = String(block.translatedText ?? "");
  const pixel = bboxToPixels(
    resolveEffectiveRenderBbox(block, pageSize, text),
    pageSize.width,
    pageSize.height,
  );
  const rect = { left: pixel.x, top: pixel.y, width: pixel.w, height: pixel.h };
  const sourceMatchedCapPx = resolveSourceMatchedFontSizeCapPxNative(
    block,
    text,
    pageSize,
    context,
    fontFamily,
    sourceFontFaceFallbackPx,
  );
  const geometryFontSize = Math.max(MIN_FONT_SIZE_PX, block.fontSizePx);
  const preferredFontSize =
    block.fontSizeIntent === "source-match" && sourceMatchedCapPx !== null
      ? Math.max(MIN_FONT_SIZE_PX, Math.floor(sourceMatchedCapPx))
      : geometryFontSize;
  const maximum = resolveAutoFitUpperBound(
    block,
    preferredFontSize,
    rect.width,
    rect.height,
    sourceMatchedCapPx,
  );
  const automaticSourceFit =
    block.fontSizeIntent === "source-match" &&
    block.renderDirection === "horizontal" &&
    !/[\r\n]/u.test(text);
  const searches =
    Boolean(text.trim()) && (automaticSourceFit || (block.autoFitText ?? true));
  const bubbleAvailable = Boolean(
    measureBubbleAtSize(
      block,
      text,
      MIN_FONT_SIZE_PX,
      rect,
      context,
      fontFamily,
      automaticSourceFit,
    ),
  );
  const fitsAtSize = (size: number) =>
    measureAtSize(
      block,
      text,
      size,
      rect,
      context,
      fontFamily,
      automaticSourceFit,
      bubbleAvailable,
    ).fits;
  const fitted = searches
    ? findFittedSize(
        Math.floor(Math.max(MIN_FONT_SIZE_PX, maximum)),
        fitsAtSize,
        automaticSourceFit && isGeneratedBubbleLayout(block.bubbleLayout),
      )
    : Math.max(MIN_FONT_SIZE_PX, maximum);
  const selectedSize =
    sourceMatchedCapPx !== null && bubbleAvailable
      ? resolveSourceMatchedBubbleFontSize(
          block,
          text,
          fitted,
          (size) =>
            measureBubbleAtSize(
              block,
              text,
              size,
              rect,
              context,
              fontFamily,
              automaticSourceFit,
            ) as BubbleMeasurement | null,
        )
      : fitted;
  const selected = measureAtSize(
    block,
    text,
    selectedSize,
    rect,
    context,
    fontFamily,
    automaticSourceFit,
    bubbleAvailable,
  );
  const lineHeight = selected.fontSizePx * block.lineHeight;
  const totalHeight = selected.lines.length * lineHeight;
  const lines = selected.lines.map((line, index) => {
    const textValue = line.runs.map((run) => run.text).join("");
    const slot = line.slot;
    return {
      text: textValue,
      width: line.width,
      left: slot ? rect.left + slot.inlineOffsetPx : rect.left,
      top: slot
        ? rect.top + slot.blockOffsetPx
        : rect.top + (rect.height - totalHeight) / 2 + index * lineHeight,
      availableWidth: slot ? slot.availableWidth : rect.width,
      lineHeight,
    };
  });
  const layoutPath = resolveLayoutPath(block, sourceMatchedCapPx);
  return {
    blockId: block.id,
    rect,
    fontSizePx: selected.fontSizePx,
    lines,
    overflow: !selected.fits,
    usedBubbleSlots: selected.usedBubbleSlots,
    layoutPath,
    fitBounds: {
      searchMinPx: searches
        ? MIN_FONT_SIZE_PX
        : Math.max(MIN_FONT_SIZE_PX, maximum),
      searchMaxPx: Math.max(MIN_FONT_SIZE_PX, Math.floor(maximum)),
      selectedPx: selected.fontSizePx,
    },
    sourceMatch: {
      fontSizeIntent: block.fontSizeIntent ?? null,
      sourceText: String(block.sourceText ?? ""),
      sourceDirection: block.sourceDirection ?? null,
      sourceFontFacePx: finiteOrNull(block.sourceFontFacePx),
      sourceFontFaceFallbackPx: finiteOrNull(
        block.sourceFontFaceFallbackPx ?? sourceFontFaceFallbackPx,
      ),
      sourceFontSizeConfidence: finiteOrNull(block.sourceFontSizeConfidence),
      sourceFontSizeMethod: block.sourceFontSizeMethod ?? null,
      resolvedCapPx: sourceMatchedCapPx,
    },
  };
}

function resolveLayoutPath(
  block: TranslationBlock,
  sourceMatchedCapPx: number | null,
): NativeBlockLayout["layoutPath"] {
  if (block.fontSizeIntent === "source-match") {
    return sourceMatchedCapPx === null ? "fallback" : "source-match";
  }
  return (block.autoFitText ?? true) ? "generic-autofit" : "explicit";
}

function findFittedSize(
  capped: number,
  fits: (size: number) => boolean,
  nonMonotonic: boolean,
): number {
  if (nonMonotonic) {
    for (let size = capped; size >= MIN_FONT_SIZE_PX; size -= 1) {
      if (fits(size)) return size;
    }
    return MIN_FONT_SIZE_PX;
  }
  let low = MIN_FONT_SIZE_PX;
  let high = capped;
  let best = MIN_FONT_SIZE_PX;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return Math.min(best, capped);
}

function resolveAutoFitUpperBound(
  block: TranslationBlock,
  preferredFontSize: number,
  innerWidth: number,
  innerHeight: number,
  sourceMatchedCapPx: number | null,
): number {
  if (!(block.autoFitText ?? true)) return preferredFontSize;
  const heightBound = Math.floor(
    innerHeight / Math.max(1, block.lineHeight || 1),
  );
  const widthBound =
    block.renderDirection === "vertical"
      ? Math.floor(
          innerWidth / (1.15 * resolveFontWidthScale(block.fontWidthScale)),
        )
      : MAX_AUTOFIT_FONT_SIZE_PX;
  const genericUpperBound = clamp(
    Math.max(MIN_FONT_SIZE_PX, heightBound, widthBound),
    MIN_FONT_SIZE_PX,
    MAX_AUTOFIT_FONT_SIZE_PX,
  );
  const roleBound =
    block.fontRole === "sign_ui_title"
      ? Math.min(genericUpperBound, preferredFontSize * 2)
      : genericUpperBound;
  return sourceMatchedCapPx === null
    ? roleBound
    : Math.min(
        roleBound,
        Math.max(MIN_FONT_SIZE_PX, Math.floor(sourceMatchedCapPx)),
      );
}

function measureAtSize(
  block: TranslationBlock,
  text: string,
  fontSizePx: number,
  rect: { width: number; height: number },
  context: TextMeasurementContext,
  fontFamily: string,
  balanceParagraph: boolean,
  bubbleAvailable: boolean,
): NativeMeasurement {
  if (!text.trim()) {
    return { fontSizePx, lines: [], fits: true, usedBubbleSlots: false };
  }
  if (bubbleAvailable) {
    const bubble = measureBubbleAtSize(
      block,
      text,
      fontSizePx,
      rect,
      context,
      fontFamily,
      balanceParagraph,
    );
    if (bubble) {
      return {
        fontSizePx,
        lines: bubble.lines,
        fits: true,
        usedBubbleSlots: true,
      };
    }
  }
  const { runs } = parseRichText(
    text,
    Boolean(block.bold),
    Boolean(block.italic),
    block.fontWeight,
  );
  const lineHeightPx = fontSizePx * block.lineHeight;
  const letterSpacingPx = (block.letterSpacing ?? 0) * fontSizePx;
  const fontWidthScale = resolveFontWidthScale(block.fontWidthScale);
  const effectiveWidth = rect.width / fontWidthScale;
  const measured = measureStyledWrappedText(
    context,
    runs,
    effectiveWidth,
    lineHeightPx,
    fontSizePx,
    fontFamily,
    letterSpacingPx,
    resolveBlockTextWordBreak(block.wordBreak, "horizontal"),
    undefined,
    balanceParagraph,
  );
  return {
    fontSizePx,
    lines: measured.lines,
    fits:
      measured.totalHeight <= rect.height &&
      measured.maxLineWidth <= effectiveWidth,
    usedBubbleSlots: false,
  };
}

function measureBubbleAtSize(
  block: TranslationBlock,
  text: string,
  fontSizePx: number,
  rect: { width: number; height: number },
  context: TextMeasurementContext,
  fontFamily: string,
  balanceParagraph: boolean,
): BubbleMeasurement | null {
  if (!text.trim() || block.curveLayout) return null;
  const { runs, plainText } = parseRichText(
    text,
    Boolean(block.bold),
    Boolean(block.italic),
    block.fontWeight,
  );
  const lineHeightPx = fontSizePx * block.lineHeight;
  const letterSpacingPx = (block.letterSpacing ?? 0) * fontSizePx;
  const fontWidthScale = resolveFontWidthScale(block.fontWidthScale);
  const wordBreak = resolveBlockTextWordBreak(block.wordBreak, "horizontal");
  const plans = resolveBubbleTextSlotPlans(block.bubbleLayout, {
    blockExtentPx: rect.height,
    inlineExtentPx: rect.width,
    fontWidthScale,
    lineHeightPx,
    maximumSlotCount: Math.max(
      1,
      Array.from(plainText.replace(/\r\n?/g, "\n")).length,
    ),
    preferBodyCenter: balanceParagraph,
    renderDirection: "horizontal",
  });
  if (balanceParagraph && isGeneratedBubbleLayout(block.bubbleLayout)) {
    const graphemes = measureStyledGraphemes(
      context,
      runs,
      fontSizePx,
      fontFamily,
    );
    let best: ReturnType<typeof measureBalancedBubbleParagraph> = null;
    for (const slots of plans) {
      if (
        best &&
        best.wordSplitCount === 0 &&
        best.fragmentLineCount === 0 &&
        slots.length > best.lineCount
      ) {
        break;
      }
      const measured = measureBalancedBubbleParagraph(
        graphemes,
        slots,
        lineHeightPx,
        letterSpacingPx,
        wordBreak,
      );
      if (
        measured &&
        (!best || compareBalancedParagraphs(measured, best) < 0)
      ) {
        best = measured;
      }
    }
    return best as BubbleMeasurement | null;
  }
  for (const slots of plans) {
    const measured = measureStyledWrappedTextInSlots(
      context,
      runs,
      slots,
      lineHeightPx,
      fontSizePx,
      fontFamily,
      letterSpacingPx,
      wordBreak,
    );
    if (
      measured.fits &&
      measured.consumedAll &&
      measured.lineCount === slots.length
    ) {
      return measured;
    }
  }
  return null;
}

function resolveSourceMatchedFontSizeCapPxNative(
  block: TranslationBlock,
  text: string,
  pageSize: { width: number; height: number },
  context: TextMeasurementContext,
  fontFamily: string,
  fallbackSourceFacePx?: number,
): number | null {
  const sourceFacePx = resolveUsableSourceFacePx(
    block,
    pageSize,
    fallbackSourceFacePx,
  );
  if (sourceFacePx === null) return null;
  const { plainText } = parseRichText(
    text,
    Boolean(block.bold),
    Boolean(block.italic),
  );
  const probe = Array.from(plainText)
    .filter((grapheme) => !/^\s$/u.test(grapheme))
    .slice(0, MAX_PROBE_GRAPHEMES)
    .join("");
  if (!probe) return null;
  const previousFont = context.font;
  context.font = `${block.italic ? "italic " : ""}${resolveFontWeight(block)} ${REFERENCE_FONT_SIZE_PX}px ${fontFamily}`;
  let facePx = 0;
  if (block.sourceDirection === "vertical") {
    for (const grapheme of Array.from(probe)) {
      const metrics = context.measureText(grapheme);
      facePx = Math.max(
        facePx,
        positive(metrics.actualBoundingBoxLeft) +
          positive(metrics.actualBoundingBoxRight),
      );
    }
  } else {
    const metrics = context.measureText(probe);
    facePx =
      positive(metrics.actualBoundingBoxAscent) +
      positive(metrics.actualBoundingBoxDescent);
  }
  context.font = previousFont;
  const ratio = facePx / REFERENCE_FONT_SIZE_PX;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return clamp(
    Math.round(
      (sourceFacePx / ratio) *
        (block.fontSizeIntent === "source-match"
          ? SOURCE_MATCH_OPTICAL_SCALE
          : 1),
    ),
    MIN_MATCHED_FONT_SIZE_PX,
    MAX_MATCHED_FONT_SIZE_PX,
  );
}

function resolveUsableSourceFacePx(
  block: TranslationBlock,
  pageSize: { width: number; height: number },
  fallbackSourceFacePx?: number,
): number | null {
  if (
    hasUsableSourceFaceMeasurement(block) &&
    hasReliableSourceGeometry(block, pageSize)
  ) {
    return Number(block.sourceFontFacePx);
  }
  const fallback = Number(
    block.sourceFontFaceFallbackPx === undefined
      ? fallbackSourceFacePx
      : block.sourceFontFaceFallbackPx,
  );
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function hasUsableSourceFaceMeasurement(block: TranslationBlock): boolean {
  return (
    block.sourceFontSizeMethod === "raster-core-v1" &&
    Number.isFinite(Number(block.sourceFontFacePx)) &&
    Number(block.sourceFontFacePx) > 0 &&
    Number.isFinite(Number(block.sourceFontSizeConfidence)) &&
    Number(block.sourceFontSizeConfidence) >= 0.5
  );
}

function hasReliableSourceGeometry(
  block: TranslationBlock,
  pageSize: { width: number; height: number },
): boolean {
  const sourceText = Array.from(String(block.sourceText ?? ""))
    .filter((grapheme) => !/^\s$/u.test(grapheme))
    .slice(0, MAX_PROBE_GRAPHEMES)
    .join("");
  if (
    !block.renderBbox ||
    !isGeneratedBubbleLayout(block.bubbleLayout) ||
    sourceText.length < MIN_CORNER_FRAGMENT_GRAPHEMES
  ) {
    return true;
  }
  const source = toPageRelativeBbox(block.bbox, block.bboxSpace, pageSize);
  const render = toPageRelativeBbox(
    block.renderBbox,
    block.renderBboxSpace,
    pageSize,
  );
  const renderArea = render.w * render.h;
  if (renderArea <= 0) return true;
  if ((source.w * source.h) / renderArea > MAX_CORNER_FRAGMENT_AREA_SHARE) {
    return true;
  }
  const offsetX =
    Math.abs(source.x + source.w / 2 - (render.x + render.w / 2)) /
    Math.max(1, render.w);
  const offsetY =
    Math.abs(source.y + source.h / 2 - (render.y + render.h / 2)) /
    Math.max(1, render.h);
  return !(
    offsetX > CENTRAL_HALF_MAX_CENTER_OFFSET &&
    offsetY > CENTRAL_HALF_MAX_CENTER_OFFSET
  );
}

function toPageRelativeBbox(
  bbox: BBox,
  space: TranslationBlock["bboxSpace"],
  pageSize: { width: number; height: number },
): BBox {
  return space === "pixels"
    ? {
        x: (bbox.x / Math.max(1, pageSize.width)) * 1_000,
        y: (bbox.y / Math.max(1, pageSize.height)) * 1_000,
        w: (bbox.w / Math.max(1, pageSize.width)) * 1_000,
        h: (bbox.h / Math.max(1, pageSize.height)) * 1_000,
      }
    : bbox;
}

function positive(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
