// Ported from src/main/pipeline/storyMemoryBuilder.ts, reference fd461737. Runtime independent of Carrot.
export function buildPageStoryMemory({ page, pageIndex, }) {
    const sourceLines = page.blocks.map((block) => block.sourceText);
    const translatedLines = page.blocks.map((block) => block.translatedText);
    return {
        pageId: page.id,
        pageName: page.name,
        pageIndex,
        sourceDigest: compactLines(sourceLines, 700),
        translatedDigest: compactLines(translatedLines, 700),
        summary: compactLines(translatedLines, 400),
        characterIds: collectKnownCharacterIds(page),
        updatedAt: new Date().toISOString(),
    };
}
export function upsertPageStoryMemory(memory, pageMemory) {
    const pages = memory.pages.filter((page) => page.pageId !== pageMemory.pageId);
    pages.push(pageMemory);
    pages.sort((left, right) => left.pageIndex - right.pageIndex);
    return {
        ...memory,
        pages,
        updatedAt: new Date().toISOString(),
    };
}
function compactLines(lines, maxChars) {
    const joined = lines
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" / ");
    return joined.length <= maxChars
        ? joined
        : `${joined.slice(0, Math.max(0, maxChars - 3))}...`;
}
function collectKnownCharacterIds(page) {
    return [
        ...new Set(page.blocks
            .map((block) => block.speakerId?.trim())
            .filter((value) => Boolean(value))),
    ];
}
