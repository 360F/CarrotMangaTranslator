// Ported from read-only fork fd461737. See source-map.json.
const DEFAULT_MIN_TEXT_CONTAINMENT = 0.5;
export function associateComicDetections(detections, options = {}) {
    const minContainment = options.minTextContainment ?? DEFAULT_MIN_TEXT_CONTAINMENT;
    assertContainmentThreshold(minContainment);
    const bubbles = detections
        .filter((detection) => detection.label === "bubble")
        .map((bubble) => ({ bubble, textDetections: [] }));
    const unassociatedBubbleText = [];
    const freeText = detections.filter((detection) => detection.label === "onomatopoeia");
    for (const text of detections) {
        if (text.label !== "text")
            continue;
        const association = findBestBubbleAssociation(text, bubbles);
        if (association && association.containment >= minContainment) {
            association.group.textDetections.push(text);
        }
        else {
            unassociatedBubbleText.push(text);
            freeText.push(text);
        }
    }
    return { bubbles, unassociatedBubbleText, freeText };
}
function findBestBubbleAssociation(text, groups) {
    let best = null;
    for (const group of groups) {
        const containment = intersectionOverTextArea(text.box, group.bubble.box);
        if (!best ||
            containment > best.containment ||
            (containment === best.containment &&
                group.bubble.score > best.group.bubble.score)) {
            best = { group, containment };
        }
    }
    return best;
}
function intersectionOverTextArea(textBox, bubbleBox) {
    const textArea = boxArea(textBox);
    if (textArea <= 0)
        return 0;
    const width = Math.max(0, Math.min(textBox[2], bubbleBox[2]) - Math.max(textBox[0], bubbleBox[0]));
    const height = Math.max(0, Math.min(textBox[3], bubbleBox[3]) - Math.max(textBox[1], bubbleBox[1]));
    return (width * height) / textArea;
}
function boxArea(box) {
    return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}
function assertContainmentThreshold(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("minTextContainment는 0 이상 1 이하여야 합니다.");
    }
}
