// Ported from src/shared/geometry.ts, reference fd461737. Runtime independent of Carrot.
export { clamp, clampBbox, pixelsToBbox, normalizeBboxTo1000 } from './bboxNormalization.mjs';
export function bboxOverlapRatio(a, b) {
    if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) {
        return 0;
    }
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
    const minArea = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
    return overlap / minArea;
}
export function bboxToPixels(bbox, width, height) {
    return {
        x: (bbox.x / 1000) * width,
        y: (bbox.y / 1000) * height,
        w: (bbox.w / 1000) * width,
        h: (bbox.h / 1000) * height,
    };
}
