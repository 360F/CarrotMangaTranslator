// Ported from read-only fork fd461737. See source-map.json.
import { clampFontSizePx, MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX, } from "./blockFormatValues.mjs";
const MARKERS = ["***", "**", "*"];
const MAX_PARSE_DEPTH = 32;
const FONT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const MIN_WIDTH_SCALE = 0.1;
const MAX_WIDTH_SCALE = 5;
const MAX_INLINE_EFFECT_PX = 64;
export function parseRichText(input, baseBold = false, baseItalic = false, baseFontWeight) {
    const raw = typeof input === "string" ? input : String(input ?? "");
    const runs = [];
    parseSegment(raw, { bold: baseBold, italic: baseItalic }, 0, runs);
    const merged = mergeTextStyleRuns(runs);
    if (baseFontWeight !== undefined) {
        for (const run of merged) {
            if (run.bold === baseBold && !run.fontFamily) {
                run.fontWeight = baseFontWeight;
            }
        }
    }
    return {
        runs: merged,
        plainText: merged.map((run) => run.text).join(""),
    };
}
/** Convenience for callers that only need the formatting-free string. */
export function stripRichTextMarkup(input) {
    return parseRichText(input).plainText;
}
/** Serialize style runs back to the safe, deterministic project markup. */
export function serializeRichTextRuns(runs) {
    return mergeTextStyleRuns(runs)
        .map((run) => serializeRun(run))
        .join("");
}
/**
 * Apply a style to a plain-text selection. Offsets are UTF-16 offsets, matching
 * textarea/contenteditable selection APIs. Text outside the range is untouched.
 */
export function applyTextStyleToRuns(runs, selectionStart, selectionEnd, patch) {
    const textLength = runs.reduce((total, run) => total + run.text.length, 0);
    const start = clampIndex(selectionStart, textLength);
    const end = clampIndex(selectionEnd, textLength);
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (from === to)
        return mergeTextStyleRuns(runs);
    const result = [];
    let runStart = 0;
    for (const run of runs) {
        const runEnd = runStart + run.text.length;
        const overlapStart = Math.max(from, runStart);
        const overlapEnd = Math.min(to, runEnd);
        if (overlapStart >= overlapEnd) {
            result.push({ ...run });
            runStart = runEnd;
            continue;
        }
        const localStart = overlapStart - runStart;
        const localEnd = overlapEnd - runStart;
        if (localStart > 0) {
            result.push({ ...run, text: run.text.slice(0, localStart) });
        }
        result.push(applyStylePatch({ ...run, text: run.text.slice(localStart, localEnd) }, patch));
        if (localEnd < run.text.length) {
            result.push({ ...run, text: run.text.slice(localEnd) });
        }
        runStart = runEnd;
    }
    return mergeTextStyleRuns(result);
}
export function clearTextStylesFromRuns(runs, selectionStart = 0, selectionEnd = runs.reduce((total, run) => total + run.text.length, 0)) {
    return applyTextStyleToRuns(runs, selectionStart, selectionEnd, {
        bold: null,
        italic: null,
        underline: null,
        strikethrough: null,
        emphasisMark: null,
        sizePx: null,
        fontFamily: null,
        opacity: null,
        widthScale: null,
        color: null,
        backgroundColor: null,
        outlineColor: null,
        outlineWidthPx: null,
        outerOutlineColor: null,
        outerOutlineWidthPx: null,
        glowColor: null,
        glowBlurPx: null,
        glowOpacity: null,
    });
}
export function mergeTextStyleRuns(runs) {
    const merged = [];
    for (const candidate of runs) {
        if (!candidate.text)
            continue;
        const run = normalizeRun(candidate);
        const last = merged.at(-1);
        if (last && haveSameStyle(last, run)) {
            last.text += run.text;
        }
        else {
            merged.push(run);
        }
    }
    if (merged.length === 0) {
        return [{ text: "", bold: false, italic: false }];
    }
    return merged;
}
function parseSegment(input, style, depth, runs) {
    let buffer = "";
    let index = 0;
    const flush = () => {
        if (!buffer)
            return;
        runs.push({ text: buffer, ...style });
        buffer = "";
    };
    while (index < input.length) {
        const char = input[index];
        const escaped = readEscapedCharacter(input, index);
        if (escaped) {
            buffer += escaped.value;
            index = escaped.nextIndex;
            continue;
        }
        const styleSegment = char === "[" && depth < MAX_PARSE_DEPTH
            ? matchStyleSegment(input, index)
            : null;
        if (styleSegment) {
            flush();
            parseSegment(input.slice(styleSegment.opening.nextIndex, styleSegment.closeIndex), applyContextPatch(style, styleSegment.opening.patch), depth + 1, runs);
            index =
                styleSegment.closeIndex +
                    closingStyleTag(styleSegment.opening.name).length;
            continue;
        }
        if (char === "*" && depth < MAX_PARSE_DEPTH) {
            const match = matchMarker(input, index);
            if (match) {
                flush();
                parseSegment(match.inner, {
                    ...style,
                    bold: style.bold || match.bold,
                    italic: style.italic || match.italic,
                }, depth + 1, runs);
                index = match.nextIndex;
                continue;
            }
        }
        buffer += char;
        index += 1;
    }
    flush();
}
function matchStyleSegment(input, start) {
    const opening = matchStyleOpeningTag(input, start);
    if (!opening)
        return null;
    const closeIndex = findClosingStyleTag(input, opening.nextIndex, opening.name);
    return closeIndex < 0 ? null : { opening, closeIndex };
}
function matchStyleOpeningTag(input, start) {
    const end = input.indexOf("]", start + 1);
    if (end < 0 || end - start > 140)
        return null;
    const body = input.slice(start + 1, end);
    const nextIndex = end + 1;
    const booleanName = body;
    const booleanPatch = BOOLEAN_STYLE_TAG_PATCHES[booleanName];
    if (booleanPatch) {
        return { name: booleanName, nextIndex, patch: booleanPatch };
    }
    const equals = body.indexOf("=");
    if (equals <= 0)
        return null;
    const name = body.slice(0, equals);
    const rawValue = body.slice(equals + 1).trim();
    return matchValuedStyleOpeningTag(name, rawValue, nextIndex);
}
const BOOLEAN_STYLE_TAG_PATCHES = {
    underline: { underline: true },
    strike: { strikethrough: true },
    emphasis: { emphasisMark: true },
};
function matchValuedStyleOpeningTag(name, rawValue, nextIndex) {
    if (name === "size")
        return matchSizeTag(rawValue, nextIndex);
    if (name === "font")
        return matchFontTag(rawValue, nextIndex);
    if (name === "opacity")
        return matchOpacityTag(rawValue, nextIndex);
    if (name === "width")
        return matchWidthTag(rawValue, nextIndex);
    const colorPatchKey = COLOR_TAG_PATCH_KEYS[name];
    if (colorPatchKey)
        return matchColorTag(name, colorPatchKey, rawValue, nextIndex);
    const numberDefinition = NUMBER_TAG_DEFINITIONS[name];
    return numberDefinition
        ? matchNumberTag(name, numberDefinition, rawValue, nextIndex)
        : null;
}
function matchSizeTag(rawValue, nextIndex) {
    const value = Number(rawValue);
    if (!isNumberInRange(value, MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX))
        return null;
    return { name: "size", nextIndex, patch: { sizePx: clampFontSizePx(value) } };
}
function matchFontTag(rawValue, nextIndex) {
    return FONT_ID_PATTERN.test(rawValue)
        ? { name: "font", nextIndex, patch: { fontFamily: rawValue } }
        : null;
}
function matchOpacityTag(rawValue, nextIndex) {
    const percent = Number(rawValue);
    if (!isNumberInRange(percent, 0, 100))
        return null;
    return {
        name: "opacity",
        nextIndex,
        patch: { opacity: normalizeOpacity(percent / 100) },
    };
}
function matchWidthTag(rawValue, nextIndex) {
    const value = Number(rawValue);
    if (!isNumberInRange(value, MIN_WIDTH_SCALE, MAX_WIDTH_SCALE))
        return null;
    return {
        name: "width",
        nextIndex,
        patch: { widthScale: normalizeNumber(value) },
    };
}
function matchColorTag(name, key, rawValue, nextIndex) {
    if (!HEX_COLOR_PATTERN.test(rawValue))
        return null;
    return {
        name,
        nextIndex,
        patch: { [key]: rawValue.toLowerCase() },
    };
}
function matchNumberTag(name, definition, rawValue, nextIndex) {
    const value = Number(rawValue);
    if (!isNumberInRange(value, definition.min, definition.max))
        return null;
    return {
        name,
        nextIndex,
        patch: { [definition.key]: normalizeNumber(value) },
    };
}
const COLOR_TAG_PATCH_KEYS = {
    color: "color",
    background: "backgroundColor",
    "outline-color": "outlineColor",
    "outer-outline-color": "outerOutlineColor",
    "glow-color": "glowColor",
};
const NUMBER_TAG_DEFINITIONS = {
    "outline-width": {
        key: "outlineWidthPx",
        min: 0,
        max: MAX_INLINE_EFFECT_PX,
    },
    "outer-outline-width": {
        key: "outerOutlineWidthPx",
        min: 0,
        max: MAX_INLINE_EFFECT_PX,
    },
    "glow-blur": {
        key: "glowBlurPx",
        min: 0,
        max: MAX_INLINE_EFFECT_PX,
    },
    "glow-opacity": { key: "glowOpacity", min: 0, max: 1 },
};
function findClosingStyleTag(input, from, name) {
    const closing = closingStyleTag(name);
    let nesting = 0;
    let index = from;
    while (index < input.length) {
        const escaped = readEscapedCharacter(input, index);
        if (escaped) {
            index = escaped.nextIndex;
            continue;
        }
        if (input.startsWith(closing, index)) {
            if (nesting === 0)
                return index;
            nesting -= 1;
            index += closing.length;
            continue;
        }
        if (input[index] === "[") {
            const opening = matchStyleOpeningTag(input, index);
            if (opening?.name === name) {
                nesting += 1;
                index = opening.nextIndex;
                continue;
            }
        }
        index += 1;
    }
    return -1;
}
function closingStyleTag(name) {
    return `[/${name}]`;
}
function matchMarker(input, start) {
    for (const marker of MARKERS) {
        if (!input.startsWith(marker, start))
            continue;
        const innerStart = start + marker.length;
        const closeIndex = findClosingMarker(input, innerStart, marker);
        if (closeIndex < 0)
            continue;
        const inner = input.slice(innerStart, closeIndex);
        if (!inner)
            continue;
        return {
            inner,
            bold: marker.length >= 2,
            italic: marker.length === 1 || marker.length === 3,
            nextIndex: closeIndex + marker.length,
        };
    }
    return null;
}
function findClosingMarker(input, from, marker) {
    let index = from;
    while (index < input.length) {
        const escaped = readEscapedCharacter(input, index);
        if (escaped) {
            index = escaped.nextIndex;
            continue;
        }
        if (input.startsWith(marker, index))
            return index;
        index += 1;
    }
    return -1;
}
function readEscapedCharacter(input, index) {
    if (input[index] !== "\\")
        return null;
    const next = input[index + 1];
    if (next !== "\\" && next !== "*" && next !== "[")
        return null;
    return { value: next, nextIndex: index + 2 };
}
function serializeRun(run) {
    let content = wrapTextEmphasis(escapeRichText(run.text), run);
    for (const [name, enabled] of booleanStyleTags(run)) {
        if (enabled)
            content = wrapStyleTag(content, name);
    }
    for (const [name, value] of valuedStyleTags(run)) {
        content = wrapOptionalStyleTag(content, name, value);
    }
    return content;
}
function wrapTextEmphasis(content, run) {
    if (run.bold && run.italic)
        return `***${content}***`;
    if (run.bold)
        return `**${content}**`;
    if (run.italic)
        return `*${content}*`;
    return content;
}
function booleanStyleTags(run) {
    return [
        ["underline", run.underline],
        ["strike", run.strikethrough],
        ["emphasis", run.emphasisMark],
    ];
}
function valuedStyleTags(run) {
    return [
        ["glow-opacity", run.glowOpacity],
        ["glow-blur", run.glowBlurPx],
        ["glow-color", run.glowColor],
        ["outer-outline-width", run.outerOutlineWidthPx],
        ["outer-outline-color", run.outerOutlineColor],
        ["outline-width", run.outlineWidthPx],
        ["outline-color", run.outlineColor],
        ["background", run.backgroundColor],
        ["color", run.color],
        [
            "width",
            run.widthScale === undefined
                ? undefined
                : clampNumber(run.widthScale, MIN_WIDTH_SCALE, MAX_WIDTH_SCALE),
        ],
        [
            "opacity",
            run.opacity === undefined
                ? undefined
                : normalizeOpacity(run.opacity) * 100,
        ],
        [
            "size",
            run.sizePx === undefined ? undefined : clampFontSizePx(run.sizePx),
        ],
        [
            "font",
            run.fontFamily && FONT_ID_PATTERN.test(run.fontFamily)
                ? run.fontFamily
                : undefined,
        ],
    ];
}
function wrapStyleTag(content, name) {
    return `[${name}]${content}[/${name}]`;
}
function wrapOptionalStyleTag(content, name, value) {
    if (typeof value === "string") {
        const isColor = COLOR_STYLE_TAGS.has(name);
        if (isColor && !HEX_COLOR_PATTERN.test(value))
            return content;
        const serialized = isColor ? value.toLowerCase() : value;
        return `[${name}=${serialized}]${content}[/${name}]`;
    }
    if (value !== undefined && Number.isFinite(value)) {
        return `[${name}=${formatNumber(value)}]${content}[/${name}]`;
    }
    return content;
}
const COLOR_STYLE_TAGS = new Set([
    "color",
    "background",
    "outline-color",
    "outer-outline-color",
    "glow-color",
]);
function escapeRichText(value) {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/\*/g, "\\*")
        .replace(/\[/g, "\\[");
}
function applyStylePatch(run, patch) {
    const next = { ...run };
    applyOptionalPatch(next, "bold", patch.bold);
    applyOptionalPatch(next, "italic", patch.italic);
    applyOptionalPatch(next, "underline", patch.underline);
    applyOptionalPatch(next, "strikethrough", patch.strikethrough);
    applyOptionalPatch(next, "emphasisMark", patch.emphasisMark);
    applyOptionalPatch(next, "sizePx", patch.sizePx);
    applyOptionalPatch(next, "fontFamily", patch.fontFamily);
    applyOptionalPatch(next, "opacity", patch.opacity);
    applyOptionalPatch(next, "widthScale", patch.widthScale);
    applyOptionalPatch(next, "color", patch.color);
    applyOptionalPatch(next, "backgroundColor", patch.backgroundColor);
    applyOptionalPatch(next, "outlineColor", patch.outlineColor);
    applyOptionalPatch(next, "outlineWidthPx", patch.outlineWidthPx);
    applyOptionalPatch(next, "outerOutlineColor", patch.outerOutlineColor);
    applyOptionalPatch(next, "outerOutlineWidthPx", patch.outerOutlineWidthPx);
    applyOptionalPatch(next, "glowColor", patch.glowColor);
    applyOptionalPatch(next, "glowBlurPx", patch.glowBlurPx);
    applyOptionalPatch(next, "glowOpacity", patch.glowOpacity);
    return normalizeRun(next);
}
function applyContextPatch(style, patch) {
    const { text: _text, ...next } = applyStylePatch({ text: "", ...style }, patch);
    void _text;
    return next;
}
function applyOptionalPatch(target, key, value) {
    if (value === undefined)
        return;
    if (value === null) {
        if (key === "bold" ||
            key === "italic" ||
            key === "underline" ||
            key === "strikethrough" ||
            key === "emphasisMark") {
            Object.assign(target, { [key]: false });
        }
        else {
            delete target[key];
        }
        return;
    }
    // The generic key/value relationship is safe here but TS cannot preserve it
    // through an indexed assignment over optional heterogeneous properties.
    Object.assign(target, { [key]: value });
}
function normalizeRun(run) {
    const next = {
        text: run.text,
        bold: Boolean(run.bold),
        italic: Boolean(run.italic),
    };
    copyEnabledStyles(run, next);
    copyNormalizedCoreValues(run, next);
    copyColor(run, next, "color");
    copyColor(run, next, "backgroundColor");
    copyColor(run, next, "outlineColor");
    copyColor(run, next, "outerOutlineColor");
    copyColor(run, next, "glowColor");
    copyNumber(run, next, "outlineWidthPx", 0, MAX_INLINE_EFFECT_PX);
    copyNumber(run, next, "outerOutlineWidthPx", 0, MAX_INLINE_EFFECT_PX);
    copyNumber(run, next, "glowBlurPx", 0, MAX_INLINE_EFFECT_PX);
    copyNumber(run, next, "glowOpacity", 0, 1);
    return next;
}
function copyEnabledStyles(source, target) {
    const keys = ["underline", "strikethrough", "emphasisMark"];
    for (const key of keys) {
        if (source[key])
            Object.assign(target, { [key]: true });
    }
}
function copyNormalizedCoreValues(source, target) {
    if (source.sizePx !== undefined && Number.isFinite(source.sizePx)) {
        target.sizePx = clampFontSizePx(source.sizePx);
    }
    if (source.fontFamily && FONT_ID_PATTERN.test(source.fontFamily)) {
        target.fontFamily = source.fontFamily;
    }
    if (source.opacity !== undefined && Number.isFinite(source.opacity)) {
        target.opacity = normalizeOpacity(source.opacity);
    }
    if (source.widthScale !== undefined && Number.isFinite(source.widthScale)) {
        target.widthScale = clampNumber(source.widthScale, MIN_WIDTH_SCALE, MAX_WIDTH_SCALE);
    }
}
function haveSameStyle(left, right) {
    return STYLE_COMPARISON_FIELDS.every((key) => left[key] === right[key]);
}
const STYLE_COMPARISON_FIELDS = [
    "bold",
    "italic",
    "underline",
    "strikethrough",
    "emphasisMark",
    "sizePx",
    "fontFamily",
    "opacity",
    "widthScale",
    "color",
    "backgroundColor",
    "outlineColor",
    "outlineWidthPx",
    "outerOutlineColor",
    "outerOutlineWidthPx",
    "glowColor",
    "glowBlurPx",
    "glowOpacity",
];
function copyColor(source, target, key) {
    const value = source[key];
    if (value && HEX_COLOR_PATTERN.test(value)) {
        Object.assign(target, { [key]: value.toLowerCase() });
    }
}
function copyNumber(source, target, key, minimum, maximum) {
    const value = source[key];
    if (value !== undefined && Number.isFinite(value)) {
        Object.assign(target, { [key]: clampNumber(value, minimum, maximum) });
    }
}
function isNumberInRange(value, minimum, maximum) {
    return Number.isFinite(value) && value >= minimum && value <= maximum;
}
function normalizeNumber(value) {
    return Number(value.toFixed(3));
}
function clampNumber(value, minimum, maximum) {
    return normalizeNumber(Math.max(minimum, Math.min(maximum, value)));
}
function normalizeOpacity(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
function formatNumber(value) {
    return String(Number(value.toFixed(3)));
}
function clampIndex(index, length) {
    if (!Number.isFinite(index))
        return length;
    return Math.min(length, Math.max(0, Math.trunc(index)));
}
