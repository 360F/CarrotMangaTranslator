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
  if (Object.keys(value).some(key => !['version', 'mode', 'input', 'output', 'stages', 'models', 'ocr', 'translation', 'typography'].includes(key)))
    throw new Error('Unknown config field');
  if (value.version !== 1 || value.mode !== 'smoke') throw new Error('Step 1 requires version=1, mode=smoke');
  const input = pathValue('input', overrides.input, value.input, base);
  const output = pathValue('output', overrides.output, value.output, base);
  const stages = value.stages ?? [...STAGES];
  if (!Array.isArray(stages) || !stages.length ||
      stages.some(id => !STAGES.includes(id)) || new Set(stages).size !== stages.length)
    throw new Error('stages must contain unique known stage IDs');
  let typography: Config['typography'];
  if (value.typography !== undefined) {
    const t = value.typography as Record<string, unknown>;
    if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).some(k => !['autoFont', 'autoSize', 'bubbleLayout', 'naturalLayout', 'overwrite'].includes(k))) throw new Error('Unknown typography config field');
    if (t.autoFont !== undefined && t.autoFont !== false) throw new Error('autoFont=true awaits D17');
    for (const key of ['autoSize', 'bubbleLayout', 'naturalLayout']) if (t[key] !== undefined && typeof t[key] !== 'boolean') throw new Error(`typography.${key} must be boolean`);
    if (t.overwrite !== undefined && (!Array.isArray(t.overwrite) || t.overwrite.some(k => !['typography', 'layout'].includes(k)) || new Set(t.overwrite).size !== t.overwrite.length)) throw new Error('typography.overwrite must contain unique typography/layout IDs');
    typography = t as Config['typography'];
  }
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
  let translation: Config['translation'];
  if (value.translation !== undefined) {
    const t = value.translation as Record<string, unknown>;
    const keys = ['backend', 'serverPath', 'modelPath', 'mmprojPath', 'modelIdentityPath', 'runtimeProfile', 'port',
      'sourceLanguage', 'targetLanguage', 'cumulative', 'cumulativeDetail', 'styleGuidePath', 'previousStoryPath', 'previousChapterPath', 'export', 'exportRoot', 'readingDirection'];
    if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).some(k => !keys.includes(k))) throw new Error('Unknown translation config field');
    if (t.serverPath || t.modelPath || t.mmprojPath) {
      if (t.backend !== 'managed' || t.runtimeProfile !== 'rtx50') throw new Error('Translation requires managed backend and rtx50 runtime profile (D32/D33)');
      for (const key of ['serverPath', 'modelPath', 'mmprojPath', 'modelIdentityPath'])
        if (typeof t[key] !== 'string' || !isAbsolute(t[key] as string)) throw new Error(`translation.${key} must be an absolute path`);
      for (const key of ['styleGuidePath', 'previousStoryPath', 'previousChapterPath', 'exportRoot'])
        if (t[key] !== undefined && (typeof t[key] !== 'string' || !isAbsolute(t[key] as string))) throw new Error(`translation.${key} must be an absolute path`);
      if (t.port !== undefined && (!Number.isInteger(t.port) || Number(t.port) < 1 || Number(t.port) > 65535)) throw new Error('translation.port must be 1..65535');
      for (const key of ['sourceLanguage', 'targetLanguage'])
        if (t[key] !== undefined && (typeof t[key] !== 'string' || !/^[a-z]{2,3}(-[a-zA-Z0-9]{1,16})*$/.test(t[key] as string))) throw new Error(`Invalid translation.${key}`);
      for (const key of ['cumulative', 'export']) if (t[key] !== undefined && typeof t[key] !== 'boolean') throw new Error(`translation.${key} must be boolean`);
      if (t.cumulativeDetail !== undefined && !['detailed', 'essential'].includes(String(t.cumulativeDetail))) throw new Error('Invalid cumulativeDetail');
      if (t.readingDirection !== undefined && !['rtl', 'ltr'].includes(String(t.readingDirection))) throw new Error('Invalid readingDirection');
      translation = t as Config['translation'];
    }
  }
  return { ...(typography ? { typography } : {}), ...(translation ? { translation } : {}), ...(ocr ? { ocr } : {}), ...(models ? { models } : {}), version: 1, mode: 'smoke', input, output, stages: STAGES.filter(id => (stages as StageId[]).includes(id)) };
}
