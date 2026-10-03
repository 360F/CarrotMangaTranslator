// Ported from read-only fork fd461737. See source-map.json.
export const MAX_BUBBLE_LAYOUT_REGIONS = 4;
export const MAX_BUBBLE_REGION_SPANS = 256;
export const MAX_BUBBLE_LAYOUT_METADATA_LENGTH = 200;
export const MAX_BUBBLE_LAYOUT_INSET_RATIO = 0.49;
const BUBBLE_LAYOUT_KEYS = new Set([
    "version",
    "direction",
    "confidence",
    "origin",
    "modelId",
    "sourceImageRevision",
    "insetRatio",
    "regions",
]);
const BUBBLE_REGION_KEYS = new Set(["spans"]);
const BUBBLE_SPAN_KEYS = new Set([
    "blockStart",
    "blockEnd",
    "inlineStart",
    "inlineEnd",
]);
/**
 * Lightweight runtime guard for renderer/main fallbacks that should not need
 * to import the Zod IPC schema. This checks structure, bounds, ordering, and
 * strict object keys; confidence thresholds remain a caller policy.
 */
export function isUsableBubbleLayout(value) {
    if (!isExactRecord(value, BUBBLE_LAYOUT_KEYS))
        return false;
    return hasUsableBubbleMetadata(value) && hasUsableBubbleRegions(value);
}
/** True only for explicitly user-authored geometry. */
export function isManualBubbleLayout(value) {
    return value?.origin === "manual";
}
/**
 * Generated layouts created before `origin` existed are recognized by the
 * reserved production model prefix so stale clearing remains compatible.
 */
export function isGeneratedBubbleLayout(value) {
    if (!value || value.origin === "manual")
        return false;
    if (value.origin === "detected")
        return true;
    const modelId = value.modelId ?? "";
    return (modelId.startsWith("koharu-layout-rfdetr-") ||
        // Legacy ids are recognized only so stale stored geometry can be cleared.
        // No legacy detector is imported or invoked.
        modelId.startsWith("comic-rtdetr-"));
}
function hasUsableBubbleMetadata(value) {
    return (hasUsableBubbleCoreMetadata(value) &&
        hasUsableBubbleTextMetadata(value) &&
        hasUsableBubbleProvenance(value));
}
function hasUsableBubbleCoreMetadata(value) {
    const validDirection = value.direction === "horizontal" || value.direction === "vertical";
    const validOrigin = value.origin === undefined ||
        value.origin === "detected" ||
        value.origin === "manual";
    const validInset = isFiniteNumber(value.insetRatio) &&
        value.insetRatio >= 0 &&
        value.insetRatio <= MAX_BUBBLE_LAYOUT_INSET_RATIO;
    return (value.version === 1 &&
        validDirection &&
        validOrigin &&
        isRatio(value.confidence) &&
        validInset);
}
function hasUsableBubbleTextMetadata(value) {
    return (isOptionalBoundedText(value.modelId) &&
        isOptionalBoundedText(value.sourceImageRevision));
}
function hasUsableBubbleProvenance(value) {
    if (value.origin === "detected") {
        return (isBoundedText(value.modelId) && isBoundedText(value.sourceImageRevision));
    }
    if (value.origin === "manual") {
        return value.sourceImageRevision === undefined;
    }
    return true;
}
function hasUsableBubbleRegions(value) {
    return (Array.isArray(value.regions) &&
        value.regions.length >= 1 &&
        value.regions.length <= MAX_BUBBLE_LAYOUT_REGIONS &&
        value.regions.every(isUsableBubbleRegion));
}
function isUsableBubbleRegion(value) {
    if (!isExactRecord(value, BUBBLE_REGION_KEYS))
        return false;
    if (!Array.isArray(value.spans) ||
        value.spans.length < 1 ||
        value.spans.length > MAX_BUBBLE_REGION_SPANS) {
        return false;
    }
    let previousBlockEnd = 0;
    for (const [index, span] of value.spans.entries()) {
        if (!isUsableBubbleSpan(span))
            return false;
        if (index > 0 && span.blockStart < previousBlockEnd)
            return false;
        previousBlockEnd = span.blockEnd;
    }
    return true;
}
function isUsableBubbleSpan(value) {
    if (!isExactRecord(value, BUBBLE_SPAN_KEYS))
        return false;
    return (isRatio(value.blockStart) &&
        isRatio(value.blockEnd) &&
        isRatio(value.inlineStart) &&
        isRatio(value.inlineEnd) &&
        value.blockStart < value.blockEnd &&
        value.inlineStart < value.inlineEnd);
}
function isOptionalBoundedText(value) {
    return value === undefined || isBoundedText(value);
}
function isBoundedText(value) {
    return (typeof value === "string" &&
        value.length >= 1 &&
        value.length <= MAX_BUBBLE_LAYOUT_METADATA_LENGTH);
}
function isRatio(value) {
    return isFiniteNumber(value) && value >= 0 && value <= 1;
}
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function isExactRecord(value, allowedKeys) {
    return (value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).every((key) => allowedKeys.has(key)));
}
