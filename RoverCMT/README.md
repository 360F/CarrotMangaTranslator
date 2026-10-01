# RoverCMT Linux Core

M1 Step 1 skeleton: independent TypeScript Core with a CLI adapter. All providers
are explicit no-ops. Successful smoke means orchestration and storage worked;
it does not mean Detection/OCR/Translation/Erase/Render ran.

Requires Node.js 24 or newer. From `RoverCMT/`:

```bash
npm ci --ignore-scripts
npm run check
npm run check:boundaries
```

Create a JSON config outside the repository (paths resolve relative to that file):

```json
{
  "version": 1,
  "mode": "smoke",
  "input": "pages",
  "output": "new-library",
  "stages": ["detect", "ocr", "translate", "typography", "erase", "layout", "render"]
}
```

```bash
npm run build
node dist/cli.js --config /absolute/path/config.json
```

Input is a PNG file or direct PNG files in a directory (natural filename order).
Output's parent must exist; output itself must not exist, including symlinks.
Source files are copied without modification. Step 1 probes PNG signatures and
IHDR dimensions; full decoding and archive/WebP import parity remain later work.
The output is an isolated Carrot library structure, not a GUI share ZIP.
Do not replace the index of an existing Carrot library with this output.

CLI emits JSONL progress/timing on stderr and one structured result on stdout;
exit 0 means completed smoke, exit 1 means failure/partial or invalid arguments.
`stages` chooses a subset, always executed in reference order. Every invocation
imports to a new output; stage selection is not saved-state resume. No implicit
skip/retry policy or subprocess output parsing is needed by programmatic callers.

Programmatic usage (after build):

```js
import { loadConfig } from './dist/core/config.js';
import { run } from './dist/core/run.js';
import { libraryPersistence } from './dist/adapters/library.js';
import { smokeStages } from './dist/adapters/smoke.js';
const result = await run(await loadConfig('/absolute/path/config.json'), {
  persistence: libraryPersistence(),
  stages: smokeStages(),
  onEvent: event => console.log(event),
});
```

Dependency direction: CLI composes adapters and invokes Core → pipeline → stage
contracts. Core and pipeline do not import adapters. A stage receives a page copy
and returns page state with completed/empty/failed; partial failures may return
useful page state. Providers declare state reads/writes and shared resources.
Orchestration owns order and skips subsequent stages on a failed page.
Page issues produce a partial run; infrastructure errors produce a failed run.
Stage progress is not Carrot translation-completion authority. No-op execution
leaves imported pages and chapters idle. Diagnostics live in `runs/<runId>.json`.

Persistence publishes index last and uses file rename for chapter writes. It is
not a durable multi-file transaction. Translation memory commits and crash recovery
must be implemented/validated when real translation arrives in Step 4; the Step 1
port accepts only page state. Input/output setup failures are returned in the result
but may leave a newly created, incomplete output directory for inspection. Existing
outputs are never cleaned, reused or overwritten.

Loader analysis and Windows transfer limits:
[Carrot contract](docs/analysis/CARROT_LOADER_OUTPUT_CONTRACT.md).
Current scope and next checkpoint:
[M1 implementation plan](docs/milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md).
