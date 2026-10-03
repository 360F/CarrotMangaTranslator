import { performance } from 'node:perf_hooks';
import type { Chapter, Event, RunResult, Stage, Persistence } from '../core/contracts.js';

export async function executePipeline(chapter: Chapter, stages: Stage[], persistence: Persistence,
  result: RunResult, onEvent: (event: Event) => void): Promise<RunResult> {
  const runStarted = performance.now();
  const failedPages = new Set<string>();
  const emit = (event: Event) => { result.events.push(event); onEvent(event); };
  for (const stage of stages) {
    const eligibleCount = chapter.pages.filter(p => !failedPages.has(p.id)).length;
    const preparationStarted = performance.now();
    let preparationError: unknown;
    try { await stage.prepare?.(structuredClone(chapter.pages.filter(p => !failedPages.has(p.id)))); }
    catch (error) { preparationError = error; }
    const preparationMsPerPage = stage.prepare ? (performance.now() - preparationStarted) / Math.max(1, eligibleCount) : 0;
    for (const [index, page] of chapter.pages.entries()) {
      if (failedPages.has(page.id)) continue;
      const started = performance.now();
      emit({ type: 'stage-start', runId: result.runId, pageId: page.id, stage: stage.id });
      let status: 'completed' | 'empty' | 'failed' = 'failed';
      let nextPage = page;
      try {
        if (preparationError) throw preparationError;
        // Providers get a copy: mutations only become canonical through commit.
        const outcome = await stage.execute(structuredClone(page));
        if (outcome.page.id !== page.id || outcome.page.imagePath !== page.imagePath)
          throw new Error('Stage changed page identity');
        nextPage = outcome.page;
        status = outcome.status;
        if (outcome.status === 'failed') {
          failedPages.add(page.id);
          result.issues.push({ pageId: page.id, stage: stage.id, message: outcome.message, retryable: outcome.retryable });
        }
      } catch (error) {
        failedPages.add(page.id);
        result.issues.push({ pageId: page.id, stage: stage.id,
          message: error instanceof Error ? error.message : String(error), retryable: true });
      }
      chapter.pages[index] = nextPage;
      // Storage errors are infrastructure failures, not provider page issues.
      await persistence.commit(chapter);
      emit({ type: 'stage-end', runId: result.runId, pageId: page.id, stage: stage.id,
        status, elapsedMs: Math.round(performance.now() - started + preparationMsPerPage) });
    }
  }
  // Carrot run semantics: page issues => partial, infrastructure issues => failed.
  result.status = result.issues.length ? 'partial' : 'completed';
  emit({ type: 'run-end', runId: result.runId, status: result.status === 'completed' ? 'completed' : 'failed',
    elapsedMs: Math.round(performance.now() - runStarted) });
  await persistence.finish(result);
  return result;
}
