// Ported from src/shared/workContextBudget.ts, reference fd461737. Runtime independent of Carrot.
const WORK_CONTEXT_MIN_OUTPUT_HEADROOM_TOKENS = 2048;
export const WORK_CONTEXT_RECENT_PAGE_COUNT = 6;
const TRANSLATION_PROMPT_BASE_INPUT_TOKENS = 6400;
const CHARS_PER_TOKEN_ESTIMATE = 2;
const PROMPT_GLOSSARY_LIMIT = 80;
const PROMPT_CHARACTER_LIMIT = 40;
export function buildWorkContextBudgetPreview({ ctx, maxTokens, recentPageCount = WORK_CONTEXT_RECENT_PAGE_COUNT, storyMemory, styleGuide, }) {
    return planWorkContextBudget({
        styleGuide,
        storyMemory: {
            ...storyMemory,
            pages: selectRecentStoryPages(storyMemory.pages, recentPageCount),
        },
        recentPageCount,
    }, { ctx, maxTokens });
}
export function prunePromptWorkContextForBudget(workContext, options) {
    const budget = planWorkContextBudget(workContext, options);
    if (budget.omittedParts.length === 0) {
        return { workContext, budget };
    }
    let nextContext = workContext;
    for (const part of budget.omittedParts) {
        nextContext = omitWorkContextPart(nextContext, part);
    }
    return { workContext: nextContext, budget };
}
function planWorkContextBudget(workContext, { baseInputTokens = TRANSLATION_PROMPT_BASE_INPUT_TOKENS, ctx, maxTokens, minOutputHeadroomTokens = WORK_CONTEXT_MIN_OUTPUT_HEADROOM_TOKENS, }) {
    const normalizedOptions = {
        baseInputTokens: normalizeNonNegativeInteger(baseInputTokens),
        ctx: normalizeNonNegativeInteger(ctx),
        maxTokens: normalizeNonNegativeInteger(maxTokens),
        minOutputHeadroomTokens: normalizeNonNegativeInteger(minOutputHeadroomTokens),
    };
    const original = buildBudgetSnapshot(workContext, normalizedOptions);
    let currentContext = workContext;
    let effective = original;
    const omittedParts = [];
    for (const part of [
        "storyMemory",
        "glossary",
        "characters",
    ]) {
        if (effective.outputHeadroomTokens >=
            normalizedOptions.minOutputHeadroomTokens) {
            break;
        }
        if (!hasWorkContextPart(currentContext, part)) {
            continue;
        }
        currentContext = omitWorkContextPart(currentContext, part);
        omittedParts.push(part);
        effective = buildBudgetSnapshot(currentContext, normalizedOptions);
    }
    return {
        original,
        effective,
        omittedParts,
        minOutputHeadroomTokens: normalizedOptions.minOutputHeadroomTokens,
        baseInputTokens: normalizedOptions.baseInputTokens,
        ctx: normalizedOptions.ctx,
        maxTokens: normalizedOptions.maxTokens,
    };
}
function estimateWorkContextTokenBreakdown(workContext) {
    const guide = workContext.styleGuide;
    const glossary = selectPromptGlossary(guide);
    const characters = selectPromptCharacters(guide);
    const storyPages = selectRecentStoryPages(workContext.storyMemory?.pages ?? [], workContext.recentPageCount);
    const glossaryTokens = glossary.length > 0
        ? estimatePromptTokens([
            "Use these glossary entries for consistency. If the source text matches an entry or alias, prefer the target Korean exactly unless Image 1 clearly proves a different meaning.",
            ...glossary.map(formatGlossaryEntryForBudget),
        ].join("\n"))
        : 0;
    const characterTokens = characters.length > 0
        ? estimatePromptTokens([
            "Character/name memory. Keep names and speech style consistent when translating dialogue.",
            ...characters.map(formatCharacterForBudget),
        ].join("\n"))
        : 0;
    const storyMemoryTokens = storyPages.length > 0
        ? estimatePromptTokens([
            "Recent story context from previous pages. Use it only to resolve pronouns, omitted subjects, relationships, tone, and continuity. Do not output these notes as records.",
            ...storyPages.map(formatStoryPageForBudget),
        ].join("\n"))
        : 0;
    const rulesTokens = estimatePromptTokens([
        "Work glossary and story memory",
        "Do not output these notes as records.",
        formatRulesForBudget(guide),
    ].join("\n"));
    return {
        glossaryTokens,
        characterTokens,
        storyMemoryTokens,
        rulesTokens,
        totalTokens: glossaryTokens + characterTokens + storyMemoryTokens + rulesTokens,
        glossaryCount: glossary.length,
        characterCount: characters.length,
        storyPageCount: storyPages.length,
    };
}
function buildBudgetSnapshot(workContext, options) {
    const breakdown = estimateWorkContextTokenBreakdown(workContext);
    const outputHeadroomTokens = Math.max(0, options.ctx - options.baseInputTokens - breakdown.totalTokens);
    const outputHeadroomPercent = options.maxTokens > 0
        ? Math.max(0, Math.min(100, Math.floor((Math.min(outputHeadroomTokens, options.maxTokens) /
            options.maxTokens) *
            100)))
        : 0;
    return {
        ...breakdown,
        outputHeadroomTokens,
        outputHeadroomPercent,
    };
}
function hasWorkContextPart(workContext, part) {
    if (part === "storyMemory") {
        return (workContext.storyMemory?.pages ?? []).length > 0;
    }
    if (part === "glossary") {
        return selectPromptGlossary(workContext.styleGuide).length > 0;
    }
    return selectPromptCharacters(workContext.styleGuide).length > 0;
}
function omitWorkContextPart(workContext, part) {
    if (part === "storyMemory") {
        return {
            ...workContext,
            storyMemory: {
                ...workContext.storyMemory,
                pages: [],
            },
        };
    }
    if (part === "glossary") {
        return {
            ...workContext,
            styleGuide: {
                ...workContext.styleGuide,
                glossary: [],
            },
        };
    }
    return {
        ...workContext,
        styleGuide: {
            ...workContext.styleGuide,
            characters: [],
        },
    };
}
function selectPromptGlossary(guide) {
    return Array.isArray(guide.glossary)
        ? guide.glossary
            .filter((entry) => entry && entry.enabled !== false && entry.source)
            .slice(0, PROMPT_GLOSSARY_LIMIT)
        : [];
}
function selectPromptCharacters(guide) {
    return Array.isArray(guide.characters)
        ? guide.characters
            .filter((character) => character &&
            character.enabled !== false &&
            (character.displayName ||
                character.targetName ||
                character.sourceNames.length > 0))
            .slice(0, PROMPT_CHARACTER_LIMIT)
        : [];
}
function selectRecentStoryPages(pages, recentPageCount = WORK_CONTEXT_RECENT_PAGE_COUNT) {
    return pages
        .filter((page) => page && Number.isFinite(page.pageIndex))
        .slice()
        .sort((left, right) => left.pageIndex - right.pageIndex)
        .slice(-Math.max(0, recentPageCount));
}
function formatGlossaryEntryForBudget(entry) {
    const aliases = Array.isArray(entry.aliases) && entry.aliases.length
        ? ` aliases=${entry.aliases.map((value) => sanitizePromptLine(value, 80)).join(", ")}`
        : "";
    const note = entry.note ? ` note=${sanitizePromptLine(entry.note, 160)}` : "";
    return `- [${entry.category || "term"}] ${sanitizePromptLine(entry.source, 80)} => ${sanitizePromptLine(entry.target, 80)}${aliases}${note}`;
}
function formatCharacterForBudget(character) {
    const sourceNames = Array.isArray(character.sourceNames)
        ? character.sourceNames.join(", ")
        : "";
    const style = character.speechStyle === "custom"
        ? character.customSpeechStyle || "custom"
        : character.speechStyle || "neutral";
    return `- ${sanitizePromptLine(character.displayName || character.targetName, 80)}: sourceNames=${sanitizePromptLine(sourceNames, 160)} targetName=${sanitizePromptLine(character.targetName, 80)} speechStyle=${sanitizePromptLine(style, 160)}`;
}
function formatStoryPageForBudget(page) {
    const pageNumber = Number(page.pageIndex);
    const pageLabel = pageNumber >= 0 ? `p${pageNumber + 1} ` : "";
    return `- ${pageLabel}${sanitizePromptLine(page.pageName)}: ${sanitizePromptLine(page.visualSummary || page.summary || page.translatedDigest || "")}`;
}
function formatRulesForBudget(guide) {
    const rules = guide.rules || {};
    return `Rules: honorifics=${rules.honorifics || "adapt"}, sfxMode=${rules.sfxMode || "translate"}, defaultTone=${rules.defaultTone || "natural_korean"}.`;
}
function estimatePromptTokens(text) {
    return Math.ceil(String(text ?? "").length / CHARS_PER_TOKEN_ESTIMATE);
}
function sanitizePromptLine(value, max = 240) {
    const text = String(value ?? "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length <= max
        ? text
        : `${text.slice(0, Math.max(0, max - 3))}...`;
}
function normalizeNonNegativeInteger(value) {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
