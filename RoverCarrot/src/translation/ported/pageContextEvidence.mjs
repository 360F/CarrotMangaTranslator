// Ported from src/main/pipeline/pageContextEvidence.ts, reference fd461737. Runtime independent of Carrot.
export function collectOcrTextEvidence(value) {
    const found = [];
    const visit = (item, depth) => {
        if (depth > 5 || item === null || item === undefined)
            return;
        if (Array.isArray(item)) {
            item.slice(0, 500).forEach((entry) => visit(entry, depth + 1));
            return;
        }
        if (typeof item !== "object")
            return;
        for (const [key, child] of Object.entries(item)) {
            if (typeof child === "string" &&
                /^(?:ocrText|text|sourceText|transcript)$/i.test(key)) {
                const text = child.replace(/\s+/g, " ").trim();
                if (text)
                    found.push(text);
            }
            else if (typeof child === "object") {
                visit(child, depth + 1);
            }
        }
    };
    visit(value, 0);
    return [...new Set(found)];
}
export function buildNameIndex(entries, names) {
    const index = new Map();
    for (const entry of entries) {
        for (const value of names(entry)) {
            const key = normalizeEvidence(value);
            if (!key)
                continue;
            const ids = index.get(key) ?? new Set();
            ids.add(entry.id);
            index.set(key, ids);
        }
    }
    return index;
}
export function resolveNameMatches(index, values) {
    const matches = new Set();
    for (const value of values) {
        for (const id of index.get(normalizeEvidence(value)) ?? []) {
            matches.add(id);
        }
    }
    return matches;
}
export function evidenceContains(normalizedEvidence, value) {
    const needle = normalizeEvidence(value);
    return (Boolean(needle) &&
        normalizedEvidence.some((segment) => segment.includes(needle)));
}
export function normalizeEvidenceSegments(values) {
    return [...new Set(values.map(normalizeEvidence).filter(Boolean))];
}
export function normalizeEvidence(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, "");
}
