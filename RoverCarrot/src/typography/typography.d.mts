import type { Page } from '../core/contracts.js';
import type { LoadRaster, TypographyPlan } from './stage.js';
export const defaultPlan: TypographyPlan;
export function applyTypography(page: Page, loadRaster: LoadRaster, plan?: TypographyPlan, signal?: AbortSignal, logWarning?: (message: string, fields: Record<string, unknown>) => void): Promise<Page>;
