import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse } from 'smol-toml';
import { resolveConfig, type PathOverrides } from '../core/config.js';
import type { Config } from '../core/contracts.js';

// Written to config/config.toml when it does not exist. Keep it free of personal paths.
export const CONFIG_TEMPLATE = `# RoverCMT configuration (the only user config file).
# Edit the values below, then run: node dist/cli.js

version = 1
mode = "smoke"

[paths]
# Input manga page folder or single image.
# Relative paths resolve from the directory where you run the command.
# --input <path> overrides this for one run.
input = "test-data/input/example"

# Output directory. It must not already exist.
# --output <path> overrides this for one run.
output = "test-data/output/example-run"

[pipeline]
# Stages run in the fixed reference order. Optional extra stages:
# "source-rules", "translation-rules", "format-rules", "review".
stages = ["detect", "ocr", "translate", "typography", "erase", "layout", "render"]

[models]
# Absolute path to the Koharu ONNX model (no automatic download).
koharu = ""

[ocr]
# Preinstalled Python 3.12 venv executable and writable Hugging Face cache.
python = ""
hfCache = ""
device = "cpu"
sourceLanguage = "ja"

[translation]
backend = "managed"
runtimeProfile = "rtx50"
# Absolute paths to recipe output, user-owned Q6_K/mmproj and identity receipt.
serverPath = ""
modelPath = ""
mmprojPath = ""
modelIdentityPath = ""
port = 18180
sourceLanguage = "ja"
targetLanguage = "ko"
cumulative = true
cumulativeDetail = "detailed"
export = true
# Optional: styleGuidePath, previousStoryPath + previousChapterPath, exportRoot (absolute paths).
`;

export class ConfigError extends Error {}

function table(value: unknown, name: string, keys: string[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConfigError(`[${name}] must be a table`);
  const unknown = Object.keys(value).filter(key => !keys.includes(key));
  if (unknown.length) throw new ConfigError(`Unknown key in [${name}]: ${unknown.join(', ')}`);
  return value as Record<string, unknown>;
}

// TOML document -> flat Core config. Relative input/output resolve against `cwd`.
export function parseConfigToml(text: string, cwd: string, overrides: PathOverrides = {}): Config {
  let doc: Record<string, unknown>;
  try {
    doc = parse(text);
  } catch (error) {
    const first = (error instanceof Error ? error.message : String(error)).split('\n')[0];
    throw new ConfigError(`Invalid TOML: ${first}`, { cause: error });
  }
  const top = table(doc, 'top level', ['version', 'mode', 'paths', 'pipeline', 'models', 'ocr', 'translation']);
  const paths = table(top.paths, 'paths', ['input', 'output']);
  const pipeline = table(top.pipeline, 'pipeline', ['stages']);
  const models = table(top.models, 'models', ['koharu']);
  const ocr = table(top.ocr, 'ocr', ['python', 'hfCache', 'device', 'sourceLanguage', 'timeoutMs']);
  const translation = table(top.translation, 'translation', ['backend', 'serverPath', 'modelPath', 'mmprojPath', 'modelIdentityPath',
    'runtimeProfile', 'port', 'sourceLanguage', 'targetLanguage', 'cumulative', 'cumulativeDetail', 'styleGuidePath', 'previousStoryPath', 'previousChapterPath', 'export', 'exportRoot', 'readingDirection']);
  const raw: Record<string, unknown> = { version: top.version, mode: top.mode };
  for (const [key, value] of [['input', paths.input], ['output', paths.output], ['stages', pipeline.stages]] as const)
    if (value !== undefined) raw[key] = value;
  if (top.translation !== undefined) raw.translation = translation;
  if (top.ocr !== undefined) raw.ocr = ocr;
  if (top.models !== undefined) raw.models = models;
  try {
    return resolveConfig(raw, cwd, overrides);
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error));
  }
}

// Returns null after creating the default file: the caller must stop without running.
export async function loadOrCreateConfig(path: string, cwd: string, overrides: PathOverrides): Promise<Config | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, CONFIG_TEMPLATE, { flag: 'wx' });
    return null;
  }
  return parseConfigToml(text, cwd, overrides);
}
