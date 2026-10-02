import { randomUUID } from 'node:crypto';
import type { Config, Event, Persistence, RunResult, Stage } from './contracts.js';
import { resolveConfig } from './config.js';
import { executePipeline } from '../pipeline/run.js';

export async function run(config: Config, options: {
  persistence: Persistence; stages: Stage[]; onEvent?: (event: Event) => void;
}): Promise<RunResult> {
  const checked = resolveConfig(config, process.cwd());
  const result: RunResult = { runId: randomUUID(), mode: 'smoke', status: 'failed',
    output: checked.output, issues: [], events: [] };
  const onEvent = options.onEvent ?? (() => {});
  try {
    const stages = checked.stages.map(id => {
      const matches = options.stages.filter(stage => stage.id === id);
      if (matches.length !== 1) throw new Error(`Expected one implementation for ${id}`);
      return matches[0]!;
    });
    const chapter = await options.persistence.initialize(checked);
    return await executePipeline(chapter, stages, options.persistence, result, onEvent);
  } catch (error) {
    result.status = 'failed';
    result.issues.push({ message: error instanceof Error ? error.message : String(error), retryable: true });
    return result;
  }
}
