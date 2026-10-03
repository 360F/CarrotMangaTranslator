// Ported from src/main/pipeline/glossaryOmission.ts (fd461737).
import { applyGlossaryOmissionToTranslation, collectGlossaryOmissionTerms, omitGlossaryTermsFromSource, } from "./glossaryOmissionShared.mjs";
export { collectGlossaryOmissionTerms };
export function applyGlossaryOmissionsToOverlayItems(items, pageOptions) {
    const terms = pageOptions.glossaryOmissionTerms ?? [];
    if (terms.length === 0)
        return items;
    const sourceByCandidateId = indexOriginalOcrSource(pageOptions.ocrBboxResult?.hints);
    return items.map((item) => {
        const sourceText = resolveOriginalItemSource(item, sourceByCandidateId) ||
            item.sourceText ||
            item.jp;
        const translatedText = item.translatedText ?? item.ko;
        const omission = omitGlossaryTermsFromSource(sourceText, terms);
        if (omission.matchedTerms.length === 0)
            return item;
        const nextTranslation = applyGlossaryOmissionToTranslation({
            sourceText,
            translatedText,
            terms,
        });
        return {
            ...item,
            // Restore the authoritative OCR copy even though the model saw a
            // prompt-only version with omission terms removed.
            jp: sourceText,
            sourceText,
            ko: nextTranslation,
            translatedText: nextTranslation,
        };
    });
}
function indexOriginalOcrSource(rawHints) {
    const index = new Map();
    for (const hint of rawHints ?? []) {
        if (!hint || typeof hint !== "object")
            continue;
        const record = hint;
        const id = Number(record.id);
        const text = readOcrText(record);
        if (Number.isInteger(id) && id > 0 && text)
            index.set(id, text);
    }
    return index;
}
function resolveOriginalItemSource(item, sourceByCandidateId) {
    const candidateIds = item.candidateIds?.length
        ? item.candidateIds
        : [item.id];
    return candidateIds
        .map((id) => sourceByCandidateId.get(id) ?? "")
        .filter(Boolean)
        .join("");
}
function readOcrText(record) {
    for (const key of [
        "ocrText",
        "ocr_text",
        "text",
        "content",
        "block_content",
        "rec_text",
        "transcription",
    ]) {
        const value = record[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return "";
}
