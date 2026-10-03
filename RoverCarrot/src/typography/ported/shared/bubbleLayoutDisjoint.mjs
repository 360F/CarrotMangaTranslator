// Ported from read-only fork fd461737. See source-map.json.
import { isGeneratedBubbleLayout, isUsableBubbleLayout, } from "./bubbleLayout.mjs";
import { cloneBubbleRegion, collectBlockBoundaries, ratioIntervalDistance, resolveBubbleRegionBounds, resolveIntervalAt, } from "./bubbleLayoutDisjointGeometry.mjs";
import { separateBubbleRegionPair, } from "./bubbleLayoutDisjointPair.mjs";
const DEFAULT_GUTTER_PX = 4;
const resolvedLayoutCache = new WeakMap();
/**
 * Repairs legacy/generated multi-region profiles at consumption time.
 *
 * Detector revisions written before same-block ownership partitioning can
 * contain two balloon regions which overlap one another. They are separated
 * only when their actual shapes overlap or are closer than the requested
 * gutter. User-authored geometry, single regions, and already separated
 * profiles are returned untouched.
 */
export function resolveDisjointBubbleLayout(value, input) {
    if (!isUsableBubbleLayout(value))
        return null;
    if (!isGeneratedBubbleLayout(value) ||
        value.regions.length < 2 ||
        !isPositiveFinite(input.blockExtentPx) ||
        !isPositiveFinite(input.inlineExtentPx)) {
        return value;
    }
    const gutterPx = resolveGutterPx(input.gutterPx);
    const cacheKey = [
        input.blockExtentPx.toFixed(3),
        input.inlineExtentPx.toFixed(3),
        gutterPx.toFixed(3),
    ].join(":");
    const cached = resolvedLayoutCache.get(value);
    if (cached?.key === cacheKey)
        return cached.value;
    const regions = separateOverlappingRegions(value.regions, {
        blockExtentPx: input.blockExtentPx,
        inlineExtentPx: input.inlineExtentPx,
        gutterBlockRatio: gutterPx / input.blockExtentPx,
        gutterInlineRatio: gutterPx / input.inlineExtentPx,
    });
    const resolved = regions ? { ...value, regions } : value;
    resolvedLayoutCache.set(value, { key: cacheKey, value: resolved });
    return resolved;
}
function separateOverlappingRegions(source, geometry) {
    const regions = source.map(cloneBubbleRegion);
    let changed = false;
    for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
            const left = regions[leftIndex];
            const right = regions[rightIndex];
            if (!left ||
                !right ||
                !regionsNeedSeparation(left, right, geometry.gutterBlockRatio, geometry.gutterInlineRatio)) {
                continue;
            }
            const separated = separateBubbleRegionPair(left, right, geometry);
            if (!separated) {
                // An impossibly thin/degenerate later region must never restore the
                // original overlap. Preserve the earlier reading-order owner.
                regions.splice(rightIndex, 1);
                rightIndex -= 1;
                changed = true;
                continue;
            }
            regions[leftIndex] = separated[0];
            regions[rightIndex] = separated[1];
            changed = true;
        }
    }
    return changed ? regions : null;
}
function regionsNeedSeparation(first, second, blockGutter, inlineGutter) {
    const boundaries = collectBlockBoundaries(first, second);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
        const start = boundaries[index];
        const end = boundaries[index + 1];
        if (start === undefined || end === undefined || end <= start)
            continue;
        const coordinate = (start + end) / 2;
        const firstInterval = resolveIntervalAt(first, coordinate);
        const secondInterval = resolveIntervalAt(second, coordinate);
        if (firstInterval &&
            secondInterval &&
            ratioIntervalDistance(firstInterval, secondInterval) < inlineGutter) {
            return true;
        }
    }
    const firstBounds = resolveBubbleRegionBounds(first);
    const secondBounds = resolveBubbleRegionBounds(second);
    return (ratioIntervalDistance({ start: firstBounds.blockStart, end: firstBounds.blockEnd }, { start: secondBounds.blockStart, end: secondBounds.blockEnd }) < blockGutter &&
        ratioIntervalDistance({ start: firstBounds.inlineStart, end: firstBounds.inlineEnd }, { start: secondBounds.inlineStart, end: secondBounds.inlineEnd }) < inlineGutter);
}
function resolveGutterPx(value) {
    return Number.isFinite(value)
        ? Math.min(6, Math.max(3, value))
        : DEFAULT_GUTTER_PX;
}
function isPositiveFinite(value) {
    return Number.isFinite(value) && value > 0;
}
