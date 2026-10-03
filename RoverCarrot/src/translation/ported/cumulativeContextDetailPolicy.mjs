// Ported from src/main/pipeline/cumulativeContextDetailPolicy.ts, reference fd461737. Runtime independent of Carrot.
import { normalizeEvidence } from "./pageContextEvidence.mjs";
const ESSENTIAL_CATEGORIES = new Set(["character", "alias", "place"]);
export function applyCumulativeContextDetailPolicy(pageContext, detail, sourceEvidence) {
    if (!pageContext || detail === "detailed")
        return pageContext;
    return {
        ...pageContext,
        glossary: pageContext.glossary.filter((candidate) => {
            if (detail === "balanced")
                return candidate.category !== "other";
            if (ESSENTIAL_CATEGORIES.has(candidate.category))
                return true;
            return (candidate.category === "term" &&
                countEvidenceOccurrences(sourceEvidence, candidate.source) >= 2);
        }),
    };
}
function countEvidenceOccurrences(evidence, value) {
    const needle = normalizeEvidence(value);
    if (!needle)
        return 0;
    return evidence.reduce((count, segment) => {
        const haystack = normalizeEvidence(segment);
        let offset = 0;
        let matches = 0;
        while ((offset = haystack.indexOf(needle, offset)) >= 0) {
            matches += 1;
            offset += needle.length;
        }
        return count + matches;
    }, 0);
}
