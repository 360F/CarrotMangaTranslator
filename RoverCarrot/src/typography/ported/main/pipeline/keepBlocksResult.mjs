// Ported from read-only fork fd461737. See source-map.json.
import { bboxToPixels } from "../../shared/geometry.mjs";
export function buildKeepBlocksOcrResult(page, ocrTexts) {
    const hints = page.blocks.map((block, index) => {
        const rect = block.bboxSpace === "pixels"
            ? block.bbox
            : bboxToPixels(block.bbox, page.width, page.height);
        const ocrText = ocrTexts?.[index];
        return {
            id: index + 1,
            label: "block",
            x1: Math.round(rect.x),
            y1: Math.round(rect.y),
            x2: Math.round(rect.x + rect.w),
            y2: Math.round(rect.y + rect.h),
            score: 1,
            ...(ocrText ? { ocrText } : {}),
        };
    });
    return {
        hints,
        diagnostics: [{ provider: "keep-blocks", reason: "existing-page-blocks" }],
        noTextDetected: false,
        textEvidenceCount: hints.length,
    };
}
