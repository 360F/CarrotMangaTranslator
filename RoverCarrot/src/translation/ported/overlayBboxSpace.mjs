// Ported from src/main/pipeline/overlayBboxSpace.ts, reference fd461737. Runtime independent of Carrot.
export function inferDetectedBboxSpace(items, page) {
    const coordinatePixelEvidence = items.filter((item) => hasPixelCoordinateEvidence(item.bbox, page)).length;
    if (items.length === 1 && coordinatePixelEvidence === 1) {
        return "pixels";
    }
    if (coordinatePixelEvidence >= Math.max(2, Math.ceil(items.length * 0.2))) {
        return "pixels";
    }
    const overflowPixelEvidence = items.filter((item) => hasPixelOverflowEvidence(item.bbox, page)).length;
    return overflowPixelEvidence >= Math.max(2, Math.ceil(items.length * 0.2))
        ? "pixels"
        : "normalized_1000";
}
export function hasPixelCoordinateEvidence(bbox, page) {
    return (fitsPagePixels(bbox, page) &&
        (bbox.x > 1000 || bbox.y > 1000 || bbox.w > 1000 || bbox.h > 1000));
}
function hasPixelOverflowEvidence(bbox, page) {
    const right = bbox.x + bbox.w;
    const bottom = bbox.y + bbox.h;
    const normalizedTolerance = 80;
    return (fitsPagePixels(bbox, page) &&
        (right > 1000 + normalizedTolerance || bottom > 1000 + normalizedTolerance));
}
function fitsPagePixels(bbox, page) {
    const right = bbox.x + bbox.w;
    const bottom = bbox.y + bbox.h;
    const pixelBoundsTolerance = 1.06;
    return (bbox.x >= 0 &&
        bbox.y >= 0 &&
        bbox.w > 0 &&
        bbox.h > 0 &&
        right <= page.width * pixelBoundsTolerance &&
        bottom <= page.height * pixelBoundsTolerance);
}
