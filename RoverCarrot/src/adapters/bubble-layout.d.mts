import type { Page } from '../core/contracts.js';
import type { ComicPageDetection } from '../detection/contracts.js';
import type { LayoutRunner } from '../layout/stage.js';
export function bubbleLayoutRunner(detect: (page: Page) => Promise<{imageWidth: number; imageHeight: number; detections: ComicPageDetection[] }>, log?: (type: string, fields: Record<string, unknown>) => void): LayoutRunner;
