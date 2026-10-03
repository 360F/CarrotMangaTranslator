// Ported from read-only fork fd461737. See source-map.json.
export function extractPromptedMaskRegions(options) {
    const components = findComponents(options.mask, options.width, options.height);
    const eligible = components
        .filter((component) => component.pixels.length >= options.minimumArea)
        .filter((component, index) => index === 0 || componentTouchesPrompt(component, options))
        .slice(0, 4);
    return eligible.map((component) => componentToRegion(component, options));
}
function findComponents(mask, width, height) {
    const visited = new Uint8Array(mask.length);
    const components = [];
    for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index] || visited[index])
            continue;
        components.push(collectComponent(mask, visited, width, height, index));
    }
    return components.sort((left, right) => right.pixels.length - left.pixels.length);
}
function collectComponent(mask, visited, width, height, start) {
    const queue = [start];
    const pixels = [];
    visited[start] = 1;
    let left = start % width;
    let right = left;
    let top = Math.floor(start / width);
    let bottom = top;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const index = queue[cursor];
        pixels.push(index);
        const x = index % width;
        const y = Math.floor(index / width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        enqueueNeighbors(mask, visited, width, height, x, y, queue);
    }
    return { pixels, left, top, right, bottom };
}
function enqueueNeighbors(mask, visited, width, height, x, y, queue) {
    const neighbors = [
        x > 0 ? y * width + x - 1 : -1,
        x + 1 < width ? y * width + x + 1 : -1,
        y > 0 ? (y - 1) * width + x : -1,
        y + 1 < height ? (y + 1) * width + x : -1,
    ];
    for (const index of neighbors) {
        if (index >= 0 && mask[index] && !visited[index]) {
            visited[index] = 1;
            queue.push(index);
        }
    }
}
function componentTouchesPrompt(component, options) {
    const bounds = {
        x: component.left + options.cropX,
        y: component.top + options.cropY,
        w: component.right - component.left + 1,
        h: component.bottom - component.top + 1,
    };
    return options.promptBoxes.some((prompt) => intersectionArea(bounds, prompt) > 0);
}
function componentToRegion(component, options) {
    const width = component.right - component.left + 1;
    const height = component.bottom - component.top + 1;
    const mask = new Uint8Array(width * height);
    for (const index of component.pixels) {
        const sourceX = index % options.width;
        const sourceY = Math.floor(index / options.width);
        mask[(sourceY - component.top) * width + sourceX - component.left] = 1;
    }
    return {
        bounds: {
            x: component.left + options.cropX,
            y: component.top + options.cropY,
            w: width,
            h: height,
        },
        mask,
        width,
        height,
        area: component.pixels.length,
    };
}
function intersectionArea(left, right) {
    const x1 = Math.max(left.x, right.x);
    const y1 = Math.max(left.y, right.y);
    const x2 = Math.min(left.x + left.w, right.x + right.w);
    const y2 = Math.min(left.y + left.h, right.y + right.h);
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}
