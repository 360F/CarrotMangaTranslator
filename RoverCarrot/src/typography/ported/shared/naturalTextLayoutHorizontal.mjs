// Ported from read-only fork fd461737. See source-map.json.
import { resizeNaturalTextMetrics, resolveNaturalTextMetrics, resolveNaturalWrapMode, } from "./naturalTextLayoutMetrics.mjs";
import { countSemanticNaturalGraphemes, hasKoreanWordPriority, isKoreanNaturalText, segmentNaturalTextGraphemes, } from "./naturalTextLayoutSegmentation.mjs";
import { selectNaturalBreakCandidate } from "./naturalTextLayoutCandidateSelection.mjs";
import { resolveNaturalShapeSlotPlans, } from "./naturalTextLayoutShape.mjs";
import { wrapNaturalTextToShapeSlots, } from "./naturalTextLayoutVariableWrapping.mjs";
const HORIZONTAL_SAFETY_RATIO = 0.94;
const HORIZONTAL_HEIGHT_SAFETY_RATIO = 0.96;
const MIN_GRAPHEMES_PER_HARD_LINE = 2;
const MIN_HARD_BREAK_FONT_SIZE_PX = 12;
const MIN_SEMANTIC_FONT_RATIO = 0.8;
const MIN_IDEAL_BREAK_FONT_RATIO = 0.82;
const MAX_AUTOFIT_FONT_SIZE_PX = 256;
const MAX_NATURAL_HARD_LINES = 12;
export function evaluateNaturalHorizontalLayout(block, text, rect, locale, fontMetricWidthScale) {
    const baseMetrics = resolveNaturalTextMetrics(block, fontMetricWidthScale);
    const baseline = resolveBestHorizontalCandidate(block, text, rect, baseMetrics, locale, 1);
    const candidate = baseline
        ? resolvePreferredHorizontalCandidate(block, text, rect, baseMetrics, locale, baseline)
        : null;
    const evaluation = {
        baselineFontSizePx: baseline?.fontSizePx,
        candidateFontSizePx: candidate?.fontSizePx,
        shapeAware: candidate?.shapeAware ?? baseline?.shapeAware ?? false,
    };
    if (!candidate ||
        !baseline ||
        !isReadableHardBreakCandidate(candidate, baseline)) {
        return evaluation;
    }
    return {
        ...evaluation,
        accepted: {
            estimatedWordsPerLine: candidate.estimatedWordsPerLine,
            lineCount: candidate.wrapped.text.split("\n").length,
            mode: candidate.mode,
            translatedText: candidate.wrapped.text,
        },
    };
}
function resolvePreferredHorizontalCandidate(block, text, rect, baseMetrics, locale, baseline) {
    const koreanWordPriority = hasKoreanWordPriority(text);
    return selectNaturalBreakCandidate({
        autoFitText: block.autoFitText ?? true,
        baselineFontSizePx: baseline.fontSizePx,
        minimumReadableFontSizePx: MIN_HARD_BREAK_FONT_SIZE_PX,
        minimumSemanticFontRatio: MIN_SEMANTIC_FONT_RATIO,
        minimumIdealFontRatio: MIN_IDEAL_BREAK_FONT_RATIO,
        semanticWordPriority: koreanWordPriority,
        resolveAtFont: (fontSizePx, allowSinglePreferredUnit) => resolveHorizontalCandidateAtFont(block, text, rect, baseMetrics, fontSizePx, locale, MIN_GRAPHEMES_PER_HARD_LINE, allowSinglePreferredUnit),
    });
}
function resolveBestHorizontalCandidate(block, text, rect, baseMetrics, locale, minimumLineGraphemes) {
    if (!(block.autoFitText ?? true)) {
        return resolveHorizontalCandidateAtFont(block, text, rect, baseMetrics, baseMetrics.fontSizePx, locale, minimumLineGraphemes);
    }
    let low = 1;
    let high = resolveMaximumFontSize(block, rect);
    let best = null;
    while (low <= high) {
        const fontSizePx = Math.floor((low + high) / 2);
        const candidate = resolveHorizontalCandidateAtFont(block, text, rect, baseMetrics, fontSizePx, locale, minimumLineGraphemes);
        if (candidate) {
            best = candidate;
            low = fontSizePx + 1;
        }
        else {
            high = fontSizePx - 1;
        }
    }
    return best;
}
function resolveMaximumFontSize(block, rect) {
    return Math.max(1, Math.min(MAX_AUTOFIT_FONT_SIZE_PX, Math.floor((Math.max(1, rect.h) * HORIZONTAL_HEIGHT_SAFETY_RATIO) /
        Math.max(1, block.lineHeight || 1.18))));
}
function resolveHorizontalCandidateAtFont(block, text, rect, baseMetrics, fontSizePx, locale, minimumLineGraphemes, allowSinglePreferredUnit = false) {
    const metrics = resizeNaturalTextMetrics(baseMetrics, fontSizePx);
    const maximumSlotCount = resolveMaximumHardLineCount(text, minimumLineGraphemes, allowSinglePreferredUnit);
    const shapePlans = resolveNaturalShapeSlotPlans(block.bubbleLayout, {
        blockExtentPx: Math.max(1, rect.h) * HORIZONTAL_HEIGHT_SAFETY_RATIO,
        inlineExtentPx: Math.max(1, rect.w),
        fontSizePx,
        fontWidthScale: Math.max(0.01, metrics.fontWidthScale),
        lineHeight: Math.max(1, block.lineHeight || 1.18),
        maximumSlotCount,
    });
    const shapeAware = shapePlans.length > 0;
    const plans = shapeAware
        ? shapePlans.map((plan) => plan.slots)
        : resolveRectangularSlotPlans(rect, metrics, block.lineHeight, maximumSlotCount);
    return selectBestCandidateForPlans(plans, shapeAware, text, metrics, fontSizePx, locale, minimumLineGraphemes, allowSinglePreferredUnit);
}
function selectBestCandidateForPlans(plans, shapeAware, text, metrics, fontSizePx, locale, minimumLineGraphemes, allowSinglePreferredUnit) {
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const koreanBreakPriority = isKoreanNaturalText(text);
    for (const slots of plans) {
        const modeDecision = resolveNaturalWrapMode(text, resolveRepresentativeSlotWidth(slots), metrics, locale);
        const wrapped = wrapNaturalTextToShapeSlots(text, slots, metrics, modeDecision.mode, locale, { minimumLineGraphemes, allowSinglePreferredUnit });
        if (!wrapped)
            continue;
        const coveredRegions = new Set(slots.map((slot) => slot.regionIndex)).size;
        const score = (koreanBreakPriority ? wrapped.emergencyBreakCount * 10_000 : 0) +
            (koreanBreakPriority ? wrapped.discouragedBreakCount * 5_000 : 0) +
            wrapped.cost +
            slots.length * 0.5 -
            (shapeAware ? coveredRegions * 18 : 0);
        if (score >= bestScore)
            continue;
        bestScore = score;
        best = {
            estimatedWordsPerLine: modeDecision.estimatedWordsPerLine,
            fontSizePx,
            mode: modeDecision.mode,
            shapeAware,
            slots,
            wrapped,
        };
    }
    return best;
}
function resolveRectangularSlotPlans(rect, metrics, lineHeight, maximumSlotCount) {
    const lineHeightPx = metrics.fontSizePx * Math.max(1, lineHeight || 1.18);
    const maximumLineCount = Math.min(maximumSlotCount, Math.floor((Math.max(1, rect.h) * HORIZONTAL_HEIGHT_SAFETY_RATIO) /
        Math.max(1, lineHeightPx)));
    const availableWidthPx = (Math.max(1, rect.w) * HORIZONTAL_SAFETY_RATIO) /
        Math.max(0.01, metrics.fontWidthScale);
    return Array.from({ length: maximumLineCount }, (_, index) => Array.from({ length: index + 1 }, () => ({
        availableWidthPx,
        regionIndex: 0,
    })));
}
function resolveMaximumHardLineCount(text, minimumLineGraphemes, allowSinglePreferredUnit) {
    const graphemes = segmentNaturalTextGraphemes(text);
    const visibleCount = countSemanticNaturalGraphemes(graphemes, 0, graphemes.length);
    return Math.max(1, Math.min(MAX_NATURAL_HARD_LINES, Math.floor(visibleCount /
        Math.max(1, allowSinglePreferredUnit ? 1 : minimumLineGraphemes))));
}
function resolveRepresentativeSlotWidth(slots) {
    const widths = slots
        .map((slot) => slot.availableWidthPx)
        .sort((left, right) => left - right);
    return widths.at(Math.floor(Math.max(0, widths.length - 1) * 0.75)) ?? 1;
}
function isReadableHardBreakCandidate(candidate, baseline) {
    const lines = candidate.wrapped.text.split("\n");
    return (lines.length >= 2 &&
        lines.length <= MAX_NATURAL_HARD_LINES &&
        candidate.fontSizePx >= MIN_HARD_BREAK_FONT_SIZE_PX &&
        candidate.fontSizePx >= baseline.fontSizePx * MIN_SEMANTIC_FONT_RATIO &&
        candidate.slots.every((slot, index) => {
            const width = candidate.wrapped.lineWidthsPx[index];
            return Number.isFinite(width) && width <= slot.availableWidthPx + 1e-6;
        }));
}
