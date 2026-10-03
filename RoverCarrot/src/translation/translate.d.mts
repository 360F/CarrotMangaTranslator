import type { Page, StageResult, TranslationConfig, TranslationContext } from '../core/contracts.js';
export type TranslationPorts = {
  open: (signal?: AbortSignal) => Promise<{ baseUrl: string; dispose: () => Promise<void> }>;
  images: (page: Page, options: Record<string, unknown>) => Promise<unknown[]>;
  artifactRoot: string;
  log?: (type: string, fields: Record<string, unknown>) => void;
};
export function translatePage(page: Page, index: number, context: TranslationContext, config: TranslationConfig,
  ports: TranslationPorts, signal?: AbortSignal): Promise<StageResult>;
