// Ported from read-only fork fd461737. See source-map.json.
import { resolveBubbleLayoutPaddingRatio } from "../../shared/bubbleLayoutPadding.mjs";
import { isUsableBubbleLayout } from "../../shared/bubbleLayout.mjs";
import { applyInpaintingLayoutStates, captureInpaintingLayoutStates, } from "./inpaintingLayoutState.mjs";
import { applyBubbleNaturalTextLayout, collectBubbleLayoutChanges, } from "./bubbleLayoutNaturalText.mjs";
import { collectSharedInpaintGroups, parseBubbleLayoutRunnerPatches, } from "./bubbleLayoutRunnerPatches.mjs";
export function resolveBubbleLayoutPostprocessConfig(request, settings) {
    const requested = request.postprocess?.bubbleLayout;
    const enabled = requested?.enabled ??
        settings.inpainting?.bubbleLayoutAfterInpainting ??
        false;
    return enabled
        ? {
            policy: requested?.policy ?? "balanced",
            paddingRatio: resolveSettingsBubbleLayoutPaddingRatio(settings),
            overwriteManual: false,
            ...(requested?.naturalTextLayout
                ? {
                    naturalTextLayout: {
                        locale: settings.translation?.targetLanguage,
                    },
                }
                : {}),
        }
        : null;
}
export async function runBubbleLayoutPostprocess({ blockId, blockIds, config, failureMode = "required", includeTypographySegmentation = false, page, runner, signal, }) {
    throwIfAborted(signal);
    // The manual layout-only action must also work before inpainting. Use the
    // cleaned artifact when it exists because it produces a better safe mask,
    // otherwise derive the same render-only layout from the original page.
    const imagePath = page.inpaintedImagePath ?? page.imagePath;
    // Never expose the page instance that will be committed to an adapter.
    // Returned data is applied through the render-only patch allowlist below.
    const baselinePage = clonePageWithBlocks(page);
    const runnerPage = clonePageWithBlocks(baselinePage);
    let result;
    try {
        result = await runner.runPage({
            failureMode,
            targetBlockIds: blockId ? [blockId] : blockIds,
            imagePath,
            page: runnerPage,
            policy: config.policy,
            paddingRatio: resolveBubbleLayoutPaddingRatio(config.paddingRatio),
            sharedOwnershipGapPx: config.sharedOwnershipGapPx,
            includeTypographySegmentation,
            signal,
        });
    }
    catch (error) {
        throwIfAborted(signal);
        if (failureMode !== "best-effort")
            throw error;
        return { page: baselinePage };
    }
    throwIfAborted(signal);
    const patches = parseBubbleLayoutRunnerPatches(result, baselinePage, config.overwriteManual, blockId, blockIds);
    const geometryPage = applyRunnerPatchesToPage(baselinePage, patches);
    const finalPage = applyBubbleNaturalTextLayout(geometryPage, config.naturalTextLayout, blockId, blockIds);
    const { beforeLayout, afterLayout } = collectBubbleLayoutChanges(baselinePage, finalPage, patches.map((patch) => patch.blockId));
    const sharedInpaintGroupIdsByBlock = collectSharedInpaintGroups(patches);
    if (afterLayout.length === 0) {
        return attachRunnerMetadata(result, sharedInpaintGroupIdsByBlock, {
            page: baselinePage,
        });
    }
    return attachRunnerMetadata(result, sharedInpaintGroupIdsByBlock, {
        page: applyInpaintingLayoutStates(baselinePage, afterLayout),
        beforeLayout,
        afterLayout,
    });
}
function attachRunnerMetadata(result, sharedInpaintGroupIdsByBlock, output) {
    return {
        ...output,
        ...(result.typographySegmentation
            ? { typographySegmentation: result.typographySegmentation }
            : {}),
        ...(Object.keys(sharedInpaintGroupIdsByBlock).length
            ? { sharedInpaintGroupIdsByBlock }
            : {}),
    };
}
function clonePageWithBlocks(page) {
    return {
        ...page,
        blocks: page.blocks.map((block) => structuredClone(block)),
    };
}
function applyRunnerPatchesToPage(page, patches) {
    const states = patches.map((patch) => {
        const before = captureInpaintingLayoutStates(page, [patch.blockId])[0];
        if (!before) {
            throw new Error("말풍선 배치를 적용할 텍스트 블록을 찾지 못했습니다.");
        }
        return applyRunnerPatchToState(before, patch, page);
    });
    return applyInpaintingLayoutStates(page, states);
}
function applyRunnerPatchToState(before, patch, page) {
    const after = applyRunnerRenderPatch(structuredClone(before), patch, page);
    return applyRunnerBubblePatch(before, after, patch);
}
function applyRunnerRenderPatch(after, patch, page) {
    if (hasOwn(patch, "renderBbox")) {
        after.renderBbox = patch.renderBbox
            ? structuredClone(patch.renderBbox)
            : null;
        if (after.renderBbox === null) {
            after.renderBboxSpace = null;
        }
        else if (!hasOwn(patch, "renderBboxSpace")) {
            after.renderBboxSpace = after.renderBboxSpace ?? "normalized_1000";
        }
    }
    if (hasOwn(patch, "renderBboxSpace")) {
        after.renderBboxSpace = parseRenderBboxSpace(patch.renderBboxSpace);
    }
    if (after.renderBbox === null && after.renderBboxSpace !== null) {
        throw new Error("말풍선 배치 결과에 렌더링 영역 없이 좌표계만 지정되었습니다.");
    }
    assertRunnerRenderBbox(after, page);
    return after;
}
function parseRenderBboxSpace(value) {
    if (value === null) {
        return null;
    }
    if (value === "normalized_1000" || value === "pixels") {
        return value;
    }
    throw new Error("말풍선 배치 결과의 좌표계가 올바르지 않습니다.");
}
function applyRunnerBubblePatch(before, after, patch) {
    if (!hasOwn(patch, "bubbleLayout")) {
        return after;
    }
    if (patch.bubbleLayout === null && before.bubbleLayout === null) {
        throw new Error("기존 말풍선 배치가 없는 블록에는 초기화 결과를 적용할 수 없습니다.");
    }
    if (patch.bubbleLayout !== null &&
        !isUsableBubbleLayout(patch.bubbleLayout)) {
        throw new Error("말풍선 배치 결과의 영역 정보가 올바르지 않습니다.");
    }
    after.bubbleLayout =
        patch.bubbleLayout === null ? null : structuredClone(patch.bubbleLayout);
    return after;
}
function assertRunnerRenderBbox(state, page) {
    const bbox = state.renderBbox;
    if (!bbox) {
        return;
    }
    const limitX = state.renderBboxSpace === "pixels" ? page.width : 1000;
    const limitY = state.renderBboxSpace === "pixels" ? page.height : 1000;
    if (!isFinitePositiveBbox(bbox) || !isBboxInside(bbox, limitX, limitY)) {
        throw new Error("말풍선 배치 결과의 렌더링 영역이 올바르지 않습니다.");
    }
}
function isFinitePositiveBbox(bbox) {
    return ([bbox.x, bbox.y, bbox.w, bbox.h].every(Number.isFinite) &&
        bbox.w > 0 &&
        bbox.h > 0);
}
function isBboxInside(bbox, limitX, limitY) {
    return (bbox.x >= 0 &&
        bbox.y >= 0 &&
        bbox.x + bbox.w <= limitX &&
        bbox.y + bbox.h <= limitY);
}
function throwIfAborted(signal) {
    if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function resolveSettingsBubbleLayoutPaddingRatio(settings) {
    return resolveBubbleLayoutPaddingRatio(settings.inpainting?.bubbleLayoutPaddingRatio);
}
