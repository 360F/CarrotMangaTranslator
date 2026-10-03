// Ported from src/main/pipeline/groundedPageContextCandidates.ts, reference fd461737. Runtime independent of Carrot.
import { evidenceContains } from "./pageContextEvidence.mjs";
export function sanitizeGroundedGlossaryCandidate(candidate, sourceEvidence, targetEvidence) {
    if (!candidate.source.trim() ||
        !candidate.target.trim() ||
        !evidenceContains(sourceEvidence, candidate.source) ||
        !evidenceContains(targetEvidence, candidate.target)) {
        return null;
    }
    return {
        ...candidate,
        aliases: candidate.aliases?.filter((alias) => evidenceContains(sourceEvidence, alias)),
    };
}
export function sanitizeGroundedCharacterCandidate(candidate, sourceEvidence, targetEvidence) {
    const sourceNames = candidate.sourceNames.filter((name) => evidenceContains(sourceEvidence, name));
    if (sourceNames.length === 0 ||
        !candidate.targetName.trim() ||
        !evidenceContains(targetEvidence, candidate.targetName)) {
        return null;
    }
    return {
        ...candidate,
        displayName: evidenceContains(targetEvidence, candidate.displayName)
            ? candidate.displayName
            : candidate.targetName,
        sourceNames,
        aliases: candidate.aliases?.filter((alias) => evidenceContains(sourceEvidence, alias)),
    };
}
