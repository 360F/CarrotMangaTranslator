// Ported from src/shared/reviewTable.ts, reference fd461737. Runtime independent of Carrot.
export function escapeDelimitedCell(value, delimiter) {
    if (value.includes('"') ||
        value.includes("\r") ||
        value.includes("\n") ||
        value.includes(delimiter)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
