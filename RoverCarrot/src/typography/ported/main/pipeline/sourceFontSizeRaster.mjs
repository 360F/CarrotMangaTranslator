// Ported from read-only fork fd461737. See source-map.json.
const MIN_COMPONENT_AREA_PX = 3;
const MAX_CROP_PIXELS = 1_000_000;
const NEIGHBOR_OFFSETS = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
];
export function buildSourceFontCoreMask(page, bbox, signal) {
    const rect = normalizedBboxToPixels(bbox, page.width, page.height);
    if (!rect)
        return null;
    const width = rect.x2 - rect.x1;
    const height = rect.y2 - rect.y1;
    if (width * height > MAX_CROP_PIXELS)
        return null;
    const { grayscale, histogram } = cropGrayscale(page, rect, width, height, signal);
    const threshold = otsuThreshold(histogram);
    let darkCount = 0;
    for (const value of grayscale) {
        if (value <= threshold)
            darkCount += 1;
    }
    const darkForeground = darkCount <= grayscale.length - darkCount;
    const mask = new Uint8Array(grayscale.length);
    for (let index = 0; index < grayscale.length; index += 1) {
        const dark = (grayscale[index] ?? 0) <= threshold;
        mask[index] = dark === darkForeground ? 1 : 0;
    }
    const componentCount = cleanComponents(mask, width, height, signal);
    let foregroundPixels = 0;
    for (const value of mask)
        foregroundPixels += value;
    return {
        componentCount,
        foregroundRatio: foregroundPixels / Math.max(1, mask.length),
        height,
        mask,
        width,
    };
}
function normalizedBboxToPixels(bbox, width, height) {
    const x1 = clamp(Math.floor((bbox.x * width) / 1_000), 0, width);
    const y1 = clamp(Math.floor((bbox.y * height) / 1_000), 0, height);
    const x2 = clamp(Math.ceil(((bbox.x + bbox.w) * width) / 1_000), 0, width);
    const y2 = clamp(Math.ceil(((bbox.y + bbox.h) * height) / 1_000), 0, height);
    return x2 - x1 >= 8 && y2 - y1 >= 8 ? { x1, y1, x2, y2 } : null;
}
function cropGrayscale(page, rect, width, height, signal) {
    const grayscale = new Uint8Array(width * height);
    const histogram = new Uint32Array(256);
    for (let y = 0; y < height; y += 1) {
        if ((y & 0x3f) === 0)
            throwIfAborted(signal);
        for (let x = 0; x < width; x += 1) {
            const source = ((rect.y1 + y) * page.width + rect.x1 + x) * 4;
            const blue = page.bgra[source] ?? 0;
            const green = page.bgra[source + 1] ?? 0;
            const red = page.bgra[source + 2] ?? 0;
            const value = (red * 9_798 + green * 19_235 + blue * 3_735 + 16_384) >> 15;
            const target = y * width + x;
            grayscale[target] = value;
            histogram[value] += 1;
        }
    }
    return { grayscale, histogram };
}
function cleanComponents(mask, width, height, signal) {
    const visited = new Uint8Array(mask.length);
    const queue = new Int32Array(mask.length);
    let kept = 0;
    for (let origin = 0; origin < mask.length; origin += 1) {
        if (!mask[origin] || visited[origin])
            continue;
        throwIfAborted(signal);
        const component = collectComponent({
            height,
            mask,
            origin,
            queue,
            visited,
            width,
        });
        const touches = Number(component.x1 === 0) +
            Number(component.y1 === 0) +
            Number(component.x2 === width) +
            Number(component.y2 === height);
        const enclosing = touches >= 3 && component.area / Math.max(1, mask.length) > 0.08;
        if (component.area < MIN_COMPONENT_AREA_PX || enclosing) {
            for (let index = 0; index < component.area; index += 1) {
                mask[queue[index] ?? 0] = 0;
            }
        }
        else {
            kept += 1;
        }
    }
    return kept;
}
function collectComponent(options) {
    const { height, mask, origin, queue, visited, width } = options;
    let head = 0;
    let tail = 1;
    let x1 = width;
    let y1 = height;
    let x2 = 0;
    let y2 = 0;
    queue[0] = origin;
    visited[origin] = 1;
    while (head < tail) {
        const pixel = queue[head++] ?? 0;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        x1 = Math.min(x1, x);
        y1 = Math.min(y1, y);
        x2 = Math.max(x2, x + 1);
        y2 = Math.max(y2, y + 1);
        for (const [offsetX, offsetY] of NEIGHBOR_OFFSETS) {
            const nextX = x + offsetX;
            const nextY = y + offsetY;
            if (!isInsideRaster(nextX, nextY, width, height))
                continue;
            const next = nextY * width + nextX;
            if (!mask[next] || visited[next])
                continue;
            visited[next] = 1;
            queue[tail++] = next;
        }
    }
    return { area: tail, x1, y1, x2, y2 };
}
function isInsideRaster(x, y, width, height) {
    return x >= 0 && y >= 0 && x < width && y < height;
}
function otsuThreshold(histogram) {
    const total = histogram.reduce((sum, count) => sum + count, 0);
    if (total <= 0)
        return 0;
    let totalMean = 0;
    for (let index = 0; index < histogram.length; index += 1) {
        totalMean += index * (histogram[index] ?? 0);
    }
    let firstCount = 0;
    let firstSum = 0;
    let maximumVariance = 0;
    let selected = 0;
    for (let index = 0; index < histogram.length; index += 1) {
        const count = histogram[index] ?? 0;
        firstCount += count;
        if (firstCount === 0 || firstCount === total)
            continue;
        firstSum += index * count;
        const firstMean = firstSum / firstCount;
        const secondMean = (totalMean - firstSum) / (total - firstCount);
        const difference = firstMean - secondMean;
        const variance = firstCount * (total - firstCount) * difference * difference;
        if (variance > maximumVariance) {
            maximumVariance = variance;
            selected = index;
        }
    }
    return selected;
}
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
