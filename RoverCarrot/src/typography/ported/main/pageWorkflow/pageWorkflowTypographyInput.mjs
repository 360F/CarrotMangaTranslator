// Ported from read-only fork fd461737. See source-map.json.
import { normalizeBboxTo1000 } from "../../shared/bboxNormalization.mjs";
import { workflowRegionKey } from "../../shared/pageWorkflowPolicy.mjs";
import { buildKeepBlocksOcrResult } from "../pipeline/keepBlocksResult.mjs";
import { applyOcrCandidateGeometryLocks } from "../pipeline/overlayOcrGeometryLocks.mjs";
import { attachFontMatchingFixedBlockCandidateMembership } from "../pipeline/fontMatchingOcrGeometryDirection.mjs";
function workflowOcrHints(page) {
    const result = buildKeepBlocksOcrResult(page, page.blocks.map((b) => b.sourceText));
    return {
        ...result,
        hints: result.hints.map((hint, index) => ({
            ...hint,
            recognitionSegments: page.blocks[index].workflowOrigin?.geometryKey ===
                workflowRegionKey(page, page.blocks[index])
                ? page.blocks[index].workflowOrigin?.recognitionSegments
                : undefined,
        })),
    };
}
export function workflowOverlayItems(page) {
    const items = page.blocks.map((block, index) => ({
        id: index + 1,
        candidateIds: [index + 1],
        type: "nonsolid",
        bbox: normalizeBboxTo1000(block.bbox, page, block.bboxSpace),
        jp: block.sourceText,
        ko: block.translatedText,
        confidence: block.confidence,
        textRole: block.textRole,
        fontRole: block.fontRole,
        fontRoleConfidence: block.fontRoleConfidence,
        visualClusterId: block.visualClusterId,
        direction: block.sourceDirection,
    }));
    return attachFontMatchingFixedBlockCandidateMembership(applyOcrCandidateGeometryLocks(items, page, workflowOcrHints(page).hints), {
        fixedBlockTranslationVersion: 6,
        fixedBlockIds: items.map((_, index) => `B${String(index + 1).padStart(3, "0")}`),
        fixedBlockCandidateIds: items.map((item) => [item.id]),
        fixedBlockDirectionVoterCandidateIds: items.map((item) => [item.id]),
    });
}
