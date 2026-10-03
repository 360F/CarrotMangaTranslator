// Ported from read-only fork fd461737. See source-map.json.
export function erodeBinaryMask(mask, width, height, insetPx) {
    const distances = distanceFromMaskBoundary(mask, width, height);
    const threshold = Math.max(1, insetPx);
    const eroded = new Uint8Array(mask.length);
    for (let index = 0; index < mask.length; index += 1) {
        eroded[index] = mask[index] && distances[index] > threshold ? 1 : 0;
    }
    return eroded;
}
export function distanceFromMaskBoundary(mask, width, height) {
    const distances = initializeDistances(mask, width, height);
    runForwardPass(distances, width, height);
    runBackwardPass(distances, width, height);
    return distances;
}
function initializeDistances(mask, width, height) {
    const distances = new Float32Array(mask.length);
    const far = width + height;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            distances[index] =
                !mask[index] ||
                    x === 0 ||
                    y === 0 ||
                    x === width - 1 ||
                    y === height - 1
                    ? 0
                    : far;
        }
    }
    return distances;
}
function runForwardPass(distances, width, height) {
    for (let y = 1; y < height; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
            const index = y * width + x;
            distances[index] = Math.min(distances[index], distances[index - 1] + 1, distances[index - width] + 1, distances[index - width - 1] + Math.SQRT2, distances[index - width + 1] + Math.SQRT2);
        }
    }
}
function runBackwardPass(distances, width, height) {
    for (let y = height - 2; y >= 0; y -= 1) {
        for (let x = width - 2; x >= 1; x -= 1) {
            const index = y * width + x;
            distances[index] = Math.min(distances[index], distances[index + 1] + 1, distances[index + width] + 1, distances[index + width + 1] + Math.SQRT2, distances[index + width - 1] + Math.SQRT2);
        }
    }
}
