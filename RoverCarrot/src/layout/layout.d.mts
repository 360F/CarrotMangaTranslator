import type { Page } from '../core/contracts.js';
import type { TypographyPlan } from '../typography/stage.js';
import type { LayoutRunner } from './stage.js';
export function applyLayout(page: Page, runner: LayoutRunner, plan?: TypographyPlan, signal?: AbortSignal, locale?: string): Promise<Page>;
