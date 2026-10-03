// Ported from src/main/pipeline/workContextPrompt.ts, reference fd461737. Runtime independent of Carrot.
import { collectOcrTextEvidence, normalizeEvidence, normalizeEvidenceSegments, } from "./pageContextEvidence.mjs";
export function buildPromptWorkContextForPage({ baseStyleGuide, storyMemory, pageIndex, recentPageCount = 6, previousStoryPages = [], ocrHints, }) {
    const contextPages = [...previousStoryPages, ...storyMemory.pages];
    const recentPages = contextPages
        .filter((page) => page.pageIndex < pageIndex)
        .sort((left, right) => right.pageIndex - left.pageIndex)
        .slice(0, recentPageCount)
        .reverse();
    return {
        styleGuide: rankStyleGuideForPage(baseStyleGuide, { ...storyMemory, pages: contextPages }, normalizeEvidenceSegments(collectOcrTextEvidence(ocrHints))),
        storyMemory: {
            ...storyMemory,
            pages: recentPages,
        },
        recentPageCount,
    };
}
function rankStyleGuideForPage(guide, memory, ocrEvidence) {
    return {
        ...guide,
        glossary: rankEntries(guide.glossary, (entry) => [entry.source, ...(entry.aliases ?? [])], (page) => page.glossaryEntryIds ?? [], ocrEvidence, memory),
        characters: rankEntries(guide.characters, (entry) => [
            entry.displayName,
            entry.targetName,
            ...entry.sourceNames,
            ...(entry.aliases ?? []),
        ], (page) => page.characterIds ?? [], ocrEvidence, memory),
    };
}
function rankEntries(entries, names, pageIds, evidence, memory) {
    const stats = new Map();
    for (const page of memory.pages) {
        for (const id of new Set(pageIds(page))) {
            const current = stats.get(id) ?? { pages: 0, recent: -1 };
            current.pages += 1;
            current.recent = Math.max(current.recent, page.pageIndex);
            stats.set(id, current);
        }
    }
    return entries
        .map((entry, index) => ({
        entry,
        index,
        direct: names(entry).some((value) => {
            const key = normalizeEvidence(value);
            return (Boolean(key) && evidence.some((segment) => segment.includes(key)));
        }),
        stats: stats.get(entry.id) ?? { pages: 0, recent: -1 },
    }))
        .sort((left, right) => Number(right.direct) - Number(left.direct) ||
        right.stats.pages - left.stats.pages ||
        right.stats.recent - left.stats.recent ||
        left.index - right.index)
        .map(({ entry }) => entry);
}
