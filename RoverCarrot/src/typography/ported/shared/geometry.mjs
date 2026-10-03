// Ported from read-only fork fd461737. See source-map.json.
import { clamp, normalizeBboxTo1000, pixelsToBbox } from "./bboxNormalization.mjs";
export { clamp, clampBbox, pixelsToBbox, normalizeBboxTo1000 } from "./bboxNormalization.mjs";
export { resolveFontWidthScale } from "./blockGeometryValues.mjs";
import { clampRenderBbox } from "./renderBbox.mjs";
import { estimateReadableTextBoxSizePx } from "./readableTextBox.mjs";
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
function pixelsToRenderBbox(bbox, width, height) {
    return clampRenderBbox({
        x: (bbox.x / Math.max(1, width)) * 1000,
        y: (bbox.y / Math.max(1, height)) * 1000,
        w: (bbox.w / Math.max(1, width)) * 1000,
        h: (bbox.h / Math.max(1, height)) * 1000,
    });
}
export function normalizeRenderBboxTo1000(bbox, pageSize, bboxSpace) {
    if (bboxSpace === "pixels" && pageSize) {
        return pixelsToRenderBbox(bbox, pageSize.width, pageSize.height);
    }
    return clampRenderBbox(bbox);
}
export function resolveBlockRenderBbox(block, pageSize) {
    if (block.renderBbox) {
        return normalizeRenderBboxTo1000(block.renderBbox, pageSize, block.renderBboxSpace);
    }
    return normalizeBboxTo1000(block.bbox, pageSize, block.bboxSpace);
}
export function resolveEffectiveRenderBbox(block, pageSize, text) {
    const base = resolveBlockRenderBbox(block, pageSize);
    if (block.renderBbox || !text.trim()) {
        return base;
    }
    const basePx = bboxToPixels(base, pageSize.width, pageSize.height);
    const requiredSize = estimateReadableTextBoxSizePx(text, block, basePx);
    const nextWidth = Math.max(basePx.w, requiredSize.width);
    const nextHeight = Math.max(basePx.h, requiredSize.height);
    if (nextWidth <= basePx.w && nextHeight <= basePx.h) {
        return base;
    }
    return expandBboxAroundCenter(base, pageSize, nextWidth, nextHeight);
}
function expandBboxAroundCenter(bbox, pageSize, targetWidthPx, targetHeightPx) {
    const px = bboxToPixels(bbox, pageSize.width, pageSize.height);
    const width = Math.min(pageSize.width, Math.max(px.w, targetWidthPx));
    const height = Math.min(pageSize.height, Math.max(px.h, targetHeightPx));
    const centerX = px.x + px.w / 2;
    const centerY = px.y + px.h / 2;
    const x = clamp(centerX - width / 2, 0, Math.max(0, pageSize.width - width));
    const y = clamp(centerY - height / 2, 0, Math.max(0, pageSize.height - height));
    return pixelsToBbox({ x, y, w: width, h: height }, pageSize.width, pageSize.height);
}
