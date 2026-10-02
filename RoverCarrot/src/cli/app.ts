import { koharuRuntime, type KoharuRuntime } from '../adapters/koharu.js';
import { koharuDetectionStage } from '../adapters/detection.js';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../core/run.js';
import type { Persistence, Stage, StageId } from '../core/contracts.js';
import { libraryPersistence } from '../adapters/library.js';
import { smokeStages } from '../adapters/smoke.js';
import { ConfigError, loadOrCreateConfig } from './config-file.js';
import { RunLog } from './log.js';
import { StageProgress, stageLabel } from './progress.js';

export const EXIT = { pass: 0, fail: 1, configCreated: 2 } as const;
const USAGE = 'Usage: node dist/cli.js [--input <path>] [--output <path>]';

// dist/cli.js -> project root (RoverCarrot/), independent of the caller's CWD.
export function projectRootFrom(entryUrl: string | URL): string {
  return resolve(dirname(fileURLToPath(entryUrl)), '..');
}

// Internal entry used by dist/cli.js and tests. Config and logs are fixed under
// projectRoot; only input/output are resolved against cwd.
export type CliOptions = {
  argv: string[]; projectRoot: string; cwd: string; write: (text: string) => void;
  isTTY: boolean; env?: Record<string, string | undefined>;
  runtime?: KoharuRuntime;
  stages?: Stage[]; // tests only: inject failing providers
};

function parseArgs(argv: string[]): { input?: string; output?: string } {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!, value = argv[i + 1];
    if (!['--input', '--output'].includes(flag) || flag in options || value === undefined || value.startsWith('--'))
      throw new ConfigError(`Invalid arguments. ${USAGE}`);
    options[flag] = value;
  }
  return { input: options['--input'], output: options['--output'] };
}

function supportsUnicode(env: Record<string, string | undefined>): boolean {
  return /utf-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '');
}

export async function runCli(options: CliOptions): Promise<number> {
  const { projectRoot, cwd, write } = options;
  const show = (path: string, rootRelative = false) => {
    const base = rootRelative ? projectRoot : cwd;
    if (rootRelative && cwd !== projectRoot) return path;
    const rel = relative(base, path);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
  };
  const configPath = join(projectRoot, 'config', 'config.toml');
  const log = new RunLog(join(projectRoot, 'logs'));
  const details = show(join(log.dir, 'critical.log'), true);
  const fail = (lines: string[], afterTable = false) => {
    write(`${afterTable ? '\n' : ''}${['Result: FAIL', ...lines, `Details: ${details}`].join('\n')}\n`);
    return EXIT.fail;
  };
  let runtime: KoharuRuntime | undefined;
  try {
    log.info('cli-start', { argv: options.argv, cwd, configPath });
    let config;
    try {
      config = await loadOrCreateConfig(configPath, cwd, parseArgs(options.argv));
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      log.critical('config-invalid', { configPath, message: error.message, cause: String(error.cause ?? '') });
      return fail([`Reason: ${error.message}`]);
    }
    if (!config) {
      log.info('config-created', { configPath });
      write(`Config created: ${show(configPath, true)} — edit it and run again.\n`);
      return EXIT.configCreated;
    }
    log.info('run-start', { input: config.input, output: config.output, stages: config.stages });
    const progress = new StageProgress(config.stages, write, options.isTTY, supportsUnicode(options.env ?? process.env));
    const persistence = libraryPersistence();
    let started = false;
    const observed: Persistence = { ...persistence, async initialize(checked) {
      const chapter = await persistence.initialize(checked);
      started = true;
      log.info('input-materialized', { pages: chapter.pages.length, output: checked.output });
      progress.start(chapter.pages.length);
      return chapter;
    } };
    const stages = options.stages ?? smokeStages();
    if (!options.stages && config.stages.includes('detect')) {
      if (!options.runtime && !config.models?.koharu) throw new ConfigError('models.koharu must be a non-empty absolute path');
      runtime = options.runtime ?? koharuRuntime(config.models!.koharu, (type, fields) => log.info(type, fields));
      stages[stages.findIndex(stage => stage.id === 'detect')] = koharuDetectionStage(runtime, (type, fields) => log.info(type, fields));
    }
    const result = await run(config, { persistence: observed, stages,
      onEvent: event => { log.info(event.type, { ...event }); progress.event(event); } });
    await runtime?.close?.();
    runtime = undefined;
    log.info('run-result', { runId: result.runId, status: result.status, output: result.output, issues: result.issues });
    if (!started) {
      const message = result.issues[0]?.message ?? 'Run failed before stages started';
      log.critical('pre-stage-failure', { runId: result.runId, message, issues: result.issues });
      return fail([`Reason: ${message}`]);
    }
    const failed: StageId[] = progress.finish(result.status === 'failed' ? progress.inFlight() : undefined);
    if (result.status === 'completed') {
      write(`\nResult: PASS\nOutput: ${show(result.output)}\n`);
      return EXIT.pass;
    }
    for (const issue of result.issues) log.critical('run-issue', { runId: result.runId, ...issue });
    return fail(failed.length ? [`Failed: ${failed.map(stageLabel).join(', ')}`]
      : [`Reason: ${result.issues[0]?.message ?? 'Run failed'}`], true);
  } catch (error) {
    log.critical('unexpected-error', { message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined });
    return fail([`Reason: ${error instanceof Error ? error.message : String(error)}`]);
  } finally {
    try { await runtime?.close?.(); }
    catch (error) { log.critical('detect-session-release', { message: String(error) }); }
    log.close();
  }
}
