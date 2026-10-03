// Ported from read-only fork fd461737. See source-map.json.
import { erodeBinaryMask } from "./bubbleDistanceTransform.mjs";
import { extractPromptedMaskRegions } from "./bubbleMaskComponents.mjs";
const POLICY_INSET_SCALE = {
    safe: 1.2,
    balanced: 1,
    maximize: 0.75,
};
/**
 * Converts KoharuLayout's full-page 288² instance logits into the fitting
 * region used by the editor. No color flood, ellipse, or legacy detector
 * fallback is permitted: an absent/invalid Koharu mask produces no layout.
 */
export function refineKoharuBubbleMask(input) {
    assertMask(input.mask);
    const crop = clampCrop(input.bubbleBox, input.imageWidth, input.imageHeight);
    if (crop.width < 4 || crop.height < 4)
        return null;
    const raw = rasterizeMaskLogits(input.mask, crop, input);
    const rawArea = countMask(raw);
    if (rawArea < 24)
        return null;
    const promptCoverage = measurePromptCoverage(input.promptBoxes, crop, raw);
    if (promptCoverage < 0.12)
        return null;
    const insetPx = resolveKoharuSafeInsetPx(input);
    const safeMask = erodeBinaryMask(raw, crop.width, crop.height, insetPx);
    const regions = extractPromptedMaskRegions({
        mask: safeMask,
        width: crop.width,
        height: crop.height,
        cropX: crop.x,
        cropY: crop.y,
        promptBoxes: input.promptBoxes,
        minimumArea: Math.max(16, Math.floor(rawArea * 0.0125)),
    });
    if (regions.length === 0)
        return null;
    return {
        regions,
        insetPx,
        promptCoverage,
        confidence: clamp(0.55 + promptCoverage * 0.45, 0, 1),
    };
}
export function resolveKoharuSafeInsetPx(input) {
    const base = Math.max(3, input.fontSizePx * 0.18, input.outlineWidthPx * 2.5);
    return base * POLICY_INSET_SCALE[input.policy];
}
function rasterizeMaskLogits(mask, crop, imageSize) {
    const output = new Uint8Array(crop.width * crop.height);
    for (let localY = 0; localY < crop.height; localY += 1) {
        const pageY = crop.y + localY + 0.5;
        const maskY = (pageY / imageSize.imageHeight) * mask.height - 0.5;
        for (let localX = 0; localX < crop.width; localX += 1) {
            const pageX = crop.x + localX + 0.5;
            const maskX = (pageX / imageSize.imageWidth) * mask.width - 0.5;
            output[localY * crop.width + localX] =
                bilinearSample(mask, maskX, maskY) >= 0 ? 1 : 0;
        }
    }
    return output;
}
function bilinearSample(mask, sourceX, sourceY) {
    const left = clampInteger(Math.floor(sourceX), 0, mask.width - 1);
    const top = clampInteger(Math.floor(sourceY), 0, mask.height - 1);
    const right = Math.min(mask.width - 1, left + 1);
    const bottom = Math.min(mask.height - 1, top + 1);
    const fractionX = clamp(sourceX - Math.floor(sourceX), 0, 1);
    const fractionY = clamp(sourceY - Math.floor(sourceY), 0, 1);
    const topValue = (mask.logits[top * mask.width + left] ?? 0) * (1 - fractionX) +
        (mask.logits[top * mask.width + right] ?? 0) * fractionX;
    const bottomValue = (mask.logits[bottom * mask.width + left] ?? 0) * (1 - fractionX) +
        (mask.logits[bottom * mask.width + right] ?? 0) * fractionX;
    return topValue * (1 - fractionY) + bottomValue * fractionY;
}
function measurePromptCoverage(prompts, crop, mask) {
    let covered = 0;
    let total = 0;
    for (const prompt of prompts) {
        const area = intersectCrop(prompt, crop);
        if (!area)
            continue;
        for (let y = area.y; y < area.y + area.height; y += 2) {
            for (let x = area.x; x < area.x + area.width; x += 2) {
                total += 1;
                covered += mask[(y - crop.y) * crop.width + x - crop.x] ?? 0;
            }
        }
    }
    return total > 0 ? covered / total : 0;
}
function clampCrop(box, width, height) {
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const right = Math.min(width, Math.ceil(box.x + box.w));
    const bottom = Math.min(height, Math.ceil(box.y + box.h));
    return {
        x,
        y,
        width: Math.max(0, right - x),
        height: Math.max(0, bottom - y),
    };
}
function intersectCrop(box, crop) {
    const x = Math.max(crop.x, Math.floor(box.x));
    const y = Math.max(crop.y, Math.floor(box.y));
    const right = Math.min(crop.x + crop.width, Math.ceil(box.x + box.w));
    const bottom = Math.min(crop.y + crop.height, Math.ceil(box.y + box.h));
    return right > x && bottom > y
        ? { x, y, width: right - x, height: bottom - y }
        : null;
}
function assertMask(mask) {
    if (!Number.isInteger(mask.width) ||
        !Number.isInteger(mask.height) ||
        mask.width <= 0 ||
        mask.height <= 0 ||
        mask.logits.length !== mask.width * mask.height) {
        throw new Error("KoharuLayout instance mask 형식이 올바르지 않습니다.");
    }
}
function countMask(mask) {
    let count = 0;
    for (const value of mask)
        count += value;
    return count;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function clampInteger(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
