import { randomUUID } from 'node:crypto';
import type { Page, Stage } from '../core/contracts.js';
import type { HayaiRegionManifest } from './geometry.js';
import { hashStableValue } from './fingerprint.js';

export type DetectionResult = HayaiRegionManifest;
export type DetectPage = (page: Page) => Promise<DetectionResult>;

function normalized(box: number[], page: Page) {
  const x = Math.max(0, Math.min(1000, box[0]! * 1000 / page.width));
  const y = Math.max(0, Math.min(1000, box[1]! * 1000 / page.height));
  return { x, y, w: Math.max(1, Math.min(1000 - x, (box[2]! - box[0]!) * 1000 / page.width)),
    h: Math.max(1, Math.min(1000 - y, (box[3]! - box[1]!) * 1000 / page.height)) };
}
const emptyKey = (page: Page) => hashStableValue([page.imagePath, []]);

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
      sourceDetectionIds: [...region.sourceDetectionIds], regionId: region.regionId, regionType: region.kind,
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
    pageWorkflow: { ...(page.pageWorkflow ?? {}), emptyDetectionKey: blocks.length ? undefined : emptyKey(page) },
    soundEffectReview: { contractVersion: 3, producer: 'hayai-regions-v1', regionOverrides: [], manualRegions: [], resolvedRegions: [],
      regions: manifest.effectRegions.map(region => ({ id: region.regionId, bbox: normalized(region.bbox, page),
        detectorConfidence: region.detectorConfidence, sourceDetectionIds: region.sourceDetectionIds })) },
  };
  // Discard stale translation receipts on internal overwrite, like production.
  for (const field of ['translationCheckpoint', 'translationCompletion']) delete (next as Record<string, unknown>)[field];
  return next;
}

export function detectionStage(detect: DetectPage, options: { overwrite?: boolean } = {}): Stage {
  return { id: 'detect', reads: ['imagePath', 'width', 'height', 'blocks', 'pageWorkflow.emptyDetectionKey'],
    writes: ['blocks', 'blockOrder', 'soundEffectReview', 'workflowOrigin', 'pageWorkflow.emptyDetectionKey', 'analysisStatus'],
    resources: ['Koharu CPU session'],
    async execute(page) {
      if (!options.overwrite && (page.blocks.length || page.pageWorkflow?.emptyDetectionKey === emptyKey(page)))
        return { status: page.blocks.length ? 'completed' : 'empty', page };
      const next = applyDetection(page, await detect(page));
      return { status: next.blocks.length ? 'completed' : 'empty', page: next };
    },
  };
}
