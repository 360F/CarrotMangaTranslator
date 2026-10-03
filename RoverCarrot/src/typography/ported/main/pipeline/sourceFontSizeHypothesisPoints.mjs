// Ported from read-only fork fd461737. See source-map.json.
import { SOURCE_FONT_FACE_SCALE, } from "./sourceFontSizeMath.mjs";
export function createMajorBandHypothesisPoints(trial) {
    const measurement = trial.majorPitch;
    if (!measurement?.bandFaces.length)
        return [];
    const weight = measurement.confidence / Math.sqrt(measurement.bandFaces.length);
    return measurement.bandFaces.map((face) => ({
        confidence: measurement.confidence,
        face: face * SOURCE_FONT_FACE_SCALE,
        lineCount: trial.lineCount,
        source: "major-band",
        weight,
    }));
}
