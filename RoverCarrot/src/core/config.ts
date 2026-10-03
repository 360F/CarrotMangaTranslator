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
  if (Object.keys(value).some(key => !['version', 'mode', 'input', 'output', 'stages', 'models', 'ocr'].includes(key)))
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
  let ocr: Config['ocr'];
  if (value.ocr !== undefined) {
    const o = value.ocr as Record<string, unknown>;
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some(k => !['python', 'hfCache', 'device', 'sourceLanguage', 'timeoutMs'].includes(k))) throw new Error('Unknown OCR config field');
    for (const k of ['python', 'hfCache', 'device', 'sourceLanguage'])
      if (o[k] !== undefined && typeof o[k] !== 'string') throw new Error(`ocr.${k} must be a string`);
    if (o.device !== undefined && !/^(cpu|gpu(?::[0-9]+)?)$/.test(String(o.device))) throw new Error('ocr.device must be cpu or gpu[:index]');
    if (o.timeoutMs !== undefined && (!Number.isSafeInteger(o.timeoutMs) || Number(o.timeoutMs) <= 0)) throw new Error('ocr.timeoutMs must be positive integer');
    if (o.python || o.hfCache) {
      for (const k of ['python', 'hfCache']) if (typeof o[k] !== 'string' || !isAbsolute(o[k] as string)) throw new Error(`ocr.${k} must be an absolute path`);
      if (typeof o.device !== 'string' || !/^(cpu|gpu(?::[0-9]+)?)$/.test(o.device)) throw new Error('ocr.device must be cpu or gpu[:index]');
      if (typeof o.sourceLanguage !== 'string' || !o.sourceLanguage.trim()) throw new Error('ocr.sourceLanguage is required');
      ocr = { python: o.python as string, hfCache: o.hfCache as string, device: o.device, sourceLanguage: o.sourceLanguage, ...(o.timeoutMs !== undefined ? { timeoutMs: Number(o.timeoutMs) } : {}) };
    }
  }
  return { ...(ocr ? { ocr } : {}), ...(models ? { models } : {}), version: 1, mode: 'smoke', input, output, stages: STAGES.filter(id => (stages as StageId[]).includes(id)) };
}
