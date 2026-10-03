// Ported from read-only fork fd461737. See source-map.json.
export function selectBlockBubbleCandidates(blockBox, associations) {
    const candidates = associations.bubbles
        .map((group) => buildBlockCandidate(blockBox, group))
        .filter((candidate) => candidate !== null)
        .sort((left, right) => right.score - left.score);
    const deduplicated = suppressDuplicateCandidates(candidates).slice(0, 4);
    return selectDominantContainingCandidate(blockBox, deduplicated);
}
/**
 * Legacy conservative ownership gate retained for callers that prefer to
 * suppress ambiguity. Production layout uses partitionSharedBubbleOwnership.
 */
export function gateExclusiveBubbleOwnership(ownerships) {
    const ownersByBubble = new Map();
    for (const ownership of ownerships) {
        for (const candidate of ownership.candidates) {
            const owners = ownersByBubble.get(candidate.bubbleDetection) ?? new Set();
            owners.add(ownership.owner);
            ownersByBubble.set(candidate.bubbleDetection, owners);
        }
    }
    return ownerships.map((ownership) => ({
        owner: ownership.owner,
        candidates: ownership.candidates.filter((candidate) => ownersByBubble.get(candidate.bubbleDetection)?.size === 1),
    }));
}
function buildBlockCandidate(blockBox, group) {
    const bubbleBox = detectionBoxToBbox(group.bubble);
    const matchedText = group.textDetections.filter((text) => overlapRatio(detectionBoxToBbox(text), blockBox) >= 0.28);
    const blockCoverage = overlapRatio(blockBox, bubbleBox);
    const centerContained = containsPoint(bubbleBox, centerOf(blockBox));
    if (matchedText.length === 0 && blockCoverage < 0.45 && !centerContained) {
        return null;
    }
    const promptBoxes = matchedText.length > 0
        ? matchedText.map(detectionBoxToBbox)
        : [intersectionBox(blockBox, bubbleBox) ?? blockBox];
    const textScore = matchedText.length > 0
        ? Math.max(...matchedText.map((text) => text.score))
        : 0.5;
    return {
        bubbleDetection: group.bubble,
        bubbleBox,
        promptBoxes,
        score: clamp(group.bubble.score * 0.65 +
            textScore * 0.2 +
            Math.min(1, blockCoverage) * 0.15, 0, 1),
    };
}
function suppressDuplicateCandidates(candidates) {
    const kept = [];
    for (const candidate of candidates) {
        const duplicate = kept.some((existing) => intersectionOverUnion(existing.bubbleBox, candidate.bubbleBox) > 0.68);
        if (!duplicate)
            kept.push(candidate);
    }
    return kept;
}
/**
 * Connected balloons are commonly returned as two overlapping detector boxes.
 * If one box contains nearly the whole OCR block while every alternative only
 * clips an edge, keep that one-to-one match. A genuinely merged OCR block
 * spanning two lobes has no such dominant candidate and therefore retains
 * both candidates for the existing multi-region path.
 */
function selectDominantContainingCandidate(blockBox, candidates) {
    if (candidates.length < 2)
        return candidates;
    const ranked = candidates
        .map((candidate) => ({
        candidate,
        coverage: overlapRatio(blockBox, candidate.bubbleBox),
    }))
        .sort((left, right) => right.coverage - left.coverage ||
        right.candidate.score - left.candidate.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (best &&
        runnerUp &&
        best.coverage >= 0.88 &&
        (runnerUp.coverage <= 0.7 || best.coverage - runnerUp.coverage >= 0.22)) {
        return [best.candidate];
    }
    return candidates;
}
function detectionBoxToBbox(detection) {
    const [left, top, right, bottom] = detection.box;
    return { x: left, y: top, w: right - left, h: bottom - top };
}
function overlapRatio(subject, container) {
    const intersection = intersectionArea(subject, container);
    return intersection / Math.max(1, subject.w * subject.h);
}
function intersectionOverUnion(left, right) {
    const intersection = intersectionArea(left, right);
    const union = left.w * left.h + right.w * right.h - intersection;
    return intersection / Math.max(1, union);
}
function intersectionArea(left, right) {
    const x1 = Math.max(left.x, right.x);
    const y1 = Math.max(left.y, right.y);
    const x2 = Math.min(left.x + left.w, right.x + right.w);
    const y2 = Math.min(left.y + left.h, right.y + right.h);
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}
function intersectionBox(left, right) {
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    const farX = Math.min(left.x + left.w, right.x + right.w);
    const farY = Math.min(left.y + left.h, right.y + right.h);
    return farX > x && farY > y ? { x, y, w: farX - x, h: farY - y } : null;
}
function centerOf(box) {
    return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}
function containsPoint(box, point) {
    return (point.x >= box.x &&
        point.x <= box.x + box.w &&
        point.y >= box.y &&
        point.y <= box.y + box.h);
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
