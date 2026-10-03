// Ported from src/shared/blockReadingOrder.ts, reference fd461737. Runtime independent of Carrot.
/**
 * Orders page blocks in natural reading order. Blocks are grouped into visual
 * rows from top to bottom, then ordered horizontally inside each row. Japanese
 * manga defaults to right-to-left while callers may explicitly request LTR.
 */
export function sortBlocksForReading(blocks, direction = "rtl") {
    const items = [...blocks];
    if (items.length <= 1) {
        return items;
    }
    items.sort((left, right) => left.bbox.y - right.bbox.y);
    const rows = [];
    for (const block of items) {
        const row = rows[rows.length - 1];
        if (row && belongsToReadingRow(row[0], block)) {
            row.push(block);
        }
        else {
            rows.push([block]);
        }
    }
    for (const row of rows) {
        row.sort((left, right) => direction === "rtl"
            ? right.bbox.x - left.bbox.x
            : left.bbox.x - right.bbox.x);
    }
    return rows.flat();
}
/**
 * Resolves an explicit page order while safely repairing legacy, duplicate, or
 * stale ids. New blocks are appended using the inferred geometric order.
 */
export function resolvePageBlocksForReading(page, direction = "rtl") {
    const byId = new Map(page.blocks.map((block) => [block.id, block]));
    const ordered = [];
    const seen = new Set();
    for (const id of page.blockOrder ?? []) {
        const block = byId.get(id);
        if (!block || seen.has(id))
            continue;
        seen.add(id);
        ordered.push(block);
    }
    for (const block of sortBlocksForReading(page.blocks, direction)) {
        if (seen.has(block.id))
            continue;
        seen.add(block.id);
        ordered.push(block);
    }
    return ordered;
}
export function resolvePageBlockOrder(page, direction = "rtl") {
    return resolvePageBlocksForReading(page, direction).map((block) => block.id);
}
export function inferPageBlockOrder(blocks, direction = "rtl") {
    return sortBlocksForReading(blocks, direction).map((block) => block.id);
}
export function resolveReadingDirection(stored, inferred) {
    return stored === "rtl" || stored === "ltr" ? stored : inferred;
}
function belongsToReadingRow(reference, candidate) {
    const referenceCenter = reference.bbox.y + reference.bbox.h / 2;
    const candidateCenter = candidate.bbox.y + candidate.bbox.h / 2;
    const threshold = Math.max(reference.bbox.h, candidate.bbox.h) * 0.5;
    return Math.abs(candidateCenter - referenceCenter) <= threshold;
}
