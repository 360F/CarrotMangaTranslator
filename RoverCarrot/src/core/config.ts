import { isAbsolute, resolve } from 'node:path';
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

// Relative input/output paths resolve against `base` (the CLI passes its CWD),
// never against the config file location. Overrides take precedence over config values.
export function resolveConfig(raw: unknown, base: string = process.cwd(), overrides: PathOverrides = {}): Config {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config must be an object');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['version', 'mode', 'input', 'output', 'stages', 'models'].includes(key)))
    throw new Error('Unknown config field');
  if (value.version !== 1 || value.mode !== 'smoke') throw new Error('Step 1 requires version=1, mode=smoke');
  const input = pathValue('input', overrides.input, value.input, base);
  const output = pathValue('output', overrides.output, value.output, base);
  const stages = value.stages ?? [...STAGES];
  if (!Array.isArray(stages) || !stages.length ||
      stages.some(id => !STAGES.includes(id)) || new Set(stages).size !== stages.length)
    throw new Error('stages must contain unique known stage IDs');
  let models: Config['models'];
  if (value.models !== undefined) {
    const model = value.models as Record<string, unknown>;
    if (!model || typeof model !== 'object' || Array.isArray(model) || Object.keys(model).some(key => key !== 'koharu'))
      throw new Error('models must contain only koharu');
    if (typeof model.koharu !== 'string') throw new Error('models.koharu must be a string');
    if (model.koharu.trim()) {
      if (!isAbsolute(model.koharu)) throw new Error('models.koharu must be an absolute path');
      models = { koharu: model.koharu };
    }
  }
  return { ...(models ? { models } : {}), version: 1, mode: 'smoke', input, output, stages: STAGES.filter(id => (stages as StageId[]).includes(id)) };
}
