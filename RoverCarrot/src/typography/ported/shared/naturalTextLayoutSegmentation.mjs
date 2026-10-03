// Ported from read-only fork fd461737. See source-map.json.
export const OPENING_PUNCTUATION = "([{<«“‘「『（［｛〈《【〔〖〘〚";
export const CLOSING_PUNCTUATION = ")]}>»”’,.!?:;」』）］｝〉》】〕〗〙〛、。，．！？：；…";
export const BREAK_AFTER_PUNCTUATION = "-‐‑‒–—―/";
let cachedSegmenterConstructor;
const cachedSegmenters = new Map();
export function segmentNaturalTextGraphemes(value) {
    const segmenter = resolveSegmenter(undefined, "grapheme");
    return segmenter
        ? Array.from(segmenter.segment(value), (entry) => entry.segment)
        : segmentGraphemesFallback(value);
}
export function segmentNaturalTextWords(value, locale) {
    return (trySegmentNaturalTextWords(value, locale) ?? segmentWordsFallback(value));
}
/**
 * Return native word boundaries when `Intl.Segmenter` is available. Callers
 * whose fallback policy is deliberately more conservative can distinguish an
 * unavailable segmenter from the eojeol fallback used by natural layout.
 */
export function trySegmentNaturalTextWords(value, locale) {
    const segmenter = resolveSegmenter(locale, "word");
    return segmenter
        ? Array.from(segmenter.segment(value), (entry) => ({
            segment: entry.segment,
            index: entry.index,
            isWordLike: Boolean(entry.isWordLike),
        }))
        : null;
}
export function segmentNaturalTextEojeols(value) {
    const entries = [];
    const pattern = /\s+|[^\s]+/gu;
    for (const match of value.matchAll(pattern)) {
        entries.push({
            segment: match[0],
            index: match.index,
            isWordLike: !/^\s+$/u.test(match[0]),
        });
    }
    return entries;
}
export function normalizeParagraphWhitespace(value) {
    return value.trim().replace(/\s+/gu, " ");
}
export function graphemeOffsets(graphemes) {
    const offsets = [0];
    let offset = 0;
    for (const grapheme of graphemes) {
        offset += grapheme.length;
        offsets.push(offset);
    }
    return offsets;
}
export function cjkRatio(graphemes) {
    const meaningful = graphemes.filter((value) => !isNaturalWhitespace(value) && !isNaturalPunctuation(value));
    if (meaningful.length === 0)
        return 0;
    return (meaningful.filter((value) => isCjkGrapheme(value)).length /
        meaningful.length);
}
export function isNaturalWhitespace(value) {
    return /^\s+$/u.test(value) || value === "\u200b";
}
export function isCjkGrapheme(value) {
    return /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u.test(value);
}
export function isHangulWord(value) {
    return (/\p{Script=Hangul}/u.test(value) &&
        /^[\p{Script=Hangul}\p{Number}]+$/u.test(value));
}
export function isKoreanNaturalText(value) {
    return /\p{Script=Hangul}/u.test(value);
}
export function hasKoreanWordPriority(value) {
    return (isKoreanNaturalText(value) &&
        segmentNaturalTextEojeols(value).filter((entry) => entry.isWordLike)
            .length >= 2);
}
export function isEmojiGrapheme(value) {
    return /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(value);
}
export function isNaturalPunctuation(value) {
    return (OPENING_PUNCTUATION.includes(value) ||
        CLOSING_PUNCTUATION.includes(value) ||
        BREAK_AFTER_PUNCTUATION.includes(value) ||
        /^\p{Punctuation}+$/u.test(value));
}
export function skipNaturalWhitespace(graphemes, start) {
    let index = start;
    while (index < graphemes.length && isNaturalWhitespace(graphemes[index])) {
        index += 1;
    }
    return index;
}
export function trimNaturalWhitespace(graphemes, end) {
    let index = end;
    while (index > 0 && isNaturalWhitespace(graphemes[index - 1])) {
        index -= 1;
    }
    return index;
}
/**
 * Counts graphemes carrying readable content rather than decoration.
 * Punctuation and brackets do not turn `고!`, `어,`, or `【아` into a
 * two-character line. Emoji clusters count as semantic content.
 */
export function countSemanticNaturalGraphemes(graphemes, start, end) {
    return graphemes.slice(start, end).filter(isSemanticNaturalGrapheme).length;
}
export function isSemanticNaturalGrapheme(value) {
    return /[\p{Letter}\p{Number}]/u.test(value) || isEmojiGrapheme(value);
}
export function isNaturalPunctuationSlice(graphemes, start, end) {
    const visible = graphemes
        .slice(start, end)
        .filter((value) => !isNaturalWhitespace(value));
    return visible.length > 0 && visible.every(isNaturalPunctuation);
}
function resolveSegmenter(locale, granularity) {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
        cachedSegmenterConstructor = undefined;
        cachedSegmenters.clear();
        return null;
    }
    const Segmenter = Intl.Segmenter;
    if (cachedSegmenterConstructor !== Segmenter) {
        cachedSegmenterConstructor = Segmenter;
        cachedSegmenters.clear();
    }
    const cacheKey = `${granularity}\u0000${locale ?? ""}`;
    const cached = cachedSegmenters.get(cacheKey);
    if (cached)
        return cached;
    let segmenter;
    try {
        segmenter = new Segmenter(locale, { granularity });
    }
    catch (error) {
        void error;
        segmenter = new Segmenter(undefined, { granularity });
    }
    cachedSegmenters.set(cacheKey, segmenter);
    return segmenter;
}
function segmentWordsFallback(value) {
    return segmentNaturalTextEojeols(value);
}
function segmentGraphemesFallback(value) {
    const clusters = [];
    for (const point of Array.from(value)) {
        const previous = clusters.at(-1);
        if (!previous || !shouldJoinPreviousCluster(previous, point)) {
            clusters.push(point);
        }
        else {
            clusters[clusters.length - 1] = previous + point;
        }
    }
    return clusters;
}
function shouldJoinPreviousCluster(previous, point) {
    if (isGraphemeExtend(point) || point === "\u200d")
        return true;
    if (previous.endsWith("\u200d"))
        return true;
    return isRegionalIndicator(point) && hasOddRegionalIndicatorCount(previous);
}
function isGraphemeExtend(value) {
    const codePoint = value.codePointAt(0) ?? 0;
    return (/\p{Mark}/u.test(value) ||
        (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
        (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
        (codePoint >= 0xe0020 && codePoint <= 0xe007f));
}
function isRegionalIndicator(value) {
    const codePoint = value.codePointAt(0) ?? 0;
    return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}
function hasOddRegionalIndicatorCount(value) {
    const points = Array.from(value);
    return (points.length > 0 &&
        points.every(isRegionalIndicator) &&
        points.length % 2 === 1);
}
