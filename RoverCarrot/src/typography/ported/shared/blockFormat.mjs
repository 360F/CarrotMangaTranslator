// Ported from read-only fork fd461737. See source-map.json.
import { DEFAULT_TEXT_WORD_BREAK, resolveBlockTextWordBreak, } from "./textWrapping.mjs";
/**
 * Every field edited by the block-format UI. Consumers that relay format
 * patches (multi-selection, detached panels, presets) must use this list
 * instead of maintaining a smaller parallel allowlist.
 */
export const BLOCK_FORMAT_FIELD_KEYS = [
    "fontFamily",
    "fontSizePx",
    "autoFitText",
    "fontSizeIntent",
    "textAlign",
    "wordBreak",
    "renderDirection",
    "bold",
    "fontWeight",
    "italic",
    "underline",
    "strikethrough",
    "emphasisMark",
    "lineHeight",
    "letterSpacing",
    "fontWidthScale",
    "textColor",
    "textBackgroundEnabled",
    "textBackgroundColor",
    "outlineColor",
    "outlineWidthPx",
    "outlineWidthScale",
    "outerOutlineColor",
    "outerOutlineWidthPx",
    "textEffect",
    "textGlow",
    "rotationDeg",
    "textOpacity",
];
export const BLOCK_FORMAT_GROUPS = [
    { id: "font", label: "글꼴", keys: ["fontFamily"] },
    {
        id: "size",
        label: "글자 크기",
        keys: ["fontSizePx", "autoFitText", "fontSizeIntent"],
    },
    { id: "align", label: "정렬", keys: ["textAlign"] },
    { id: "wordBreak", label: "줄바꿈", keys: ["wordBreak"] },
    { id: "direction", label: "가로/세로", keys: ["renderDirection"] },
    {
        id: "emphasis",
        label: "강조",
        keys: [
            "bold",
            "fontWeight",
            "italic",
            "underline",
            "strikethrough",
            "emphasisMark",
        ],
    },
    { id: "lineSpacing", label: "줄 간격", keys: ["lineHeight"] },
    { id: "letterSpacing", label: "자간", keys: ["letterSpacing"] },
    { id: "fontWidth", label: "장평", keys: ["fontWidthScale"] },
    {
        id: "color",
        label: "글자·배경색",
        keys: ["textColor", "textBackgroundEnabled", "textBackgroundColor"],
    },
    {
        id: "outline",
        label: "외곽선",
        keys: [
            "outlineColor",
            "outlineWidthPx",
            "outlineWidthScale",
            "outerOutlineColor",
            "outerOutlineWidthPx",
        ],
    },
    { id: "effect", label: "그림자·광선", keys: ["textEffect", "textGlow"] },
    {
        id: "transform",
        label: "기울기·글자 투명도",
        keys: ["rotationDeg", "textOpacity"],
    },
];
export const ALL_BLOCK_FORMAT_GROUP_IDS = BLOCK_FORMAT_GROUPS.map((group) => group.id);
/** Copy only the formatting keys belonging to the selected groups. */
export function pickBlockFormat(block, groupIds) {
    const selected = new Set(groupIds);
    const patch = {};
    for (const group of BLOCK_FORMAT_GROUPS) {
        if (!selected.has(group.id)) {
            continue;
        }
        for (const key of group.keys) {
            patch[key] =
                key === "wordBreak"
                    ? resolveBlockTextWordBreak(block.wordBreak, block.renderDirection)
                    : block[key];
        }
    }
    return patch;
}
/** Mirrors the previous hardcoded block-creation defaults in overlayItems.ts. */
export const DEFAULT_BLOCK_FORMAT_DEFAULTS = {
    renderDirection: "auto",
    textAlign: "center",
    wordBreak: DEFAULT_TEXT_WORD_BREAK,
    autoFitText: true,
    fontSizePx: 24,
    lineHeight: 1.18,
    letterSpacing: 0,
    fontWidthScale: 1,
    textColor: "#111111",
    textOpacity: 1,
    outlineEnabled: true,
    outlineColor: "#ffffff",
    outlineWidthScale: 1,
    bold: false,
    italic: false,
};
/**
 * Apply user default formatting onto a freshly created block. Position, text,
 * confidence, and (for "auto" direction) the pipeline-detected direction and
 * auto-fit size are preserved.
 */
export function applyFormatDefaultsToBlock(block, defaults) {
    if (!defaults) {
        return block;
    }
    const next = {
        ...block,
        textAlign: defaults.textAlign,
        wordBreak: defaults.wordBreak,
        lineHeight: defaults.lineHeight,
        letterSpacing: defaults.letterSpacing,
        fontWidthScale: defaults.fontWidthScale,
        textColor: defaults.textColor,
        textOpacity: defaults.textOpacity,
        bold: defaults.bold,
        italic: defaults.italic,
        autoFitText: defaults.autoFitText,
    };
    // Font family: undefined means "use the app's default font".
    delete next.fontWeight;
    if (defaults.fontFamily) {
        next.fontFamily = defaults.fontFamily;
    }
    else {
        delete next.fontFamily;
    }
    // Manual size only overrides the auto-fit estimate when auto-fit is off.
    if (!defaults.autoFitText) {
        next.fontSizePx = defaults.fontSizePx;
    }
    if (defaults.outlineEnabled) {
        next.outlineColor = defaults.outlineColor;
        if (defaults.outlineWidthPx !== undefined) {
            next.outlineWidthPx = defaults.outlineWidthPx;
        }
        else {
            delete next.outlineWidthPx;
            next.outlineWidthScale = defaults.outlineWidthScale;
        }
    }
    else {
        delete next.outlineColor;
        next.outlineWidthPx = 0;
    }
    // "auto" keeps the detected direction; otherwise force the chosen direction.
    if (defaults.renderDirection !== "auto") {
        next.renderDirection = defaults.renderDirection;
        delete next.layoutIntent;
        next.layoutIntentSuppressed = true;
    }
    return next;
}
