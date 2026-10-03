import type { Page, Stage } from '../core/contracts.js';
import { applyTypography, defaultPlan } from './typography.mjs';
export type Raster = { width: number; height: number; bgra: Uint8Array };
export type LoadRaster = (page: Page, signal?: AbortSignal) => Promise<Raster>;
export type TypographyPlan = { autoFont: false; autoSize: boolean; bubbleLayout: boolean; naturalLayout: boolean; overwrite: ('typography' | 'layout')[] };
export function typographyStage(loadRaster: LoadRaster, plan: TypographyPlan = defaultPlan, logWarning?: (message: string, fields: Record<string, unknown>) => void): Stage {
  return { id: 'typography', reads: ['imagePath', 'width', 'height', 'blocks', 'workflowOrigin.recognitionSegments'],
    writes: ['fontSizePx', 'fontSizeIntent', 'sourceFontFacePx', 'sourceFontSizeConfidence', 'sourceFontSizeMethod', 'autoFitText', 'workflowOrigin.sizeApplied'],
    resources: ['original BGRA raster', 'CPU source-font-size estimator'],
    async execute(page) { return { status: page.blocks.length ? 'completed' : 'empty', page: await applyTypography(page, loadRaster, plan, undefined, logWarning) }; } };
}
