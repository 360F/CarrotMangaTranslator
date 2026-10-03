// Ported from read-only fork fd461737. See source-map.json.
export const TEXT_WORD_BREAK_VALUES = [
    "normal",
    "break-word",
    "break-all",
    "keep-all",
    "keep-all-overflow",
];
/** Matches the text overflow behavior used before wrapping became configurable. */
export const DEFAULT_TEXT_WORD_BREAK = "break-word";
const TEXT_WORD_BREAK_VALUE_SET = new Set(TEXT_WORD_BREAK_VALUES);
export function resolveTextWordBreak(value, fallback = DEFAULT_TEXT_WORD_BREAK) {
    if (typeof value === "string" && TEXT_WORD_BREAK_VALUE_SET.has(value)) {
        return value;
    }
    return TEXT_WORD_BREAK_VALUE_SET.has(fallback)
        ? fallback
        : DEFAULT_TEXT_WORD_BREAK;
}
/**
 * Blocks saved before v1.6.5 have no wordBreak field. Horizontal text used
 * eager character wrapping, while vertical text used break-word/anywhere CSS.
 */
export function resolveBlockTextWordBreak(value, renderDirection) {
    if (typeof value === "string" && TEXT_WORD_BREAK_VALUE_SET.has(value)) {
        return value;
    }
    return renderDirection === "vertical" ? "break-word" : "break-all";
}
export function allowsLongTokenFallback(wordBreak) {
    return wordBreak === "break-word" || wordBreak === "keep-all-overflow";
}
export function keepsWordsTogether(wordBreak) {
    return wordBreak === "keep-all" || wordBreak === "keep-all-overflow";
}
export function resolveCssTextWordBreak(wordBreak) {
    return wordBreak === "keep-all-overflow" ? "keep-all" : wordBreak;
}
