// Ported from read-only fork fd461737. See source-map.json.
import { distanceFromMaskBoundary } from "./bubbleDistanceTransform.mjs";
const PATH_NEIGHBORS = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
];
/** One shared field per detector mask, independent of each font's safe inset. */
export function createBubbleMaskOwnershipResolver(imageWidth, imageHeight) {
    const cache = new WeakMap();
    return (mask, owner, peers) => {
        if (peers.length < 1 || peers.length > 5)
            return undefined;
        const boxes = [owner, ...peers].sort((a, b) => a.x - b.x || a.y - b.y || a.w - b.w || a.h - b.h);
        const key = JSON.stringify(boxes);
        const fields = cache.get(mask) ?? new Map();
        cache.set(mask, fields);
        if (!fields.has(key))
            fields.set(key, buildField(mask, boxes, imageWidth, imageHeight));
        const field = fields.get(key);
        return field ? { ...field, ownerIndex: boxes.indexOf(owner) } : undefined;
    };
}
export function isMaskOwnedPoint(field, pageX, pageY, gapPx) {
    const x = Math.floor(pageX * field.scaleX);
    const y = Math.floor(pageY * field.scaleY);
    if (x < 0 || y < 0 || x >= field.width || y >= field.height)
        return null;
    const index = y * field.width + x;
    const own = field.distances[field.ownerIndex][index];
    if (!Number.isFinite(own))
        return null;
    const gutter = gapPx * Math.max(field.scaleX, field.scaleY) * field.costs[index];
    return field.distances.every((distances, ownerIndex) => ownerIndex === field.ownerIndex || own + gutter < distances[index]);
}
function buildField(mask, owners, imageWidth, imageHeight) {
    if (mask.width * mask.height > 1_000_000)
        return null;
    const binary = Uint8Array.from(mask.logits, (value) => (value >= 0 ? 1 : 0));
    const scaleX = mask.width / imageWidth;
    const scaleY = mask.height / imageHeight;
    const seeds = owners.map((box) => findSeed(box, binary, mask.width, mask.height, scaleX, scaleY));
    if (seeds.some((seed) => seed < 0) || new Set(seeds).size !== seeds.length)
        return null;
    const clearance = distanceFromMaskBoundary(binary, mask.width, mask.height);
    const reference = Math.max(1, Math.min(...seeds.map((seed) => clearance[seed])));
    const costs = Float32Array.from(clearance, (distance) => 1 + (reference / (distance + reference * 0.2)) ** 2);
    const distances = seeds.map((seed) => measureMaskPaths(binary, mask.width, mask.height, costs, seed));
    if (distances.some((field) => seeds.some((seed) => !Number.isFinite(field[seed]))))
        return null;
    return {
        width: mask.width,
        height: mask.height,
        scaleX,
        scaleY,
        costs,
        distances,
    };
}
function findSeed(box, mask, width, height, scaleX, scaleY) {
    const centerX = (box.x + box.w / 2) * scaleX;
    const centerY = (box.y + box.h / 2) * scaleY;
    let seed = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let y = Math.max(0, Math.floor(box.y * scaleY)); y < Math.min(height, Math.ceil((box.y + box.h) * scaleY)); y++) {
        for (let x = Math.max(0, Math.floor(box.x * scaleX)); x < Math.min(width, Math.ceil((box.x + box.w) * scaleX)); x++) {
            const distance = (x + 0.5 - centerX) ** 2 + (y + 0.5 - centerY) ** 2;
            if (mask[y * width + x] && distance < best) {
                seed = y * width + x;
                best = distance;
            }
        }
    }
    return seed;
}
function measureMaskPaths(mask, width, height, costs, seed) {
    const distances = new Float64Array(mask.length).fill(Number.POSITIVE_INFINITY);
    const queue = new MaskPathQueue();
    distances[seed] = 0;
    queue.push(seed, 0);
    for (let next = queue.pop(); next; next = queue.pop()) {
        const [index, distance] = next;
        if (distance > distances[index])
            continue;
        const x = index % width;
        const y = Math.floor(index / width);
        for (const [dx, dy] of PATH_NEIGHBORS) {
            if (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height)
                continue;
            const neighbor = (y + dy) * width + x + dx;
            if (!mask[neighbor])
                continue;
            const cost = distance + (Math.hypot(dx, dy) * (costs[index] + costs[neighbor])) / 2;
            if (cost >= distances[neighbor])
                continue;
            distances[neighbor] = cost;
            queue.push(neighbor, cost);
        }
    }
    return distances;
}
class MaskPathQueue {
    values = [];
    push(index, cost) {
        const entry = [index, cost];
        let position = this.values.length;
        this.values.push(entry);
        while (position > 0) {
            const parent = Math.floor((position - 1) / 2);
            if (this.values[parent][1] <= cost)
                break;
            this.values[position] = this.values[parent];
            position = parent;
        }
        this.values[position] = entry;
    }
    pop() {
        const first = this.values[0];
        const last = this.values.pop();
        if (!last || this.values.length === 0)
            return first;
        let position = 0;
        while (position * 2 + 1 < this.values.length) {
            let child = position * 2 + 1;
            if (child + 1 < this.values.length &&
                this.values[child + 1][1] < this.values[child][1])
                child++;
            if (this.values[child][1] >= last[1])
                break;
            this.values[position] = this.values[child];
            position = child;
        }
        this.values[position] = last;
        return first;
    }
}
