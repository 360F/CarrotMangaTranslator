import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { STAGES, type Config, type StageId } from './contracts.js';

export function resolveConfig(raw: unknown, base: string): Config {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config must be an object');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['version', 'mode', 'input', 'output', 'stages'].includes(key)))
    throw new Error('Unknown config field');
  if (value.version !== 1 || value.mode !== 'smoke') throw new Error('Step 1 requires version=1, mode=smoke');
  if (typeof value.input !== 'string' || !value.input.trim() ||
      typeof value.output !== 'string' || !value.output.trim()) throw new Error('input/output paths are required');
  const stages = value.stages ?? [...STAGES];
  if (!Array.isArray(stages) || !stages.length ||
      stages.some(id => !STAGES.includes(id)) || new Set(stages).size !== stages.length)
    throw new Error('stages must contain unique known stage IDs');
  return { version: 1, mode: 'smoke', input: resolve(base, value.input),
    output: resolve(base, value.output), stages: STAGES.filter(id => (stages as StageId[]).includes(id)) };
}
export async function loadConfig(path: string): Promise<Config> {
  const absolute = resolve(path);
  return resolveConfig(JSON.parse(await readFile(absolute, 'utf8')), dirname(absolute));
}
