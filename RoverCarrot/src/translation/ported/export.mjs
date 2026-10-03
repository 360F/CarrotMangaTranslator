// Ported from src/main/linkedWorkspace/linkedWorkspaceTranslationJson.ts, reference fd461737. Runtime independent of Carrot.
import { resolvePageBlocksForReading } from './blockReadingOrder.mjs';
import { escapeDelimitedCell } from './reviewTable.mjs';
export function buildTranslationJson({ chapter, readingDirection, workName, }) {
    const pagesById = new Map(chapter.pages.map((page) => [page.id, page]));
    const ordered = chapter.pageOrder.flatMap((id) => pagesById.get(id) ?? []);
    const unordered = chapter.pages.filter((page) => !ordered.includes(page));
    return {
        schemaVersion: 2,
        workName,
        inputName: chapter.title,
        pages: [...ordered, ...unordered].map((page, pageIndex) => ({
            page: pageIndex + 1,
            blocks: resolvePageBlocksForReading(page, readingDirection).map((block, blockIndex) => ({
                block: blockIndex + 1,
                sourceText: block.sourceText,
                translatedText: block.translatedText,
            })),
        })),
    };
}
export function serializeTranslationCsv(document) {
    const rows = [
        ["page", "block", "sourceText", "translatedText"],
        ...document.pages.flatMap((page) => page.blocks.map((entry) => [
            String(page.page),
            String(entry.block),
            entry.sourceText,
            entry.translatedText,
        ])),
    ];
    const lines = rows.map((row) => row.map((cell) => escapeDelimitedCell(cell, ",")).join(","));
    return `\uFEFF${lines.join("\r\n")}\r\n`;
}
