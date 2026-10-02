import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { STAGES, type Config, type StageId } from './contracts.js';

export type PathOverrides = { input?: string; output?: string };

function pathValue(name: string, override: unknown, configured: unknown, base: string): string {
  for (const [source, value] of [['override', override], ['config', configured]] as const) {
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${source} ${name} must be a non-empty path`);
    return resolve(base, value);
  }
  throw new Error(`${name} path is required (config "${name}" or --${name})`);
}

// Relative input/output paths resolve against `base` (the CWD for loadConfig/CLI),
// never against the config file location. Overrides take precedence over config values.
export function resolveConfig(raw: unknown, base: string = process.cwd(), overrides: PathOverrides = {}): Config {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config must be an object');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['version', 'mode', 'input', 'output', 'stages'].includes(key)))
    throw new Error('Unknown config field');
  if (value.version !== 1 || value.mode !== 'smoke') throw new Error('Step 1 requires version=1, mode=smoke');
  const input = pathValue('input', overrides.input, value.input, base);
  const output = pathValue('output', overrides.output, value.output, base);
  const stages = value.stages ?? [...STAGES];
  if (!Array.isArray(stages) || !stages.length ||
      stages.some(id => !STAGES.includes(id)) || new Set(stages).size !== stages.length)
    throw new Error('stages must contain unique known stage IDs');
  return { version: 1, mode: 'smoke', input, output, stages: STAGES.filter(id => (stages as StageId[]).includes(id)) };
}
export async function loadConfig(path: string, overrides: PathOverrides = {}): Promise<Config> {
  return resolveConfig(JSON.parse(await readFile(resolve(path), 'utf8')), process.cwd(), overrides);
}
