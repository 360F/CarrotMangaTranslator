import type { Page, Stage } from '../core/contracts.js';
import type { TypographyPlan } from '../typography/stage.js';
import { defaultPlan } from '../typography/typography.mjs';
import { applyLayout } from './layout.mjs';
// The same runner accepts gap=0 / segmentation=true for Step 6's transient prepass.
export type LayoutRequest = { page: Page; imagePath: string; targetBlockIds?: readonly string[]; policy: 'safe' | 'balanced' | 'maximize';
  paddingRatio?: number; sharedOwnershipGapPx?: number; includeTypographySegmentation?: boolean; failureMode?: 'required' | 'best-effort'; signal: AbortSignal };
export type LayoutRunner = { runPage(request: LayoutRequest): Promise<{ patches: Record<string, unknown>[]; typographySegmentation?: unknown }> };
export function layoutStage(runner: LayoutRunner, plan: TypographyPlan = defaultPlan, locale?: string): Stage {
  return { id: 'layout', reads: ['imagePath', 'inpaintedImagePath', 'blocks', 'translatedText', 'fontSizePx', 'outlineWidthPx', 'layoutIntent'],
    writes: ['bubbleLayout', 'renderBbox', 'renderBboxSpace', 'translatedText', 'renderDirection'],
    resources: ['Koharu CPU layout re-detection', 'bubble masks', 'CPU slot calculation'],
    async execute(page) { return { status: page.blocks.length ? 'completed' : 'empty', page: await applyLayout(page, runner, plan, undefined, locale) }; } };
}
