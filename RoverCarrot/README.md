# RoverCMT Linux Core

Independent TypeScript Core with a CLI adapter. Detection runs pinned Koharu
on Linux CPU; OCR runs pinned Hayai v2 through a configured Python environment.
Translation, typography, erase, layout and rendering remain explicit no-ops.
Current validation is in [Step 3 validation](docs/milestones/M1_LINUX_PORT/STEP3_VALIDATION.md).

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

[models]
# Absolute path to the verified rfdetr-seg-2xlarge.onnx file.
koharu = ""

[ocr]
# Absolute paths to a preinstalled Python 3.12 venv and writable HF cache.
python = ""
hfCache = ""
device = "cpu"                 # or "gpu" / "gpu:0"; no CPU fallback
sourceLanguage = "ja"
# timeoutMs = 3600000          # default max(1 hour, 5 minutes * batch pages)
```

Set `[models].koharu` to an existing absolute model path before running detect.
Empty, relative, missing or wrong model files fail clearly. RoverCMT verifies the
pinned filename, byte size and SHA-256 and never copies or downloads the model.
The template deliberately contains no personal path.

OCR requires `[ocr].python` and `[ocr].hfCache` when selected. Prepare a Linux
Python 3.12 environment from the hash lock; Rover does not install Python or
packages. Provision uv **0.12.22** from its PyPI Linux x86_64 wheel and
CPython **3.12.15** via uv's python-build-standalone download, all under durable,
Git-ignored `test-data/runtime/` (no `$HOME` writes). From `RoverCarrot/`:

```bash
mkdir -p test-data/runtime
python3 - <<'PYTHON'
import json, pathlib, urllib.request, zipfile
root = pathlib.Path('test-data/runtime')
meta = json.load(urllib.request.urlopen('https://pypi.org/pypi/uv/0.12.22/json'))
wheel = next(f for f in meta['urls'] if f['filename'] ==
    'uv-0.12.22-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl')
path = root / wheel['filename']
urllib.request.urlretrieve(wheel['url'], path)
with zipfile.ZipFile(path) as archive:
    archive.extractall(root / 'uv')
(root / 'uv/uv-0.12.22.data/scripts/uv').chmod(0o755)
PYTHON
OCR_UV="$PWD/test-data/runtime/uv/uv-0.12.22.data/scripts/uv"
export UV_CACHE_DIR="$PWD/test-data/runtime/uv-cache"
export UV_PYTHON_INSTALL_DIR="$PWD/test-data/runtime/python"
export UV_PYTHON_BIN_DIR="$PWD/test-data/runtime/bin"
"$OCR_UV" python install 3.12.15
OCR_PYTHON="$UV_PYTHON_INSTALL_DIR/cpython-3.12.15-linux-x86_64-gnu/bin/python3.12"
"$OCR_UV" venv --python "$OCR_PYTHON" test-data/runtime/hayai-cpu
"$OCR_UV" pip sync --python test-data/runtime/hayai-cpu/bin/python \
  --require-hashes --index https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
  runtime/hayai/requirements-cpu-linux.lock
```

For CUDA use `requirements-cu130-linux.lock`, the `cu130` index and a separate
venv. Set config paths to their absolute locations. The worker fetches only the
pinned Hayai/processor files into the configured cache and verifies all 11 sizes
and SHA-256 values before loading. Offline use also needs cached Hub tree metadata
and the processor `refs/main` pointing to its pinned revision; see Step 3 evidence.
Never point a writable cache at the read-only Carrot reference cache.

All selected pages are prepared in one OCR batch. The detector session closes
before OCR; OCR process closure precedes the next stage. JSONL progress and raw
outputs live under `<output>/ocr-artifacts/`, with process details in the run log.
Storage preserves Carrot sanitize (Japanese noise/ruby rules, glossary omission,
160-character prefix plus truncation notice) and the 80-hint cap. Failed reads
persist empty `sourceText` and `workflowOrigin.ocrFailure`, fail that page and
skip its later stages. `recognitionSegments` remain available to later ports.

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
import { koharuRuntime } from './dist/adapters/koharu.js';
import { koharuDetectionStage } from './dist/adapters/detection.js';
const config = resolveConfig({ version: 1, mode: 'smoke', input: 'pages', output: 'library', stages: ['detect'],
  models: { koharu: '/absolute/path/to/rfdetr-seg-2xlarge.onnx' } }, '/abs/base');
const runtime = koharuRuntime(config.models.koharu);
try {
  const result = await run(config, {
    persistence: libraryPersistence(),
    stages: smokeStages().map(stage => stage.id === 'detect' ? koharuDetectionStage(runtime) : stage),
    onEvent: event => console.log(event),
  });
} finally { await runtime.close(); }
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
failures. Fake raw inference is injected only through internal API arguments;
the real parser, postprocessing, Detection/OCR stages and persistence still run. OCR text is injected through the internal `ocrRead` test argument.
The executable's config creation and failure paths remain subprocess tests.
No real model or private data is required for `npm test` or `npm run smoke`.
For your own data, use the CLI above.

Real-model developer validation is separate (missing artifacts fail):

```bash
npm run validate:detect -- --model <KOHARU_MODEL> --data-root <CARROT_DATA_ROOT>
```

Provide a local ignored validation context as described in
[Step 2 validation](docs/milestones/M1_LINUX_PORT/STEP2_VALIDATION.md).

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
use a new `--output` (or a new config default) for each run. Detection and OCR run actual models. Managed translation runs when configured; typography/erase/layout/render remain smoke stages and produce no translated raster. Local data is user-owned and
must be preserved.

Worker recovery/device tests (no Python packages or model required):

```bash
python3 -m unittest discover -s tests/python -v
```


## Managed translation (Step 4)

The pinned Linux llama.cpp/CUDA recipe and production translation stage are implemented.
Real GPU build/model-load validation is assigned to the orchestrator; see the validation
record below. Without translation asset paths, the existing model-free smoke stage
remains available. Configure the managed backend to perform actual translation.

From `RoverCarrot/`, provision repository-local tools and configure both builds:

```bash
python3 runtime/llama/build.py
```

Compile the CUDA backend and the separate server/CPU backend build:

```bash
python3 runtime/llama/build.py --build --jobs 2
```

Large artifacts stay under ignored `test-data/runtime/llama-b9553/`.
No sudo, system package installation or Windows runtime archive is used.
The recipe verifies pinned archive/wheel sizes and SHA-256s. The output is
`test-data/runtime/llama-b9553/bin/llama-server`, its shared libraries, and
`binary-identity.json`. CUDA 13.3 is mandatory. Default b9553 CUDA architectures
and the reference x64 CPU variants are retained. WSL's host driver library is
used for linking when present. An archive build reports unknown Git build info;
source identity must be verified against `runtime/llama/pins.json`, not inferred
from that version string. See
[Step 4 validation](docs/milestones/M1_LINUX_PORT/STEP4_VALIDATION.md) for actual
validation status, deviations and GPU acceptance still pending.


Add `[translation]` to `config/config.toml` and select `stages = ["detect", "ocr", "translate"]`:

```toml
[translation]
backend = "managed"
runtimeProfile = "rtx50"
serverPath = "/absolute/repository/RoverCarrot/test-data/runtime/llama-b9553/bin/llama-server"
modelPath = "/absolute/models/gemma-4-26B-A4B-it-ultra-uncensored-heretic.Q6_K.gguf"
mmprojPath = "/absolute/models/gemma-4-26B-A4B-it-ultra-uncensored-heretic.mmproj-Q8_0.gguf"
modelIdentityPath = "/absolute/model-identity.json"
port = 18180
sourceLanguage = "ja"
targetLanguage = "ko"
cumulative = true
cumulativeDetail = "detailed"
export = true
```

The identity receipt is an array of `{path, bytes, sha256, mtimeNs}` entries for
model and mmproj, matching `runtime/llama/model-pins.json`. Keep `mtimeNs` as a
string when producing a new receipt. Hash each user-owned model once; subsequent
preflight binds its path, pinned hash, size and exact modification time without
copying or repeatedly hashing it. Changed files require identity verification.
Binary/shared-library inventories and the chat template are verified each page.
Rover owns one localhost llama-server child per page, retries within that session,
and closes it before the next page. Occupied ports are refused.

Run `npm run build` then `node dist/cli.js --input /absolute/comic --output /absolute/new-output`.
Public CLI flags and the default config location are unchanged. The orchestrator
can use `node tools/translation-smoke.mjs e2e /absolute/validation-config.toml`
to run the same production CLI with an isolated config.

OCR `sourceText` and block geometry remain canonical. Accepted translations and
memory are published through persistence before constructing the next page's
request. Work `style-guide.json`, chapter `story-memory.json` and translation
artifacts are under the new output. A durable `.transactions/` journal allows
explicit roll-forward after interrupted publication (see the validation record);
output directories are still never resumed or overwritten automatically.
JSON/CSV exports are under `exports/<chapter>/`; `exportRoot` optionally selects
an absolute root and reserves a fresh folder. Export failures are warnings.
`styleGuidePath` imports a work guide; `previousStoryPath` plus
`previousChapterPath` imports a previous chapter's live story pages. These inputs
are read-only and their work identity is rebound to the new isolated output.
No full historical work-context snapshot is added to per-request artifacts.
