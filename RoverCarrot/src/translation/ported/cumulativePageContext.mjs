// Ported from src/main/pipeline/cumulativePageContext.ts, reference fd461737. Runtime independent of Carrot.
import { randomUUID } from "node:crypto";
import { MAX_CHARACTER_PROFILES, MAX_GLOSSARY_ENTRIES, } from "./ipcSchemaPrimitives.mjs";
import { buildPageStoryMemory } from "./storyMemoryBuilder.mjs";
import { buildNameIndex, collectOcrTextEvidence, evidenceContains, normalizeEvidenceSegments, resolveNameMatches, } from "./pageContextEvidence.mjs";
import { tMain } from "./localization.mjs";
import { sanitizeGroundedCharacterCandidate, sanitizeGroundedGlossaryCandidate, } from "./groundedPageContextCandidates.mjs";
import { applyCumulativeContextDetailPolicy } from "./cumulativeContextDetailPolicy.mjs";
const MAX_PAGE_EVIDENCE_IDS = 100;
export function mergeCumulativePageContext({ styleGuide, existingPageMemory, page, pageIndex, pageContext, cumulativeContextDetail = "detailed", ocrResult, now = new Date().toISOString(), }) {
    const warnings = [];
    const sourceEvidence = normalizeEvidenceSegments([
        ...page.blocks.map((block) => block.sourceText),
        ...collectOcrTextEvidence(ocrResult?.hints),
    ]);
    const targetEvidence = normalizeEvidenceSegments(page.blocks.map((block) => block.translatedText));
    const filteredPageContext = applyCumulativeContextDetailPolicy(pageContext, cumulativeContextDetail, sourceEvidence);
    const characterMerge = mergeCharacterCandidates({
        entries: styleGuide.characters,
        crossIndex: buildGlossaryIndex(styleGuide.glossary),
        candidates: filteredPageContext?.characters ?? [],
        sourceEvidence,
        targetEvidence,
        warnings,
        now,
    });
    const glossaryMerge = mergeGlossaryCandidates({
        entries: styleGuide.glossary,
        crossIndex: buildCharacterIndex(characterMerge.entries),
        candidates: filteredPageContext?.glossary ?? [],
        sourceEvidence,
        targetEvidence,
        warnings,
        now,
    });
    const guideChanged = glossaryMerge.changed || characterMerge.changed;
    const nextGuide = guideChanged
        ? {
            ...styleGuide,
            glossary: glossaryMerge.entries,
            characters: characterMerge.entries,
            updatedAt: now,
        }
        : styleGuide;
    const pageMemory = buildCumulativePageMemory({
        existingPageMemory,
        page,
        pageIndex,
        pageContext: filteredPageContext,
        styleGuide: nextGuide,
        sourceEvidence,
        now,
    });
    return { styleGuide: nextGuide, pageMemory, guideChanged, warnings };
}
function mergeGlossaryCandidates({ entries, crossIndex, candidates, sourceEvidence, targetEvidence, warnings, now, }) {
    let merged = entries;
    let index = buildGlossaryIndex(merged);
    for (const candidate of candidates) {
        const grounded = sanitizeGroundedGlossaryCandidate(candidate, sourceEvidence, targetEvidence);
        if (!grounded)
            continue;
        const names = [
            grounded.source,
            grounded.target,
            ...(grounded.aliases ?? []),
        ];
        if (hasNameCollision(index, crossIndex, names)) {
            continue;
        }
        if (merged.length >= MAX_GLOSSARY_ENTRIES) {
            pushUnique(warnings, tMain("workContext.warnings.glossaryLimit", {
                count: MAX_GLOSSARY_ENTRIES,
            }));
            continue;
        }
        merged = [...merged, makeGlossaryEntry(grounded, now)];
        index = buildGlossaryIndex(merged);
    }
    return { entries: merged, changed: merged !== entries };
}
function mergeCharacterCandidates({ entries, crossIndex, candidates, sourceEvidence, targetEvidence, warnings, now, }) {
    let merged = entries;
    let index = buildCharacterIndex(merged);
    for (const candidate of candidates) {
        const grounded = sanitizeGroundedCharacterCandidate(candidate, sourceEvidence, targetEvidence);
        if (!grounded)
            continue;
        const names = characterCandidateNames(grounded);
        if (hasNameCollision(index, crossIndex, names)) {
            continue;
        }
        if (merged.length >= MAX_CHARACTER_PROFILES) {
            pushUnique(warnings, tMain("workContext.warnings.characterLimit", {
                count: MAX_CHARACTER_PROFILES,
            }));
            continue;
        }
        merged = [...merged, makeCharacterProfile(grounded, now)];
        index = buildCharacterIndex(merged);
    }
    return { entries: merged, changed: merged !== entries };
}
function hasNameCollision(ownIndex, crossIndex, names) {
    return (resolveNameMatches(ownIndex, names).size > 0 ||
        resolveNameMatches(crossIndex, names).size > 0);
}
function buildCumulativePageMemory({ existingPageMemory, page, pageIndex, pageContext, styleGuide, sourceEvidence, now, }) {
    const base = buildPageStoryMemory({ page, pageIndex });
    const visualMemory = resolveVisualMemory(existingPageMemory, pageContext);
    const glossaryEntryIds = collectMentionedGlossaryIds(styleGuide, sourceEvidence);
    const characterIds = collectMentionedCharacterIds(styleGuide, sourceEvidence, base.characterIds);
    return {
        ...base,
        ...visualMemory,
        glossaryEntryIds,
        characterIds,
        updatedAt: now,
    };
}
function resolveVisualMemory(existingPageMemory, pageContext) {
    const preserveManualVisual = existingPageMemory?.visualSummarySource === "manual" ||
        (Boolean(existingPageMemory?.visualSummary) &&
            existingPageMemory?.visualSummarySource !== "ai");
    if (preserveManualVisual) {
        return {
            visualSummary: existingPageMemory?.visualSummary,
            visualSummarySource: "manual",
        };
    }
    const visualSummary = pageContext?.visualSummary || existingPageMemory?.visualSummary;
    return {
        visualSummary,
        visualSummarySource: visualSummary ? "ai" : undefined,
    };
}
function collectMentionedGlossaryIds(styleGuide, sourceEvidence) {
    return [
        ...new Set(styleGuide.glossary
            .filter((entry) => glossaryEntryMentioned(entry, sourceEvidence))
            .map((entry) => entry.id)
            .slice(0, MAX_PAGE_EVIDENCE_IDS)),
    ];
}
function collectMentionedCharacterIds(styleGuide, sourceEvidence, speakerIds) {
    const knownCharacterIds = new Set(styleGuide.characters.map((entry) => entry.id));
    const characterIds = styleGuide.characters
        .filter((entry) => characterMentioned(entry, sourceEvidence))
        .map((entry) => entry.id)
        .slice(0, MAX_PAGE_EVIDENCE_IDS);
    for (const speakerId of speakerIds ?? []) {
        if (characterIds.length < MAX_PAGE_EVIDENCE_IDS &&
            knownCharacterIds.has(speakerId)) {
            characterIds.push(speakerId);
        }
    }
    return [...new Set(characterIds)];
}
function makeGlossaryEntry(candidate, now) {
    return {
        id: `glossary-${randomUUID()}`,
        source: candidate.source,
        target: candidate.target,
        category: candidate.category,
        aliases: candidate.aliases?.length ? candidate.aliases : undefined,
        note: candidate.note,
        origin: "ai",
        enabled: true,
        createdAt: now,
        updatedAt: now,
    };
}
function makeCharacterProfile(candidate, now) {
    return {
        id: `character-${randomUUID()}`,
        displayName: candidate.displayName,
        sourceNames: candidate.sourceNames,
        targetName: candidate.targetName,
        aliases: candidate.aliases?.length ? candidate.aliases : undefined,
        speechStyle: candidate.speechStyle ?? "neutral",
        customSpeechStyle: candidate.customSpeechStyle,
        note: candidate.note,
        origin: "ai",
        enabled: true,
        createdAt: now,
        updatedAt: now,
    };
}
function glossaryEntryMentioned(entry, sourceEvidence) {
    return [entry.source, ...(entry.aliases ?? [])].some((value) => evidenceContains(sourceEvidence, value));
}
function characterMentioned(entry, sourceEvidence) {
    return [...entry.sourceNames, ...(entry.aliases ?? [])].some((value) => evidenceContains(sourceEvidence, value));
}
function buildGlossaryIndex(entries) {
    return buildNameIndex(entries, (entry) => [
        entry.source,
        ...(entry.aliases ?? []),
    ]);
}
function buildCharacterIndex(entries) {
    return buildNameIndex(entries, (entry) => [
        entry.displayName,
        entry.targetName,
        ...entry.sourceNames,
        ...(entry.aliases ?? []),
    ]);
}
function characterCandidateNames(candidate) {
    return [
        candidate.displayName,
        candidate.targetName,
        ...candidate.sourceNames,
        ...(candidate.aliases ?? []),
    ];
}
function pushUnique(values, value) {
    if (!values.includes(value)) {
        values.push(value);
    }
}
