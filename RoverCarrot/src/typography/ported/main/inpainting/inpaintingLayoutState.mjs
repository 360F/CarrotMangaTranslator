// Ported from read-only fork fd461737. See source-map.json.
import { isDeepStrictEqual } from "node:util";
export function captureInpaintingLayoutStates(page, blockIds, options = {}) {
    return captureSelectedInpaintingLayoutStates(page, blockIds, () => options.includeTranslatedText === true, () => options.includeRenderDirection === true);
}
function captureSelectedInpaintingLayoutStates(page, blockIds, includeTranslatedText, includeRenderDirection) {
    const blocksById = new Map(page.blocks.map((block) => [block.id, block]));
    const seen = new Set();
    return blockIds.map((blockId, index) => {
        if (seen.has(blockId)) {
            throw new Error("말풍선 배치 기록에 같은 블록이 중복되었습니다.");
        }
        seen.add(blockId);
        const block = blocksById.get(blockId);
        if (!block) {
            throw new Error("말풍선 배치를 적용할 텍스트 블록을 찾지 못했습니다.");
        }
        const bubbleLayout = block.bubbleLayout;
        const state = {
            blockId,
            renderBbox: block.renderBbox ? cloneSerializable(block.renderBbox) : null,
            renderBboxSpace: block.renderBboxSpace ?? null,
            bubbleLayout: bubbleLayout === undefined ? null : cloneSerializable(bubbleLayout),
        };
        if (includeTranslatedText(index)) {
            assertStoredTranslatedText(block.translatedText);
            state.translatedText = block.translatedText;
        }
        if (includeRenderDirection(index)) {
            state.renderDirection = block.renderDirection;
        }
        return state;
    });
}
export function applyInpaintingLayoutStates(page, states) {
    if (states.length === 0) {
        return page;
    }
    const stateById = new Map();
    for (const state of states) {
        if (stateById.has(state.blockId)) {
            throw new Error("말풍선 배치 기록에 같은 블록이 중복되었습니다.");
        }
        assertStoredRenderBbox(state.renderBbox);
        if (hasOwnTranslatedText(state)) {
            assertStoredTranslatedText(state.translatedText);
        }
        if (hasOwnRenderDirection(state)) {
            assertStoredRenderDirection(state.renderDirection);
        }
        stateById.set(state.blockId, state);
    }
    const knownIds = new Set(page.blocks.map((block) => block.id));
    for (const blockId of stateById.keys()) {
        if (!knownIds.has(blockId)) {
            throw new Error("말풍선 배치를 적용할 텍스트 블록을 찾지 못했습니다.");
        }
    }
    return {
        ...page,
        blocks: page.blocks.map((block) => {
            const state = stateById.get(block.id);
            if (!state) {
                return block;
            }
            const next = { ...block };
            if (state.renderBbox === null) {
                delete next.renderBbox;
                delete next.renderBboxSpace;
            }
            else {
                next.renderBbox = cloneSerializable(state.renderBbox);
                if (state.renderBboxSpace === null) {
                    delete next.renderBboxSpace;
                }
                else {
                    next.renderBboxSpace = state.renderBboxSpace;
                }
            }
            if (state.bubbleLayout === null) {
                delete next.bubbleLayout;
            }
            else {
                next.bubbleLayout = cloneSerializable(state.bubbleLayout);
            }
            if (hasOwnTranslatedText(state)) {
                const translatedText = state.translatedText;
                assertStoredTranslatedText(translatedText);
                next.translatedText = translatedText;
            }
            if (hasOwnRenderDirection(state)) {
                const renderDirection = state.renderDirection;
                assertStoredRenderDirection(renderDirection);
                next.renderDirection = renderDirection;
            }
            return next;
        }),
    };
}
export function inpaintingLayoutStatesEqual(left, right) {
    return isDeepStrictEqual(left ?? [], right ?? []);
}
export function pageMatchesInpaintingLayoutStates(page, expected) {
    if (!expected || expected.length === 0) {
        return true;
    }
    for (const state of expected) {
        if (hasOwnTranslatedText(state)) {
            assertStoredTranslatedText(state.translatedText);
        }
        if (hasOwnRenderDirection(state)) {
            assertStoredRenderDirection(state.renderDirection);
        }
    }
    return inpaintingLayoutStatesEqual(captureSelectedInpaintingLayoutStates(page, expected.map((state) => state.blockId), (index) => hasOwnTranslatedText(expected[index]), (index) => hasOwnRenderDirection(expected[index])), expected);
}
export function cloneInpaintingLayoutStates(states) {
    return states ? cloneSerializable([...states]) : undefined;
}
function assertStoredRenderBbox(bbox) {
    if (bbox &&
        (!Number.isFinite(bbox.x) ||
            !Number.isFinite(bbox.y) ||
            !Number.isFinite(bbox.w) ||
            !Number.isFinite(bbox.h) ||
            bbox.w <= 0 ||
            bbox.h <= 0)) {
        throw new Error("말풍선 배치 기록의 렌더링 영역이 올바르지 않습니다.");
    }
}
function assertStoredTranslatedText(value) {
    if (typeof value !== "string") {
        throw new Error("말풍선 배치 기록의 번역문이 올바르지 않습니다.");
    }
}
function assertStoredRenderDirection(value) {
    if (value !== "horizontal" && value !== "vertical") {
        throw new Error("말풍선 배치 기록의 텍스트 방향이 올바르지 않습니다.");
    }
}
function hasOwnTranslatedText(state) {
    return (state !== undefined &&
        Object.prototype.hasOwnProperty.call(state, "translatedText"));
}
function hasOwnRenderDirection(state) {
    return (state !== undefined &&
        Object.prototype.hasOwnProperty.call(state, "renderDirection"));
}
function cloneSerializable(value) {
    return structuredClone(value);
}
