import { loadConfig } from './core/config.js';
import { run } from './core/run.js';
import { libraryPersistence } from './adapters/library.js';
import { smokeStages } from './adapters/smoke.js';

async function main() {
  const usage = 'Usage: node dist/cli.js --config <config.json> [--input <path>] [--output <path>]';
  const args = process.argv.slice(2), options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!, value = args[i + 1];
    if (!['--config', '--input', '--output'].includes(flag) || flag in options || value === undefined || value.startsWith('--')) throw new Error(usage);
    options[flag] = value;
  }
  if (!options['--config']) throw new Error(usage);
  const config = await loadConfig(options['--config'], { input: options['--input'], output: options['--output'] });
  const result = await run(config, { persistence: libraryPersistence(), stages: smokeStages(),
    onEvent: event => process.stderr.write(JSON.stringify(event) + '\n') });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'completed' ? 0 : 1;
}
main().catch(error => {
  process.stderr.write(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
});
