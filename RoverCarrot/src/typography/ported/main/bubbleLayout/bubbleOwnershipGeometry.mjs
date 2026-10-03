// Ported from read-only fork fd461737. See source-map.json.
export function choosePartitionAxis(boxes, bubbleBox) {
    const score = (axis) => {
        const centers = boxes.map((box) => axisCenter(box, axis));
        const spread = Math.max(...centers) - Math.min(...centers);
        const meanExtent = boxes.reduce((total, box) => total + axisLength(box, axis), 0) /
            Math.max(1, boxes.length);
        return (spread / Math.max(1, meanExtent) +
            (spread / Math.max(1, axisLength(bubbleBox, axis))) * 0.35);
    };
    return score("x") >= score("y") ? "x" : "y";
}
export function buildPartitionCuts(boxes, axis) {
    const cuts = [];
    for (let index = 0; index < boxes.length - 1; index += 1) {
        const current = boxes[index];
        const next = boxes[index + 1];
        const currentEnd = axisStart(current, axis) + axisLength(current, axis);
        const nextStart = axisStart(next, axis);
        cuts.push(currentEnd <= nextStart
            ? (currentEnd + nextStart) / 2
            : (axisCenter(current, axis) + axisCenter(next, axis)) / 2);
    }
    return cuts;
}
export function constrainPartitionCuts(idealCuts, bubbleBox, axis, gapPx) {
    if (idealCuts.length === 0)
        return [];
    const start = axisStart(bubbleBox, axis);
    const end = start + axisLength(bubbleBox, axis);
    const minimumCellSize = 2;
    const requiredLength = minimumCellSize * (idealCuts.length + 1) + gapPx * idealCuts.length;
    if (end - start < requiredLength) {
        return evenlySpacedCuts(start, end, idealCuts.length);
    }
    const cuts = [...idealCuts];
    for (let index = 0; index < cuts.length; index += 1) {
        cuts[index] = Math.max(cuts[index], start + minimumCellSize * (index + 1) + gapPx * index + gapPx / 2);
    }
    for (let index = cuts.length - 1; index >= 0; index -= 1) {
        const remainingCells = cuts.length - index;
        cuts[index] = Math.min(cuts[index], end -
            minimumCellSize * remainingCells -
            gapPx * (remainingCells - 1) -
            gapPx / 2);
    }
    return cuts;
}
export function buildPartitionBox(bubbleBox, axis, cuts, index, gapPx) {
    const bubbleStart = axisStart(bubbleBox, axis);
    const bubbleEnd = bubbleStart + axisLength(bubbleBox, axis);
    const start = index === 0
        ? bubbleStart
        : Math.min(bubbleEnd, cuts[index - 1] + gapPx / 2);
    const end = index === cuts.length
        ? bubbleEnd
        : Math.max(bubbleStart, cuts[index] - gapPx / 2);
    return axis === "x"
        ? {
            x: start,
            y: bubbleBox.y,
            w: Math.max(0, end - start),
            h: bubbleBox.h,
        }
        : {
            x: bubbleBox.x,
            y: start,
            w: bubbleBox.w,
            h: Math.max(0, end - start),
        };
}
export function otherAxis(axis) {
    return axis === "x" ? "y" : "x";
}
export function axisCenter(box, axis) {
    return axisStart(box, axis) + axisLength(box, axis) / 2;
}
export function resolvePartitionGapPx(requestedGapPx) {
    if (!Number.isFinite(requestedGapPx))
        return 3;
    if (requestedGapPx <= 0)
        return 0;
    return clamp(requestedGapPx, 3, 6);
}
function evenlySpacedCuts(start, end, cutCount) {
    return Array.from({ length: cutCount }, (_, index) => start + ((end - start) * (index + 1)) / (cutCount + 1));
}
function axisStart(box, axis) {
    return axis === "x" ? box.x : box.y;
}
function axisLength(box, axis) {
    return axis === "x" ? box.w : box.h;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
