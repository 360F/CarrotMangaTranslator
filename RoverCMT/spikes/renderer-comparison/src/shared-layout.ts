import { isGeneratedBubbleLayout } from "../../../../src/shared/bubbleLayout";
import {
  bboxToPixels,
  resolveEffectiveRenderBbox,
  resolveFontWidthScale,
} from "../../../../src/shared/geometry";
import { parseRichText } from "../../../../src/shared/richTextMarkup";
import { resolveBlockTextWordBreak } from "../../../../src/shared/textWrapping";
import type { TranslationBlock } from "../../../../src/shared/textTypes";
import {
  compareBalancedParagraphs,
  measureBalancedBubbleParagraph,
} from "../../../../src/renderer/src/lib/balancedBubbleTextWrapping";
import { resolveBubbleTextSlotPlans } from "../../../../src/renderer/src/lib/bubbleTextLayout";
import { measureStyledWrappedTextInSlots } from "../../../../src/renderer/src/lib/bubbleTextWrapping";
import {
  measureStyledGraphemes,
  measureStyledWrappedText,
  type BlockTextLine,
  type TextMeasurementContext,
} from "../../../../src/renderer/src/lib/overlayTextWrapping";

const MIN_FONT_SIZE_PX = 10;

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
};

/**
 * Benchmark-only bridge to Carrot's production wrapping and bubble-slot
 * algorithms. The bundle contains these modules, so candidate runtime code
 * does not import the parent project. Only the backend measureText primitive
 * differs between native candidates.
 */
export function layoutNativeBlock(
  block: TranslationBlock,
  pageSize: { width: number; height: number },
  context: TextMeasurementContext,
  fontFamily: string,
): NativeBlockLayout {
  const text = String(block.translatedText ?? "");
  const pixel = bboxToPixels(
    resolveEffectiveRenderBbox(block, pageSize, text),
    pageSize.width,
    pageSize.height,
  );
  const rect = { left: pixel.x, top: pixel.y, width: pixel.w, height: pixel.h };
  if (!text.trim()) {
    return {
      blockId: block.id,
      rect,
      fontSizePx: Math.max(MIN_FONT_SIZE_PX, block.fontSizePx),
      lines: [],
      overflow: false,
      usedBubbleSlots: false,
    };
  }

  const automaticSourceFit =
    block.fontSizeIntent === "source-match" &&
    block.renderDirection === "horizontal" &&
    !/[\r\n]/u.test(text);
  const shouldFit = automaticSourceFit || (block.autoFitText ?? true);
  const maximum = Math.max(MIN_FONT_SIZE_PX, Math.floor(block.fontSizePx));
  const sizes = shouldFit
    ? Array.from(
        { length: maximum - MIN_FONT_SIZE_PX + 1 },
        (_, index) => maximum - index,
      )
    : [maximum];
  let selected: ReturnType<typeof measureAtSize> | null = null;
  for (const size of sizes) {
    const measured = measureAtSize(
      block,
      text,
      size,
      rect,
      context,
      fontFamily,
      automaticSourceFit,
    );
    selected = measured;
    if (measured.fits) break;
  }
  if (!selected) throw new Error(`Unable to layout block ${block.id}`);
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
  return {
    blockId: block.id,
    rect,
    fontSizePx: selected.fontSizePx,
    lines,
    overflow: !selected.fits,
    usedBubbleSlots: selected.usedBubbleSlots,
  };
}

function measureAtSize(
  block: TranslationBlock,
  text: string,
  fontSizePx: number,
  rect: { width: number; height: number },
  context: TextMeasurementContext,
  fontFamily: string,
  balanceParagraph: boolean,
): {
  fontSizePx: number;
  lines: BlockTextLine[];
  fits: boolean;
  usedBubbleSlots: boolean;
} {
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
    maximumSlotCount: Math.max(1, Array.from(plainText).length),
    preferBodyCenter: balanceParagraph,
    renderDirection: "horizontal",
  });
  if (plans.length > 0) {
    if (balanceParagraph && isGeneratedBubbleLayout(block.bubbleLayout)) {
      const graphemes = measureStyledGraphemes(
        context,
        runs,
        fontSizePx,
        fontFamily,
      );
      let best: ReturnType<typeof measureBalancedBubbleParagraph> = null;
      for (const slots of plans) {
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
        )
          best = measured;
      }
      if (best) {
        return {
          fontSizePx,
          lines: best.lines,
          fits: true,
          usedBubbleSlots: true,
        };
      }
    } else {
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
        if (measured.fits && measured.consumedAll) {
          return {
            fontSizePx,
            lines: measured.lines,
            fits: true,
            usedBubbleSlots: true,
          };
        }
      }
    }
  }

  const measured = measureStyledWrappedText(
    context,
    runs,
    rect.width / fontWidthScale,
    lineHeightPx,
    fontSizePx,
    fontFamily,
    letterSpacingPx,
    wordBreak,
    undefined,
    balanceParagraph,
  );
  return {
    fontSizePx,
    lines: measured.lines,
    fits:
      measured.totalHeight <= rect.height &&
      measured.maxLineWidth <= rect.width / fontWidthScale,
    usedBubbleSlots: false,
  };
}
