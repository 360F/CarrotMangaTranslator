// Ported from read-only fork fd461737. See source-map.json.
export function isBubbleLayoutBlockEligible(block, blockId) {
    return ((!blockId || block.id === blockId) &&
        !block.inpaintExcluded &&
        !block.curveLayout &&
        Boolean(block.translatedText.trim()) &&
        block.bbox.w > 0 &&
        block.bbox.h > 0);
}
