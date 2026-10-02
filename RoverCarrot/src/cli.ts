import { projectRootFrom, runCli } from './cli/app.js';

runCli({ argv: process.argv.slice(2), projectRoot: projectRootFrom(import.meta.url), cwd: process.cwd(),
  write: text => process.stdout.write(text), isTTY: Boolean(process.stdout.isTTY) })
  .then(code => { process.exitCode = code; }, error => {
    // Last resort (e.g. logs/ not writable): still no stack trace or raw JSON.
    process.stdout.write(`Result: FAIL\nReason: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
