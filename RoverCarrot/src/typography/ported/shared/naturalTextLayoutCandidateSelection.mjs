// Ported from read-only fork fd461737. See source-map.json.
/**
 * Keeps the maximum-font result unless a bounded, still-readable reduction
 * removes a Korean phrase or eojeol split. The integer scan is deliberate:
 * shape-derived line plans can appear or disappear at adjacent font sizes.
 */
export function selectNaturalBreakCandidate(options) {
    const baselineCandidate = options.resolveAtFont(options.baselineFontSizePx, options.semanticWordPriority);
    if (!options.semanticWordPriority)
        return baselineCandidate;
    if (baselineCandidate && hasIdealNaturalBreaks(baselineCandidate)) {
        return baselineCandidate;
    }
    if (!options.autoFitText) {
        return baselineCandidate && hasCleanNaturalBreaks(baselineCandidate)
            ? baselineCandidate
            : null;
    }
    return findSmallerNaturalBreakCandidate(options, baselineCandidate);
}
function findSmallerNaturalBreakCandidate(options, baselineCandidate) {
    const minimumFontSizePx = Math.max(options.minimumReadableFontSizePx, Math.ceil(options.baselineFontSizePx * options.minimumSemanticFontRatio));
    const minimumIdealFontSizePx = Math.max(minimumFontSizePx, Math.ceil(options.baselineFontSizePx * options.minimumIdealFontRatio));
    let bestCleanCandidate = baselineCandidate && hasCleanNaturalBreaks(baselineCandidate)
        ? baselineCandidate
        : null;
    for (let fontSizePx = options.baselineFontSizePx - 1; fontSizePx >= minimumFontSizePx; fontSizePx -= 1) {
        const candidate = options.resolveAtFont(fontSizePx, true);
        if (!candidate || !hasCleanNaturalBreaks(candidate))
            continue;
        bestCleanCandidate ??= candidate;
        if (fontSizePx >= minimumIdealFontSizePx &&
            hasIdealNaturalBreaks(candidate)) {
            return candidate;
        }
    }
    return bestCleanCandidate;
}
function hasCleanNaturalBreaks(candidate) {
    return (candidate.wrapped.emergencyBreakCount === 0 &&
        candidate.wrapped.discouragedBreakCount === 0);
}
function hasIdealNaturalBreaks(candidate) {
    return (hasCleanNaturalBreaks(candidate) &&
        candidate.wrapped.secondaryBreakCount === 0);
}
