import { buildHayaiRegionManifest } from '../detection/geometry.js';
import { parseKoharuLayoutOutputs } from '../detection/outputs.js';
import { detectionStage } from '../detection/stage.js';
import { prepareImage, type KoharuRuntime, type DetectionLog } from './koharu.js';

export function koharuDetectionStage(runtime: KoharuRuntime, log: DetectionLog = () => {}) {
  return detectionStage(async page => {
    const prepared = await prepareImage(page.imagePath);
    const start = performance.now();
    const outputs = await runtime.infer(prepared);
    const inferred = performance.now();
    const detections = parseKoharuLayoutOutputs(outputs, prepared);
    const manifest = buildHayaiRegionManifest({ imageWidth: prepared.width, imageHeight: prepared.height, detections, executionProvider: 'cpu' });
    log('detect-page', { pageId: page.id, inferenceMs: inferred - start, postprocessMs: performance.now() - inferred,
      dialogueRegions: manifest.dialogueRegions.length, effectRegions: manifest.effectRegions.length });
    return manifest;
  });
}
