// Pure selected reference functions from simple-page-request-summary.cjs (fd461737).
import {readOcrCandidateText} from "./runtime/prompts/ocr-text.mjs";
import {truncateText} from "./runtime/prompts/model-profile.mjs";
function summarizeImageVariants(imageVariants) {
  return imageVariants.map((variant) => ({
    role: variant.role,
    path: variant.path,
    mime: variant.mime || variant.mime,
    convertedFromMime: variant.convertedFromMime || null,
    width: variant.width || null,
    height: variant.height || null,
    originalWidth: variant.originalWidth || null,
    originalHeight: variant.originalHeight || null,
  }));
}
function summarizeOcrBboxHint(hint, includeRecognitionSegments = false) {
  return {
    id: hint.id,
    label: hint.label,
    x1: hint.x1,
    y1: hint.y1,
    x2: hint.x2,
    y2: hint.y2,
    score: hint.score ?? null,
    groupId: hint.groupId ?? null,
    rolePrior: hint.rolePrior ?? null,
    containerType: hint.containerType ?? null,
    orderInGroup: hint.orderInGroup ?? null,
    geometryLocked: hint.geometryLocked === true,
    ocrText: truncateText(readOcrCandidateText(hint), 160) || null,
    ...(includeRecognitionSegments
      ? {
          recognitionSegments: summarizeRecognitionSegments(
            hint.recognitionSegments,
          ),
        }
      : {}),
  };
}
function summarizeRecognitionSegments(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    return undefined;
  }
  const segments = value.flatMap((segment) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      return [];
    }
    const record = /** @type {Record<string, unknown>} */ (segment);
    const x1 = Number(record.x1);
    const y1 = Number(record.y1);
    const x2 = Number(record.x2);
    const y2 = Number(record.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) {
      return [];
    }
    return [
      {
        x1,
        y1,
        x2,
        y2,
        ocrText: truncateText(readOcrCandidateText(record), 160) || null,
      },
    ];
  });
  return segments.length === value.length ? segments : undefined;
}
export {summarizeOcrBboxHint,summarizeImageVariants};
