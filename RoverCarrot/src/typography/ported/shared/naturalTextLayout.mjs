// Ported from read-only fork fd461737. See source-map.json.
import { isUsableBubbleLayout } from "./bubbleLayout.mjs";
import { bboxToPixels, resolveBlockRenderBbox, resolveEffectiveRenderBbox, } from "./geometry.mjs";
import { evaluateNaturalHorizontalLayout } from "./naturalTextLayoutHorizontal.mjs";
import { resolveNaturalVerticalDecision, roundNaturalMetric, } from "./naturalTextLayoutMetrics.mjs";
import { segmentNaturalTextGraphemes } from "./naturalTextLayoutSegmentation.mjs";
import { stripRichTextMarkup } from "./richTextMarkup.mjs";
export function applyNaturalTextLayout(block, options) {
    const text = String(block.translatedText ?? "");
    const baseRect = resolveNaturalLayoutRect(block, options.pageSize, text, false);
    const diagnostics = buildBaseDiagnostics(text, baseRect);
    if (!options.enabled || !text.trim()) {
        return unchangedResult(block, text, options.enabled ? "unchanged" : "disabled", diagnostics);
    }
    if (stripRichTextMarkup(text) !== text) {
        return unchangedResult(block, text, "markup-preserved", diagnostics);
    }
    if (/[\r\n]/u.test(text) || hasMeaningfulWhitespaceFormatting(text)) {
        return unchangedResult(block, text, "unchanged", diagnostics);
    }
    const vertical = resolveNaturalVerticalDecision(block, text, baseRect, options);
    const withVerticalMetrics = {
        ...diagnostics,
        autoVerticalEligible: vertical.eligible,
        oneColumnMaxFontPx: vertical.oneColumnMaxFontPx,
        twoColumnMaxFontPx: vertical.twoColumnMaxFontPx,
    };
    if (vertical.eligible) {
        return verticalResult(block, text, withVerticalMetrics);
    }
    if (shouldPreserveVertical(block, options) ||
        !supportsNaturalHardBreaks(block) ||
        block.fontSizeIntent === "source-match") {
        // Source matching resolves the actual face size in the renderer, after the
        // font has loaded. Hard breaks calculated from the provisional nominal
        // size would survive both that conversion and later balloon fitting.
        return unchangedResult(block, text, "unchanged", withVerticalMetrics);
    }
    const horizontalRect = resolveNaturalLayoutRect(block, options.pageSize, text, true);
    return resolveHorizontalResult(block, text, horizontalRect, options.locale, options.fontMetricWidthScale, {
        ...withVerticalMetrics,
        widthPx: horizontalRect.w,
        heightPx: horizontalRect.h,
    });
}
function resolveHorizontalResult(block, text, rect, locale, fontMetricWidthScale, diagnostics) {
    const evaluation = evaluateNaturalHorizontalLayout(block, text, rect, locale, fontMetricWidthScale);
    const measuredDiagnostics = {
        ...diagnostics,
        baselineEstimatedFontSizePx: evaluation.baselineFontSizePx === undefined
            ? undefined
            : roundNaturalMetric(evaluation.baselineFontSizePx),
        estimatedFontSizePx: evaluation.candidateFontSizePx === undefined
            ? undefined
            : roundNaturalMetric(evaluation.candidateFontSizePx),
        shapeAware: evaluation.shapeAware,
    };
    if (!evaluation.accepted) {
        return unchangedResult(block, text, "unchanged", measuredDiagnostics);
    }
    const completeDiagnostics = {
        ...measuredDiagnostics,
        estimatedWordsPerLine: roundNaturalMetric(evaluation.accepted.estimatedWordsPerLine),
        lineCount: evaluation.accepted.lineCount,
    };
    if (evaluation.accepted.translatedText === text) {
        return unchangedResult(block, text, "unchanged", completeDiagnostics);
    }
    return {
        translatedText: evaluation.accepted.translatedText,
        renderDirection: block.renderDirection,
        strategy: evaluation.accepted.mode,
        changed: true,
        diagnostics: completeDiagnostics,
    };
}
function resolveNaturalLayoutRect(block, pageSize, text, effective) {
    const rect = bboxToPixels(effective && !isUsableBubbleLayout(block.bubbleLayout)
        ? resolveEffectiveRenderBbox(block, pageSize, text)
        : resolveBlockRenderBbox(block, pageSize), pageSize.width, pageSize.height);
    return { w: rect.w, h: rect.h };
}
function buildBaseDiagnostics(text, rect) {
    const normalized = text.replace(/\r\n?/gu, "\n");
    return {
        widthPx: rect.w,
        heightPx: rect.h,
        graphemeCount: segmentNaturalTextGraphemes(normalized).filter((value) => value !== "\n").length,
        estimatedWordsPerLine: 0,
        lineCount: countNaturalLines(normalized),
        autoVerticalEligible: false,
    };
}
function verticalResult(block, text, diagnostics) {
    return {
        translatedText: text,
        renderDirection: "vertical",
        strategy: "vertical",
        changed: block.renderDirection !== "vertical",
        diagnostics,
    };
}
function unchangedResult(block, text, strategy, diagnostics) {
    return {
        translatedText: text,
        renderDirection: block.renderDirection,
        strategy,
        changed: false,
        diagnostics,
    };
}
function shouldPreserveVertical(block, options) {
    return (options.directionPreference === "vertical" ||
        block.renderDirection === "vertical");
}
function supportsNaturalHardBreaks(block) {
    return (block.wordBreak === undefined ||
        block.wordBreak === "normal" ||
        block.wordBreak === "break-all" ||
        block.wordBreak === "break-word" ||
        block.wordBreak === "keep-all" ||
        block.wordBreak === "keep-all-overflow");
}
function countNaturalLines(value) {
    return Math.max(1, value.replace(/\r\n?/gu, "\n").split("\n").length);
}
function hasMeaningfulWhitespaceFormatting(value) {
    return value !== value.trim() || /\t|\u00a0| {2,}/u.test(value);
}
export { segmentNaturalTextGraphemes };
