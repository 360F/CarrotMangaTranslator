import type { Page, Stage, TranslationConfig, TranslationContext } from '../core/contracts.js';
import { translatePage, type TranslationPorts } from './translate.mjs';
export function translationStage(config: TranslationConfig, context: () => TranslationContext,
  ports: TranslationPorts, signal?: AbortSignal): Stage {
  const indexes = new Map<string, number>();
  return { id: 'translate',
    reads: ['original image', 'sourceText', 'block ids/bbox/order', 'work style-guide', 'chapter story-memory', 'previous chapter story pages'],
    writes: ['translatedText', 'fontRole hints', 'visualClusterId', 'analysisStatus', 'pending style-guide/story-memory', 'translation artifacts'],
    resources: ['page-scoped owned llama-server', 'OpenAI-compatible HTTP'],
    async prepare(pages: Page[]) { pages.forEach((page, index) => indexes.set(page.id, index)); },
    async execute(page) { const snapshot = context(); try { return await translatePage(page, snapshot.pageIndexById?.[page.id] ?? indexes.get(page.id)!, snapshot, config, ports, signal); }
      catch (error) {
        if (!(error instanceof Error) || !(error as Error & { nonRetriable?: boolean }).nonRetriable) throw error;
        return { status: 'failed', page: { ...page, analysisStatus: 'failed', lastError: error.message }, message: error.message, retryable: false };
      } } };
}
