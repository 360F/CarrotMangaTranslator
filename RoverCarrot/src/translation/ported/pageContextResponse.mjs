// Ported from src/main/pipeline/pageContextResponse.ts, reference fd461737. Runtime independent of Carrot.
const OPEN_TAG_PATTERN = /<page-context\b[^>]*>/i;
const CLOSE_TAG_PATTERN = /<\/page-context\s*>/i;
const GLOSSARY_CATEGORIES = new Set([
    "character",
    "alias",
    "place",
    "term",
    "honorific",
    "other",
]);
const SPEECH_STYLES = new Set([
    "neutral",
    "polite",
    "casual",
    "rough",
    "childish",
    "elderly",
    "formal",
    "custom",
]);
/**
 * Removes the optional context trailer before the legacy overlay parser sees
 * the response. An unterminated trailer is assumed to run to EOF because the
 * contract always places it after overlay records.
 */
export function extractPageContextResponse(rawText) {
    const structured = extractStructuredPageContext(rawText);
    if (structured) {
        return structured;
    }
    const openMatch = OPEN_TAG_PATTERN.exec(rawText);
    if (!openMatch || openMatch.index === undefined) {
        return {
            overlayText: rawText.replace(CLOSE_TAG_PATTERN, ""),
            status: "missing",
        };
    }
    const contentStart = openMatch.index + openMatch[0].length;
    const afterOpen = rawText.slice(contentStart);
    const closeMatch = CLOSE_TAG_PATTERN.exec(afterOpen);
    const contentEnd = closeMatch?.index ?? afterOpen.length;
    const suffix = closeMatch
        ? afterOpen.slice(contentEnd + closeMatch[0].length)
        : "";
    const overlayText = `${rawText.slice(0, openMatch.index)}${suffix}`.trim();
    const parsed = parsePageContextJson(afterOpen.slice(0, contentEnd));
    return parsed
        ? { overlayText, pageContext: parsed, status: "parsed" }
        : { overlayText, status: "invalid" };
}
function extractStructuredPageContext(rawText) {
    const candidate = rawText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    if (!candidate.startsWith("{")) {
        return null;
    }
    try {
        const parsed = JSON.parse(candidate);
        if (!isRecord(parsed) || !("pageContext" in parsed)) {
            return null;
        }
        const pageContext = buildPageContextPayload(parsed.pageContext);
        return pageContext
            ? { overlayText: candidate, pageContext, status: "parsed" }
            : { overlayText: candidate, status: "invalid" };
    }
    catch {
        // error-policy-allow: the legacy/lenient overlay parser handles malformed JSON.
        return null;
    }
}
function parsePageContextJson(rawJson) {
    const candidate = rawJson
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    if (!candidate) {
        return null;
    }
    try {
        return buildPageContextPayload(JSON.parse(candidate));
    }
    catch {
        // error-policy-allow: optional page-context JSON never invalidates a valid translation.
        return null;
    }
}
function buildPageContextPayload(raw) {
    if (!isRecord(raw) || !isOptionalString(raw.visualSummary)) {
        return null;
    }
    const glossary = readCandidateArray(raw, "glossary", "glossaryCandidates");
    const characters = readCandidateArray(raw, "characters", "characterCandidates");
    if (!glossary || !characters) {
        return null;
    }
    return {
        visualSummary: cleanText(raw.visualSummary, 1200) || undefined,
        glossary: readGlossaryCandidates(glossary),
        characters: readCharacterCandidates(characters),
    };
}
function readCandidateArray(raw, key, legacyKey) {
    const value = raw[key] ?? raw[legacyKey] ?? [];
    return Array.isArray(value) ? value : null;
}
function isOptionalString(value) {
    return value == null || typeof value === "string";
}
function readGlossaryCandidates(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const candidates = [];
    for (const item of value.slice(0, 100)) {
        if (!isRecord(item)) {
            continue;
        }
        const source = cleanText(item.source, 400);
        if (!source) {
            continue;
        }
        const rawCategory = cleanText(item.category, 40);
        const category = GLOSSARY_CATEGORIES.has(rawCategory)
            ? rawCategory
            : "term";
        candidates.push({
            source,
            target: cleanText(item.target, 400),
            category,
            aliases: readTextList(item.aliases, 50, 200),
            note: cleanText(item.note, 2000) || undefined,
        });
    }
    return candidates;
}
function readCharacterCandidates(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const candidates = [];
    for (const item of value.slice(0, 100)) {
        if (!isRecord(item)) {
            continue;
        }
        const sourceNames = readTextList(item.sourceNames, 50, 200);
        const targetName = cleanText(item.targetName, 200);
        const displayName = cleanText(item.displayName, 200) || targetName || sourceNames[0] || "";
        if (!displayName) {
            continue;
        }
        const rawSpeechStyle = cleanText(item.speechStyle, 40);
        const speechStyle = SPEECH_STYLES.has(rawSpeechStyle)
            ? rawSpeechStyle
            : undefined;
        candidates.push({
            displayName,
            sourceNames,
            targetName: targetName || displayName,
            aliases: readTextList(item.aliases, 50, 200),
            speechStyle,
            customSpeechStyle: cleanText(item.customSpeechStyle, 1000) || undefined,
            note: cleanText(item.note, 2000) || undefined,
        });
    }
    return candidates;
}
function readTextList(value, maxItems, maxChars) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [
        ...new Set(value
            .slice(0, maxItems)
            .map((item) => cleanText(item, maxChars))
            .filter(Boolean)),
    ];
}
function cleanText(value, maxChars) {
    if (typeof value !== "string")
        return "";
    return value
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxChars);
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
