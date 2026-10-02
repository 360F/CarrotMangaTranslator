# RoverCMT Linux Core

M1 Step 1 skeleton: independent TypeScript Core with a CLI adapter. All providers
are explicit no-ops. Successful smoke means orchestration and storage worked;
it does not mean Detection/OCR/Translation/Erase/Render ran.

Requires Node.js 24 or newer. From `RoverCarrot/`:

```bash
npm ci --ignore-scripts
npm run check
npm run check:boundaries
npm run smoke
```

Run commands from `RoverCarrot/`. The only user config is `config/config.toml`
(Git-ignored). It is always read from the project root, wherever you run the
command. If it is missing, the first run writes a commented default, prints
`Config created: config/config.toml — edit it and run again.` and exits with
code 2 without processing anything. Edit it and run again:

```toml
version = 1
mode = "smoke"

[paths]
input = "test-data/input/example"        # relative to the current directory
output = "test-data/output/example-run"  # must not exist yet

[pipeline]
stages = ["detect", "ocr", "translate", "typography", "erase", "layout", "render"]
```

`[paths]` values are defaults. `--input`/`--output` override them for one run
(CLI value first, else config value; a run fails before creating output if
neither provides one). Relative input/output paths resolve against the current
working directory; absolute paths are used as is.

```bash
npm run build
node dist/cli.js
node dist/cli.js --input test-data/input/other-comic
node dist/cli.js --output test-data/output/run-002
```

The terminal shows only stage progress (pages done / total), PASS/FAIL, the
result and the output path. Interactive terminals update the rows in place;
pipes and CI get one line per finished stage. Exit codes: 0 PASS, 1 FAIL, 2
config created. Logs are fixed at `<project root>/logs/` (Git-ignored):
`log_all.log` has the full JSONL detail (run/page IDs, stage events, timing,
errors), `critical.log` only failures and errors. They are capped at 10 MiB and
5 MiB by dropping the oldest whole lines (no backups). On failure the CLI prints
`Details:` with the critical log path (absolute when run outside the project root).

Input is a PNG, JPEG (`.jpg`/`.jpeg`/`.jfif`) or WebP file, or a directory
containing these images. Direct files form one naturally ordered page sequence;
unsupported files and subdirectories are ignored (no recursive import).
Extensions are case-insensitive. Sharp validates the actual format and fully decodes
pixels before output creation; corrupt images and extension/format mismatches fail
the import. Width/height describe the stored raster, without EXIF auto-rotation.
Animated images are currently rejected. Original bytes are copied unchanged with
the corresponding extension; JFIF is stored as `.jpg` using the JPEG decoder.
Output's parent must exist; output itself must not exist, including symlinks.
Archive/URL/PDF import is not implemented; future scope and reference sources are
in the [input materialization direction](docs/milestones/M1_LINUX_PORT/IMPLEMENTATION_PLAN.md#input-materialization-direction).
The output is an isolated Carrot library structure, not a GUI share ZIP.
Do not replace the index of an existing Carrot library with this output.

`stages` chooses a subset, always executed in reference order. Every invocation
imports to a new output; stage selection is not saved-state resume. Programmatic
callers get the structured result from `run()` and need no CLI output parsing.

Programmatic usage (after build):

```js
import { resolveConfig } from './dist/core/config.js';
import { run } from './dist/core/run.js';
import { libraryPersistence } from './dist/adapters/library.js';
import { smokeStages } from './dist/adapters/smoke.js';
const config = resolveConfig({ version: 1, mode: 'smoke', input: 'pages', output: 'library' }, '/abs/base');
const result = await run(config, {
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

`npm run smoke` builds and runs the repository's input/CLI smoke validation with
small synthetic fixtures in `tests/fixtures/` (including its own TOML test configs).
CLI tests use a temporary project root, so they never read or write the real
`config/config.toml` or `logs/`. They check exit codes, persisted run JSON,
output files and logs, plus formats, ordering, copied bytes, overrides and
failures. For your own data, use the CLI above.

For private manual validation, use `test-data/input/` and `test-data/output/`.
The entire `test-data/` tree is Git-ignored; do not force-add it. Small
distributable automated fixtures belong in `tests/fixtures/`, separate from real
comics, personal data and large files. Empty directories are not committed, so
initialize them after a fresh checkout:

```bash
mkdir -p test-data/input test-data/output
cp -a /path/to/comic test-data/input/
```

Point `input` in `config/config.toml` at that folder (for example
`test-data/input/comic`), or pass `--input` for a one-off run. Inspect the library
under the output path in `test-data/output/`. Existing outputs are refused, so
use a new `--output` (or a new config default) for each run. These runs still
use no-op stages and produce no translated raster. Local data is user-owned and
must be preserved.
