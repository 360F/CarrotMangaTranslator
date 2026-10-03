// Ported from read-only fork fd461737. See source-map.json.
import { isUsableBubbleLayout } from "../../shared/bubbleLayout.mjs";
import { applyNaturalTextLayout } from "../../shared/naturalTextLayout.mjs";
import { readUnsuppressedTextLayoutIntent, shouldApplyExteriorVerticalLayoutIntent, } from "../../shared/textLayoutIntent.mjs";
import { captureInpaintingLayoutStates, inpaintingLayoutStatesEqual, } from "./inpaintingLayoutState.mjs";
export function applyBubbleNaturalTextLayout(page, config, blockId, blockIds) {
    if (!config) {
        return page;
    }
    const allowedBlockIds = blockIds ? new Set(blockIds) : null;
    let changed = false;
    const blocks = page.blocks.map((block) => {
        if ((blockId && block.id !== blockId) ||
            (allowedBlockIds && !allowedBlockIds.has(block.id)) ||
            block.curveLayout) {
            return block;
        }
        const next = applyNaturalLayoutToEligibleBlock(block, page, config);
        if (next !== block)
            changed = true;
        return next;
    });
    return changed ? { ...page, blocks } : page;
}
function applyNaturalLayoutToEligibleBlock(block, page, config) {
    const hasBubbleLayout = isUsableBubbleLayout(block.bubbleLayout);
    if (!hasBubbleLayout && block.textRole !== "ordinary")
        return block;
    const direction = resolveNaturalDirectionPlan(block, page, hasBubbleLayout);
    const layout = applyNaturalTextLayout(direction.block, {
        enabled: true,
        pageSize: { width: page.width, height: page.height },
        locale: config.locale,
        allowAutoVertical: direction.allowAutoVertical,
        directionPreference: direction.preference,
    });
    const translatedText = resolveNaturalTranslatedText(block, layout, hasBubbleLayout);
    if (translatedText === block.translatedText &&
        layout.renderDirection === block.renderDirection) {
        return block;
    }
    return {
        ...block,
        translatedText,
        renderDirection: layout.renderDirection,
    };
}
function resolveNaturalDirectionPlan(block, page, hasBubbleLayout) {
    const storedIntent = readUnsuppressedTextLayoutIntent(block);
    // Missing intent covers legacy blocks and an explicit user/default override
    // that cleared Gemma's advisory. Preserve the chosen render direction in
    // both cases; only a genuinely persisted auto value may run auto-vertical.
    const intent = storedIntent ?? block.renderDirection;
    const applyVerticalIntent = !hasBubbleLayout && shouldApplyExteriorVerticalLayoutIntent(block, page);
    return {
        block: resolveAdvisoryDirectionBlock(block, hasBubbleLayout, applyVerticalIntent),
        preference: resolveDirectionPreference(block, intent, hasBubbleLayout, applyVerticalIntent),
        allowAutoVertical: !hasBubbleLayout &&
            block.textRole === "ordinary" &&
            storedIntent === "auto",
    };
}
function resolveDirectionPreference(block, intent, hasBubbleLayout, applyVerticalIntent) {
    if (hasBubbleLayout) {
        return block.bubbleLayout?.direction ?? block.renderDirection;
    }
    if (intent !== "vertical")
        return intent;
    return applyVerticalIntent ? "vertical" : "horizontal";
}
function resolveNaturalTranslatedText(block, layout, hasBubbleLayout) {
    return hasBubbleLayout && layout.diagnostics.shapeAware !== true
        ? block.translatedText
        : layout.translatedText;
}
function resolveAdvisoryDirectionBlock(block, hasBubbleLayout, applyVerticalIntent) {
    if (hasBubbleLayout) {
        if (readUnsuppressedTextLayoutIntent(block) !== "vertical") {
            return block;
        }
        const bubbleDirection = block.bubbleLayout?.direction;
        return bubbleDirection && bubbleDirection !== block.renderDirection
            ? { ...block, renderDirection: bubbleDirection }
            : block;
    }
    if (readUnsuppressedTextLayoutIntent(block) !== "vertical") {
        return block;
    }
    const renderDirection = applyVerticalIntent ? "vertical" : "horizontal";
    return renderDirection === block.renderDirection
        ? block
        : { ...block, renderDirection };
}
export function collectBubbleLayoutChanges(beforePage, afterPage, geometryBlockIds) {
    const beforeLayout = [];
    const afterLayout = [];
    for (const blockId of resolveChangedBlockIds(beforePage, afterPage, geometryBlockIds)) {
        const beforeBlock = beforePage.blocks.find((block) => block.id === blockId);
        const afterBlock = afterPage.blocks.find((block) => block.id === blockId);
        if (!beforeBlock || !afterBlock) {
            throw missingBlockError();
        }
        const includeText = beforeBlock.translatedText !== afterBlock.translatedText;
        const includeRenderDirection = beforeBlock.renderDirection !== afterBlock.renderDirection;
        const before = captureLayoutState(beforePage, blockId, includeText, includeRenderDirection);
        const after = captureLayoutState(afterPage, blockId, includeText, includeRenderDirection);
        if (!inpaintingLayoutStatesEqual([before], [after])) {
            beforeLayout.push(before);
            afterLayout.push(after);
        }
    }
    return { beforeLayout, afterLayout };
}
function resolveChangedBlockIds(beforePage, afterPage, geometryBlockIds) {
    const ids = new Set(geometryBlockIds);
    const beforeById = new Map(beforePage.blocks.map((block) => [block.id, block]));
    for (const block of afterPage.blocks) {
        const before = beforeById.get(block.id);
        if (before?.translatedText !== block.translatedText ||
            before?.renderDirection !== block.renderDirection) {
            ids.add(block.id);
        }
    }
    return [...ids];
}
function captureLayoutState(page, blockId, includeTranslatedText, includeRenderDirection) {
    const state = captureInpaintingLayoutStates(page, [blockId], {
        ...(includeTranslatedText ? { includeTranslatedText: true } : {}),
        ...(includeRenderDirection ? { includeRenderDirection: true } : {}),
    })[0];
    if (!state) {
        throw missingBlockError();
    }
    return state;
}
function missingBlockError() {
    return new Error("말풍선 배치를 적용할 텍스트 블록을 찾지 못했습니다.");
}
