// Ported from read-only fork fd461737. See source-map.json.
import { pixelsToBbox } from "../../shared/geometry.mjs";
import { partitionSameBlockBubbleRegions } from "./bubbleSameBlockRegionPartition.mjs";
import { padBubbleShapeProfile } from "./bubbleShapeProfilePadding.mjs";
const DOMINANT_TEXT_REGION_MIN_COVERAGE = 0.7;
const SECONDARY_TEXT_REGION_MAX_COVERAGE = 0.15;
export function buildBubbleShapeProfile(input) {
    if (input.regions.length === 0)
        return null;
    let ordered = partitionSameBlockBubbleRegions(orderBubbleRegions(input.regions, input.sourceDirection), input.regionGapPx);
    if (ordered.length === 0)
        return null;
    let profile = buildProfileData(ordered, input.renderDirection);
    if (!profile)
        return null;
    const dominantRegionIndex = selectDominantTextRegionIndex(profile.regions.map((item) => item.profile), profile.pixelBounds, input.textBounds, input.renderDirection);
    if (dominantRegionIndex !== null) {
        ordered = [profile.regions[dominantRegionIndex].source];
        profile = buildProfileData(ordered, input.renderDirection);
        if (!profile)
            return null;
    }
    const rawBubbleLayout = {
        version: 1,
        direction: input.renderDirection,
        confidence: clamp(input.confidence, 0, 1),
        origin: "detected",
        modelId: input.modelId,
        sourceImageRevision: input.sourceImageRevision,
        insetRatio: 0,
        regions: profile.regions.map((item) => item.profile),
    };
    const padded = padBubbleShapeProfile(rawBubbleLayout, input.paddingRatio);
    if (!padded)
        return null;
    const paddedPixelBounds = cropBoundsToLogicalEnvelope(profile.pixelBounds, padded.envelope, input.renderDirection);
    return {
        renderBbox: pixelsToBbox(paddedPixelBounds, input.pageWidth, input.pageHeight),
        renderBboxSpace: "normalized_1000",
        bubbleLayout: {
            ...padded.bubbleLayout,
            insetRatio: clamp(input.insetPx /
                Math.max(1, Math.min(paddedPixelBounds.w, paddedPixelBounds.h)), 0, 0.49),
        },
    };
}
function cropBoundsToLogicalEnvelope(bounds, envelope, direction) {
    const blockExtent = envelope.blockEnd - envelope.blockStart;
    const inlineExtent = envelope.inlineEnd - envelope.inlineStart;
    if (direction === "horizontal") {
        return {
            x: bounds.x + envelope.inlineStart * bounds.w,
            y: bounds.y + envelope.blockStart * bounds.h,
            w: inlineExtent * bounds.w,
            h: blockExtent * bounds.h,
        };
    }
    return {
        x: bounds.x + envelope.blockStart * bounds.w,
        y: bounds.y + envelope.inlineStart * bounds.h,
        w: blockExtent * bounds.w,
        h: inlineExtent * bounds.h,
    };
}
function buildProfileData(regions, renderDirection) {
    const pixelBounds = unionBounds(regions.map((region) => region.bounds));
    if (pixelBounds.w < 2 || pixelBounds.h < 2)
        return null;
    const profiledRegions = regions
        .map((source) => ({
        source,
        profile: buildRegionProfile(source, pixelBounds, renderDirection),
    }))
        .filter((item) => item.profile.spans.length > 0);
    return profiledRegions.length > 0
        ? { pixelBounds, regions: profiledRegions }
        : null;
}
function selectDominantTextRegionIndex(regions, renderBounds, textBounds, direction) {
    if (!textBounds ||
        textBounds.w <= 0 ||
        textBounds.h <= 0 ||
        regions.length <= 1) {
        return null;
    }
    const coverages = regions.map((region) => resolveTextCoverage(region, renderBounds, textBounds, direction));
    const primaryIndex = coverages.reduce((best, coverage, index) => (coverage > coverages[best] ? index : best), 0);
    return coverages[primaryIndex] >= DOMINANT_TEXT_REGION_MIN_COVERAGE &&
        coverages.every((coverage, index) => index === primaryIndex ||
            coverage <= SECONDARY_TEXT_REGION_MAX_COVERAGE)
        ? primaryIndex
        : null;
}
function resolveTextCoverage(region, renderBounds, textBounds, direction) {
    const coveredArea = region.spans.reduce((total, span) => total +
        intersectionArea(spanToPixels(span, renderBounds, direction), textBounds), 0);
    return clamp(coveredArea / Math.max(1, textBounds.w * textBounds.h), 0, 1);
}
function spanToPixels(span, renderBounds, direction) {
    if (direction === "horizontal") {
        return {
            x: renderBounds.x + span.inlineStart * renderBounds.w,
            y: renderBounds.y + span.blockStart * renderBounds.h,
            w: (span.inlineEnd - span.inlineStart) * renderBounds.w,
            h: (span.blockEnd - span.blockStart) * renderBounds.h,
        };
    }
    return {
        x: renderBounds.x + span.blockStart * renderBounds.w,
        y: renderBounds.y + span.inlineStart * renderBounds.h,
        w: (span.blockEnd - span.blockStart) * renderBounds.w,
        h: (span.inlineEnd - span.inlineStart) * renderBounds.h,
    };
}
function intersectionArea(left, right) {
    const x1 = Math.max(left.x, right.x);
    const y1 = Math.max(left.y, right.y);
    const x2 = Math.min(left.x + left.w, right.x + right.w);
    const y2 = Math.min(left.y + left.h, right.y + right.h);
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}
function orderBubbleRegions(regions, sourceDirection) {
    const rows = [];
    const topOrdered = [...regions].sort((left, right) => left.bounds.y - right.bounds.y);
    for (const region of topOrdered) {
        const row = rows.find((candidate) => belongsToRow(region.bounds, candidate.map((item) => item.bounds)));
        if (row)
            row.push(region);
        else
            rows.push([region]);
    }
    return rows.flatMap((row) => row.sort((left, right) => sourceDirection === "vertical"
        ? right.bounds.x - left.bounds.x
        : left.bounds.x - right.bounds.x));
}
function belongsToRow(bounds, row) {
    const rowTop = Math.min(...row.map((item) => item.y));
    const rowBottom = Math.max(...row.map((item) => item.y + item.h));
    const overlap = Math.max(0, Math.min(bounds.y + bounds.h, rowBottom) - Math.max(bounds.y, rowTop));
    return overlap / Math.max(1, Math.min(bounds.h, rowBottom - rowTop)) >= 0.3;
}
function buildRegionProfile(region, renderBounds, direction) {
    const blockLength = direction === "horizontal" ? region.height : region.width;
    const bandSize = Math.max(1, Math.ceil(blockLength / 96));
    const spans = [];
    for (let start = 0; start < blockLength; start += bandSize) {
        const end = Math.min(blockLength, start + bandSize);
        const interval = intersectBandInterval(region, direction, start, end);
        if (!interval)
            continue;
        spans.push(normalizeSpan(region, renderBounds, direction, start, end, interval));
    }
    return { spans };
}
function intersectBandInterval(region, direction, start, end) {
    let intervals = [
        {
            start: 0,
            end: direction === "horizontal" ? region.width : region.height,
        },
    ];
    for (let block = start; block < end; block += 1) {
        intervals = intersectMaskIntervals(intervals, scanMaskLine(region, direction, block));
        if (intervals.length === 0)
            return null;
    }
    return intervals.reduce((best, interval) => !best || interval.end - interval.start > best.end - best.start
        ? interval
        : best, null);
}
function intersectMaskIntervals(left, right) {
    const output = [];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
        const a = left[leftIndex];
        const b = right[rightIndex];
        const start = Math.max(a.start, b.start);
        const end = Math.min(a.end, b.end);
        if (end > start)
            output.push({ start, end });
        if (a.end <= b.end)
            leftIndex += 1;
        else
            rightIndex += 1;
    }
    return output;
}
function scanMaskLine(region, direction, block) {
    const inlineLength = direction === "horizontal" ? region.width : region.height;
    const intervals = [];
    let start = -1;
    for (let inline = 0; inline < inlineLength; inline += 1) {
        const index = direction === "horizontal"
            ? block * region.width + inline
            : inline * region.width + block;
        if (region.mask[index]) {
            if (start < 0)
                start = inline;
        }
        else if (start >= 0) {
            intervals.push({ start, end: inline });
            start = -1;
        }
    }
    if (start >= 0)
        intervals.push({ start, end: inlineLength });
    return intervals;
}
function normalizeSpan(region, renderBounds, direction, blockStart, blockEnd, inline) {
    if (direction === "horizontal") {
        return {
            blockStart: ratio(region.bounds.y + blockStart - renderBounds.y, renderBounds.h),
            blockEnd: ratio(region.bounds.y + blockEnd - renderBounds.y, renderBounds.h),
            inlineStart: ratio(region.bounds.x + inline.start - renderBounds.x, renderBounds.w),
            inlineEnd: ratio(region.bounds.x + inline.end - renderBounds.x, renderBounds.w),
        };
    }
    return {
        blockStart: ratio(region.bounds.x + blockStart - renderBounds.x, renderBounds.w),
        blockEnd: ratio(region.bounds.x + blockEnd - renderBounds.x, renderBounds.w),
        inlineStart: ratio(region.bounds.y + inline.start - renderBounds.y, renderBounds.h),
        inlineEnd: ratio(region.bounds.y + inline.end - renderBounds.y, renderBounds.h),
    };
}
function unionBounds(boxes) {
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.w));
    const bottom = Math.max(...boxes.map((box) => box.y + box.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
}
function ratio(value, total) {
    return clamp(value / Math.max(1, total), 0, 1);
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
