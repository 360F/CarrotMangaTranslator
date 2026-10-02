import { loadConfig } from './core/config.js';
import { run } from './core/run.js';
import { libraryPersistence } from './adapters/library.js';
import { smokeStages } from './adapters/smoke.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--config') throw new Error('Usage: node dist/cli.js --config <config.json>');
  const config = await loadConfig(args[1]!);
  const result = await run(config, { persistence: libraryPersistence(), stages: smokeStages(),
    onEvent: event => process.stderr.write(JSON.stringify(event) + '\n') });
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.status === 'completed' ? 0 : 1;
}
main().catch(error => {
  process.stderr.write(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
});
