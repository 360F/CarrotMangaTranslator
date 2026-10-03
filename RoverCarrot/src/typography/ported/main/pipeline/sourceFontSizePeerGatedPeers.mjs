// Ported from read-only fork fd461737. See source-map.json.
import { maximumValueRatio, median, SOURCE_FONT_FACE_SCALE, valuePairRatio, } from "./sourceFontSizeMath.mjs";
const MODE_RADIUS_RATIO = 1.18;
const MINIMUM_STABLE_PEERS = 3;
export function selectPagePeerCenter(candidates, isStable) {
    const stable = candidates.filter(isStable);
    const clusters = stable.map((center) => {
        const members = stable.filter((candidate) => valuePairRatio(candidate.baseline.facePx, center.baseline.facePx) <=
            MODE_RADIUS_RATIO);
        return {
            center: median(members.map((candidate) => candidate.baseline.facePx)),
            members,
        };
    });
    const selected = clusters.sort(comparePeerClusters)[0];
    return selected && selected.members.length >= MINIMUM_STABLE_PEERS
        ? selected.center
        : null;
}
export function isStablePeerCandidate(candidate) {
    const stable = stableCandidateEvidence(candidate);
    return Boolean(stable && maximumValueRatio(stable.majorBandFaces) <= 1.8);
}
export function isStableUpwardPeerCandidate(candidate) {
    const stable = stableCandidateEvidence(candidate);
    return Boolean(stable && hasStableMajorBandCore(stable.majorBandFaces));
}
function comparePeerClusters(left, right) {
    return (right.members.length - left.members.length ||
        median(right.members.map((candidate) => candidate.baseline.confidence)) -
            median(left.members.map((candidate) => candidate.baseline.confidence)));
}
function stableCandidateEvidence(candidate) {
    if (candidate.baseline.confidence < 0.75 || candidate.glyphCount < 8) {
        return null;
    }
    const trial = candidate.trialAt(candidate.formulaLineCount);
    if (!trial?.projection ||
        !trial.component ||
        trial.component.primaryMassShare < 0.25 ||
        !trial.majorPitch) {
        return null;
    }
    const stableValues = [
        candidate.baseline.facePx,
        trial.component.primaryFace * SOURCE_FONT_FACE_SCALE,
        trial.majorPitch.face * SOURCE_FONT_FACE_SCALE,
    ];
    return maximumValueRatio(stableValues) <= 1.2
        ? { majorBandFaces: trial.majorPitch.bandFaces }
        : null;
}
function hasStableMajorBandCore(bandFaces) {
    if (bandFaces.length === 0)
        return false;
    if (bandFaces.length <= 2)
        return maximumValueRatio(bandFaces) <= 1.8;
    const required = Math.ceil(bandFaces.length * 0.75);
    return bandFaces.some((center) => bandFaces.filter((face) => valuePairRatio(face, center) <= 1.35).length >=
        required);
}
