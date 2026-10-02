import { randomUUID } from 'node:crypto';
import type { Page, Stage } from '../core/contracts.js';
import type { HayaiRegionManifest } from './geometry.js';
import { hashStableValue } from './fingerprint.js';

export type DetectionResult = HayaiRegionManifest;
export type DetectPage = (page: Page) => Promise<DetectionResult>;

// Reference pixelsToBbox/clampBbox arithmetic, kept local to the port.
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
export function normalized(box: number[], page: Pick<Page, 'width' | 'height'>) {
  const x = clamp((box[0]! / Math.max(1, page.width)) * 1000, 0, 999);
  const y = clamp((box[1]! / Math.max(1, page.height)) * 1000, 0, 999);
  return { x, y, w: clamp(((box[2]! - box[0]!) / Math.max(1, page.width)) * 1000, 1, 1000 - x),
    h: clamp(((box[3]! - box[1]!) / Math.max(1, page.height)) * 1000, 1, 1000 - y) };
}

// Minimum detection-only slice of overlayItemToBlock with production format defaults.
// Empty text "...": readable-box expansion needs >=28.5x11.8 px; the
// production estimator then clamps to >=12 px, so this reduces to the same formula.
export function applyDetection(page: Page, manifest: DetectionResult): Page {
  if (manifest.width !== page.width || manifest.height !== page.height) throw new Error('Detection image dimensions disagree with page');
  const detectionId = randomUUID();
  const blocks = manifest.dialogueRegions.map((region, index) => {
    const bbox = normalized(region.bbox, page);
    const fontSizePx = Math.max(12, Math.min(72, Math.min(Math.floor(bbox.h * page.height / 1000 / 1.2),
      Math.floor(bbox.w * page.width / 1000 / 4), 40)));
    const block = {
      id: `${page.id}-${detectionId}-block-${index + 1}`, type: 'nonsolid', bbox, bboxSpace: 'normalized_1000',
      sourceText: '', translatedText: '', textRole: 'ordinary', confidence: region.detectorConfidence,
      sourceDirection: 'horizontal', renderDirection: 'horizontal', rotationDeg: 0, fontSizePx,
      lineHeight: 1.18, textAlign: 'center', textColor: '#111111', outlineColor: '#ffffff',
      backgroundColor: '#fef3c7', opacity: 0.7, autoFitText: true, textDisplayMode: 'translation-only',
      wordBreak: 'break-word', letterSpacing: 0, fontWidthScale: 1, textOpacity: 1, bold: false, italic: false, outlineWidthScale: 1,
    };
    return { ...block, workflowOrigin: {
      geometryKey: hashStableValue([page.imagePath, page.width, page.height, bbox, block.bboxSpace]),
      ...(region.recognitionBboxes ? { recognitionBboxes: region.recognitionBboxes } : {}),
      ...(region.ocrSubdivision ? { ocrSubdivision: region.ocrSubdivision } : {}),
      initialFontSize: fontSizePx,
      initialFontStyle: { bold: false, italic: false, textColor: block.textColor, outlineColor: block.outlineColor },
    } };
  });
  const next = { ...page, blocks, blockOrder: blocks.map(block => block.id), analysisStatus: 'idle' as const,
    soundEffectReview: { contractVersion: 3, producer: 'hayai-regions-v1', regionOverrides: [], manualRegions: [], resolvedRegions: [],
      regions: manifest.effectRegions.map(region => ({ id: region.regionId, bbox: normalized(region.bbox, page),
        detectorConfidence: region.detectorConfidence, sourceDetectionIds: region.sourceDetectionIds })) },
  };
  // Discard stale translation receipts on internal overwrite, like production.
  for (const field of ['translationCheckpoint', 'translationCompletion']) delete (next as Record<string, unknown>)[field];
  return next;
}

export function detectionStage(detect: DetectPage, options: { overwrite?: boolean } = {}): Stage {
  return { id: 'detect', reads: ['imagePath', 'width', 'height', 'blocks'],
    writes: ['blocks', 'blockOrder', 'soundEffectReview', 'workflowOrigin', 'analysisStatus'],
    resources: ['Koharu CPU session'],
    async execute(page) {
      if (!options.overwrite && page.blocks.length)
        return { status: 'completed', page };
      const next = applyDetection(page, await detect(page));
      return { status: next.blocks.length ? 'completed' : 'empty', page: next };
    },
  };
}
