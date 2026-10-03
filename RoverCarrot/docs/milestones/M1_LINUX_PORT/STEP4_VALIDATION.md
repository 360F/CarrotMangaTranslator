# Step 4 — Translation validation

Implementation baseline: `f3a8f570`; reference fork `fd461737`.
**Phase 2 implementation and deterministic validation complete; GPU acceptance pending.**
The initial session below implemented provisioning/configure only. Phase 2 added
the production translation path, persistence and export without changing that recipe.
No completed full CUDA build, GPU validation or natural-language exact parity is claimed.
Claude owns build/GPU acceptance and handoff/ledger changes.

## Reference and observable contracts

Managed dispatch: runtimeModules.ts → simple-page-model-config.cjs →
model/runtime-profile.cjs → model/launch-arguments.cjs →
transport/llama-server-process.cjs and llama-server-readiness.cjs.
D32 selects local Q6_K, mainline b9553, CUDA 13.3, economy26b, no draft.
D33 requires repository-local tools, owned child lifecycle and no runtime substitution.

Translation: pageWorkflowTranslation.ts → wholePagePipeline.ts →
translatePageWithRetries.ts → pageResultBuilder.ts → simple-page-request-builders.cjs,
transport/translation-request.cjs, runtime/prompts and runtime/parsing.
Preserve original image, sourceText grounding, keep-block merge, retry semantics,
page-scoped endpoint ownership and sequential memory dependency.
Memory: pageContextPersistence.ts, cumulativePageContext.ts, storyMemoryBuilder.ts.
Exports: linkedWorkspaceTranslationJson.ts and linkedWorkspaceFiles.ts.

## Claude orchestrator verification

Run by Claude (orchestrator) outside the implementation sandbox on 2026-10-03. First-pass check only; the workflow's fresh independent review is **deferred** ([Deferred Review Ledger](IMPLEMENTATION_PLAN.md#deferred-review-ledger)). Evidence is Git-ignored under `test-data/validation/m1-step4/` (`claude-build/`, `claude-gpu-r1/`, `claude-gpu-r2/`).

**Build (D33).** `python3 runtime/llama/build.py --build --jobs 16` (detached; `claude-build/build.log`, `build.exit`): exit 0, 797/797 ninja steps, 2026-10-03 15:41–15:50 KST. Source llama.cpp `b9553` = `9e3b928fd8c9d14dbf15a8768b9fdd7e5c721d66`, repository-local CUDA 13.3 components and cmake/ninja from `runtime/llama/pins.json`, GCC 15.2.0, options as in "Build recipe" above (`--jobs` only changes parallelism). `bin/llama-server` SHA-256 `2694241e2a49fc1ed7982652d2cae7c1dc6d86fad720d29947a0a4e40cf13be6`; `libggml-cuda.so` 166,825,920 bytes, SHA-256 `777e09b58e188fe06b86346a5cc4539f2f954ee7dc9a27c55a15f1050acfe8b5`; full inventory in the Git-ignored `test-data/runtime/llama-b9553/binary-identity.json`. `--version` reports `0 (unknown)` (archive build without Git metadata); the source manifest is authoritative. `--list-devices`: `CUDA0: NVIDIA GeForce RTX 5090 (32579 MiB)`.

**Model (D32).** `gemma-4-26B-A4B-it-ultra-uncensored-heretic.Q6_K.gguf` 22,638,395,104 bytes, SHA-256 `e4c38e73b587b26271cd689e7c4ec7c4b8a29d45149b3f2c12755972a204e095`; mmproj `gemma-4-26B-A4B-it-ultra-uncensored-heretic.mmproj-Q8_0.gguf` 806,408,544 bytes, SHA-256 `b9dd7e71eb78b44c4c9d3a0aa6173a1e022c2c4f58aa0fd03807be3f8cba4353` (user model directory, read-only; path only in ignored evidence). Runtime profile `rtx50` → mainline b9553 / CUDA 13.3. Launch arguments as listed in "D32 model identity and resolved launch".

**GPU operations.** For each run the user's `gemma-heretic` llama-server container was identified (ID `37542310ef62…`, image `ghcr.io/ggml-org/llama.cpp:server-cuda`, restart `unless-stopped`, host port 8081), stopped with `docker stop` and restored with `docker start` of the same ID by a trap; after each run it was `running`/`healthy` with `/health` and `/v1/models` returning 200 (`claude-gpu-r*/container/`). No Rover llama-server or Hayai worker remained afterwards (`orphans-after-*.txt` empty). No other container or process was touched.

| Check | Result | Evidence |
|---|---|---|
| Run 1 (before rework): `tools/translation-smoke.mjs lifecycle` / `e2e` | exit 0 / exit 0; translation worked, but owned stops used SIGINT→SIGTERM 250 ms apart: 4 of 5 lifecycle stops exited 1 ("second interrupt"), one E2E stop needed SIGKILL → finding F1, fixed in rework cycle 1 | `claude-gpu-r1/` |
| Run 2 lifecycle (after rework) | exit 0. Real page translated; normal stops (3) SIGTERM → exit 0; abort during model load SIGTERM → terminated without SIGKILL; launch with a missing model exits 1 by itself and is cleaned; restart after stop works | `claude-gpu-r2/lifecycle.log`, `lifecycle-output/lifecycle-summary.json` |
| Run 2 four-page CLI (detect + GPU OCR + managed translation, `HF_HUB_OFFLINE=1`) | exit 0, Result PASS, wall 1:46.65. 4 page-scoped servers, each SIGTERM → exit 0. Blocks 10/2/10/20; translated 10/2/10/19 (one block missing from the model response kept as Carrot does, D14); work `style-guide.json` (glossary 1, characters 5) and chapter `story-memory.json` (4 pages) written; Rover Output `translation.json` + `translation.csv` (43 rows) written | `test-data/output/m1-step4-claude-gpu-r2-20261003-163754/`, `claude-gpu-r2/e2e*.{log,jsonl}` |
| Strict Carrot schema (unmodified root `LibraryChapterFileSchema`, bundled by Claude) | run 1 and run 2 E2E chapters PASS / 0 issues | — |
| Step 3 regression on GPU: `node tools/validate-ocr.mjs …/validation-context-durable.json gpu …/hayai-cu130/bin/python` | exit 0; 3 pages / 21 items exact, text 21/21, sourceText 21/21 | `test-data/validation/m1-step3/differential-gpu-1791013208490/` |
| Regression (`npm run check` / `smoke` / `check:boundaries` / Python unittest) | 69/69 before rework; re-run by Claude after rework cycle 1: 72/72, 15/15, PASS, 14/14 (all exit 0) | terminal |
| Existing input files | SHA-256 unchanged | — |

Not verified: exact natural-language parity (not a Step 4 criterion), Electron vs sharp pixel parity of the assist image, historical work-context reconstruction (see "Outstanding scope").

## Review findings

| ID | Severity | Disposition | Status | Rounds | Finding / evidence |
|---|---|---|---|---|---|

## Phase 1 files and source mapping

- `runtime/llama/build.py`: repository-local wheel provisioning, CUDA toolkit
  layout, integrity checks, source/dependency archive verification, two CMake
  builds and output composition/identity. Derived from b9553 release.yml
  `windows-cuda` and `windows-cpu` jobs. Not a runtime/session implementation.
- `runtime/llama/pins.json`: b9553 commit
  `9e3b928fd8c9d14dbf15a8768b9fdd7e5c721d66`, exact source archive, wheel and
  dependency archive size/hash/URL bindings.
- `runtime/llama/model-pins.json`: model and mmproj filename/size/SHA bindings;
  no model bytes or personal paths.
- `tests/python/test_llama_recipe.py`: verified-download cache reuse,
  altered-cache refusal/preservation and wrong-size refusal.
- README at phase 1: explicit incomplete status and build usage. No CLI config changes.
- This document: actual evidence and unfinished scope.

At the end of phase 1, no Step 1–3 source, test, tool or observable contract had
changed and production translation functions were not yet implemented. Phase 2
mapping and earlier-step changes are recorded below.

## Build recipe: derivation and deviations

CUDA build options exactly preserve release.yml's Windows CUDA job:
`GGML_CUDA=ON`, `GGML_NATIVE=OFF`, `GGML_BACKEND_DL=ON`, `GGML_CPU=OFF`,
`LLAMA_BUILD_BORINGSSL=ON`, `GGML_CUDA_CUB_3DOT2=ON`. Its target is `ggml-cuda`.
CPU/server build mirrors the separate x64 CPU job: `GGML_NATIVE=OFF`,
`GGML_BACKEND_DL=ON`, `GGML_CPU_ALL_VARIANTS=ON`, `GGML_OPENMP=ON`,
`LLAMA_BUILD_BORINGSSL=ON`; build target `llama-server`. Compose CPU shared
libraries/server with CUDA shared backend in `bin/`, as the release combines jobs.

Linux adaptations:

1. Ninja single configuration + `CMAKE_BUILD_TYPE=Release` replaces Windows
   Ninja Multi-Config and `--config Release`; no Windows LLVM toolchain file.
   Host compiler is the existing GNU gcc/g++ 15.2.0.
2. `CUDAToolkit_ROOT` points to a repository-local CUDA 13.3 layout. PyPI 13
   splits nvcc/CRT/NVVM/runtime/cuBLAS/CCCL, so verified wheel contents are joined
   by symlinks. Unversioned `.so` linker names and `lib` → `lib64` are restored;
   the original bytes are retained. This is packaging, not a compiler patch.
3. WSL host `libcuda.so` is supplied through `CUDA_cuda_driver_LIBRARY` when
   present; no driver is fabricated, installed or loaded for a GPU test.
4. Source is a verified commit archive, not a Git checkout, to respect this
   session's no-Git-mutation rule. CMake FetchContent is pointed at verified
   archives of its own CCCL v3.2.0 and BoringSSL 0.20260526.0 tags; no tag/revision
   substitution. `GIT_CEILING_DIRECTORIES` prevents ggml's read-only Git probes
   from reporting the enclosing Rover repository's commit. Archive build info
   is unknown; the external source and binary identity manifests are authoritative.
5. GOCACHE/GOMODCACHE stay repository-local. `--jobs` controls build concurrency
   only; no model/runtime scheduling change. No GPU architecture override.

Tool versions actually executed: nvcc 13.3.73, CRT/NVVM 13.3.73, CUDA runtime
13.3.29, cuBLAS 13.3.0.5, CCCL wheel 13.3.3.4.1, CMake 4.3.4, Ninja wheel
1.13.2 (binary reports `1.13.2.git.kitware.jobserver-pipe-1`).
Default CUDA architectures from b9553 remain
`75-virtual;80-virtual;86-real;89-real;90-virtual;120a-real;121a-real`.

`python3 runtime/llama/build.py` final execution: **exit 0**, both CUDA and
CPU configure/generate succeeded. Evidence: `configure-final.log`,
`configure-final.exit`, ignored runtime `configure-command.json` and
`configure-cpu-command.json`.

Intermediate attempts `configure-1` through `configure-6` failed (exit 1):
Ninja wheel path/permissions, CUDA linker aliases/layout and driver discovery.
`configure-7` succeeded (exit 0, initial CUDA-only-server formulation).
`configure-8` failed (exit 1): re-extracting an in-use nvcc yielded ETXTBSY;
recipe now verifies existing extracted files without rewriting them.
`configure-9` succeeded (exit 0, separate CUDA/CPU configure).
All logs are preserved; none is claimed as a full build.

Initial `python3 runtime/llama/build.py --build --jobs 2` used the earlier
formulation in ignored `build/`, targeting a CPU-less server. This was corrected
in the final recipe to separate CUDA/CPU builds. That initial command compiled
CUDA objects but was interrupted via its own exec session Ctrl-C, **exit 130**,
when it remained a long build. No completed binary or binary SHA is claimed.
Log: `build-1.log`, exit: `build-1.exit`. Do not use that initial `build/`
as a production binary. Final recipe uses `build-cuda/`, `build-cpu/`, `bin/`.
No implementation-agent validation build command remained running at the end of
phase 1. During phase 2 Claude is running the final recipe externally with
`--build --jobs 16`; this agent did not touch or reconfigure its runtime directory.

## D32 model identity and resolved launch (reference execution only)

User-owned model/mmproj were read-only and hashed once each. Exact personal
paths and mtimes are confined to ignored `model-identity.json`; sizes/SHA are
in tracked `runtime/llama/model-pins.json`. No copying/moving/model conversion.

Installed settings also contain **ctx=65536**, **maxTokens=32768** and no
hardware computeGpuIndex. The ctx override must not be lost by applying the
preset default 32768. D32 changes model source to local Q6_K; local source
returns the unchanged economy26b preset, without QAT/MTP overrides.

Actual unchanged Carrot `model/launch-arguments.cjs` was required read-only with
these options, generating `reference-launch.json`. Scratch dependencies yauzl
3.2.0 and tar 7.5.7 were installed only under ignored runtime with local npm
cache; initial attempts without them failed, the final execution exited 0.
This validates reference argument generation only, not a Rover comparison or
complete execution of Carrot's TS settings resolver. No environment override
was intentionally supplied. The two model paths and template path below are
placeholders for the paths recorded in ignored evidence.

| Source function / settings | Arguments, in emitted order |
|---|---|
| launch-arguments buildModelSelectionArgs; D32 local paths | `-m <MODEL> --mmproj <MMPROJ>` |
| buildNetworkArgs; field options default port | `--host 127.0.0.1 --port 18180 --repeat-last-n 256 --repeat-penalty 1.08 --presence-penalty 0 --frequency-penalty 0` |
| buildSamplingArgs; generation defaults; missing reasoning budget | `--temp 0.2 --top-k 64 --top-p 0.95 --min-p 0.0 -rea off --reasoning-budget 0` |
| buildComputeArgs; economy26b + installed ctx/fit/mmproj | `--fit on --fit-target 1024 --fit-ctx 65536 -ngl auto -fa on -c 65536 -b 1024 -ub 1024 -np 1 --no-cache-prompt --no-warmup --mmproj-offload --cache-ram 0` |
| gemma4-official-chat-template.cjs; ordinary 26B detection | `--jinja --chat-template-file <PINNED_TEMPLATE>` |
| appendPerformanceArgs; economy26b preset | `--metrics --perf` |
| appendCacheArgs; economy26b preset | `--cache-type-k q4_0 --cache-type-v q4_0 --kv-offload --ctx-checkpoints 0` |
| appendImageArgs; translationGemmaFieldOptions defaults | `--image-min-tokens 1024 --image-max-tokens 1024` |
| buildLaunchArgs tail | `--log-timestamps --log-prefix --log-colors off` |

No draft, explicit threads, no-mmap, GPU-index or extra arguments were emitted.
Pinned template: revision `4d7ae4984b7db7de8f8457170b3f1a419ee76d52`,
18683 bytes, SHA `ae53464bf3be25802b3a5b37def7fd89667067d7577049b3b2d74c4d8de4c6d4`.
Template verification happened inside the reference builder, without writes.
The managed request's strict-refine sampling is a separate per-page operation;
this launch evidence does not validate its request fields.

## Phase 1 self-validation

Commands below ran from `RoverCarrot/`; evidence is new, ignored
`test-data/validation/m1-step4/`.

| Command | Exit / result | Evidence |
|---|---|---|
| `npm run check` | 0; 54/54 existing tests | check.log / check.exit |
| `npm run smoke` | 0; 15/15 | smoke.log / smoke.exit |
| `npm run check:boundaries` | 0 | boundaries.log / boundaries.exit |
| `python3 -m unittest discover -s tests/python` before recipe tests | 0; 11/11 | python-tests.log / python-tests.exit |
| Same command after recipe tests | 0; 14/14 | python-tests-final.log / python-tests-final.exit |
| `node tools/validate-ocr.mjs test-data/validation/m1-step3/validation-context-durable.json cpu` | 0; 3 pages, 21 items, entire Python JSON/normalization/stored structure exact, text/source 21/21, no unbound/top-level differences | ocr-differential.log / ocr-differential.exit; ocr-differential-cpu-1791009285992/ |
| `python3 runtime/llama/build.py` final recipe | 0; both configure/generate | configure-final.log / configure-final.exit |
| `git diff --check` | 0 (read-only) | terminal |

The existing OCR tool hardcodes the Step 3 evidence root. Only the newly created
`differential-cpu-1791009285992` directory was moved to the new Step 4 evidence
root after success. Its log retains the original creation path. No old Step 3
evidence was moved, removed or overwritten. One attempt to redirect final
Python test logs from repository root failed before test execution; the command
was then run successfully from RoverCarrot.

## Claude build / binary / GPU commands

The full `python3 runtime/llama/build.py --build --jobs 16` command is already
running externally under Claude with logs in `test-data/validation/m1-step4/claude-build/`.
Do not start a second build or reconfigure its source/build/toolchain directories.
If the current command failed, record the failure before any retry; revision,
CUDA major, architectures, features and quantization must remain pinned.

From `RoverCarrot/`, after Claude confirms build exit 0:

```bash
npm run build
LLAMA_ROOT="$PWD/test-data/runtime/llama-b9553"
LD_LIBRARY_PATH="$LLAMA_ROOT/cuda/lib64:$LLAMA_ROOT/bin" "$LLAMA_ROOT/bin/llama-server" --version
sha256sum "$LLAMA_ROOT/bin/llama-server"
cat "$LLAMA_ROOT/binary-identity.json"
node tools/translation-smoke.mjs lifecycle test-data/validation/m1-step4/phase2-orchestrator-20261003-161715/lifecycle.toml test-data/validation/m1-step4/phase2-orchestrator-20261003-161715/lifecycle-page.json
node tools/translation-smoke.mjs e2e test-data/validation/m1-step4/phase2-orchestrator-20261003-161715/e2e.toml
```

Archive `--version` may report unknown Git build info. Check the manifest's
revision `9e3b928fd8c9d14dbf15a8768b9fdd7e5c721d66`, CUDA 13.3 and entire binary/shared
library inventory. Rover's preflight verifies every inventory SHA/size, then
probes `--list-devices` and verifies inventory again. Do not substitute a binary.

Prepared configs/page are new ignored evidence with absolute personal asset
paths, never tracked. Neither output exists yet. Lifecycle output is
`test-data/validation/m1-step4/phase2-orchestrator-20261003-161715/lifecycle-output/`;
E2E output is `test-data/output/m1-step4-20261003-161715/`. Repeating either command
requires a new config output path; preserve the first run's evidence.
The input comic contains exactly four JPGs (FI5LOgBaQAAR7we, FI5LPYVagAUYKLB,
FI5LQf5aAAAUc14, FI5LRNDaUAk-pCu). E2E sets OCR `device="gpu"`, uses the existing
CU130 Python environment and managed translation, and runs the actual production
`runCli` entry with an isolated TOML. Public CLI arguments/default config remain
unchanged. Both commands need access to the host GPU/driver and user model paths.

Lifecycle smoke does real model load/readiness → one Rover translation request
on a bound Carrot OCR page → nonempty translated block → clean stop → restart →
abort during loading → missing-model startup failure cleanup → final restart/stop.
It checks owned children exit and saves result/prompt/raw-response artifacts plus
`lifecycle-summary.json`. E2E verifies the production CLI exits 0, materializes
four pages and saves nonempty translations. Claude should additionally inspect
all four page results, canonical OCR preservation, style-guide/story-memory and
JSON/CSV exports, next-page context and per-page child/session logs. Natural
translation wording is not an exact-parity criterion. Save actual commands,
exit codes, runtime identity and evidence in the orchestrator section above.

## Phase 2 files and Carrot → Rover mapping

| Reference function / module | Rover implementation / purpose |
|---|---|
| runtimeModules, model config/profile, launch-arguments `buildLaunchArgs` | `src/adapters/llama.mjs`: pinned b9553 recipe output resolution, fixed D32 launch, preflight and owned child lifecycle |
| llama-server-readiness `waitForServerReady`, llama-server-process and process-termination | same adapter: `/v1/models`, 2500ms probe, 1500ms polling, 1800000ms readiness; single SIGTERM → 5000ms graceful wait → SIGKILL with up to 5000ms exit confirmation (rework cycle 1), only the returned child; busy-port refusal |
| gemma4 official chat template | `runtime/llama/templates/gemma4-26b-4d7ae498.jinja`: 18683-byte pinned reference template |
| pageWorkflowTranslation, translatePageWithRetries, keepBlocksResult | `src/translation/translate.mjs` and `request.mjs`: source assertion, untranslated sourced targets only, five attempts in one page session, failure cleanup, empty-overlay enhanced retry |
| simple-page-request-builders, translation-request, chat-completion, simple-page-logit-bias | `request.mjs`, `ported/messages.mjs`, `ported/runtime/simple-page-logit-bias.mjs`: internal managed HTTP body, original bytes, tokenization bias, bounded response/timeout/abort and error classification |
| runtime/prompts, parsing, response-text | `src/translation/ported/runtime/**`: pure reference modules, mechanically converted CJS imports to ESM; no reference runtime dependency |
| pageResultBuilder, overlayItemReferences, OCR geometry locks, keepBlocksAssignment | `parseAndMerge` and `ported/*.mjs`: parser, candidate IDs/overlap mapping, source locks/sound filtering and canonical merge |
| workContextPrompt, workContextBudget, previousBlocksForPrompt | `request.mjs` + `ported` counterparts: deterministic ranking/pruning/current prompt context |
| cumulativePageContext, groundedPageContextCandidates, storyMemoryBuilder | pure `ported` counterparts: grounded glossary/character accumulation, story memory, manual visual-summary preservation |
| pageContextPersistence, previousChapterContext | `src/adapters/translation-store.mjs`: isolated work/chapter files, page+guide+story durable journal boundary, read-only explicit prior chapter/live-page inputs |
| result-artifacts/result-artifact-settings/request-summary | `src/translation/artifacts.mjs`, `ported/artifact-summary.mjs`: current artifact outer keys, prompt/system/raw response/result.md and bounded evidence; managed-only settings projection |
| linkedWorkspaceTranslationJson, reviewTable escape | `ported/export.mjs` + `reviewTable.mjs`: schemaVersion 2 JSON and BOM/CRLF quoted CSV; store triggers from saved chapter and reserves new output folder |
| Rover stage/composition | `src/translation/stage.ts`, Core contracts/config, Pipeline pending-memory pass-through, CLI composition/config template |
| validation | `tests/translation-reference.mjs`, `translation.test.mjs`, fake executable, sanitized launch fixture; `tools/translation-smoke.mjs`, `validate-translation-artifacts.mjs` |

`src/translation/ported/source-map.json` records individual pure-source paths.
The port contains no imports of root Carrot or its npm packages. Build copies
ESM assets/template references into the standalone distribution; boundary checker
allows sharp only in the image adapter. No package dependencies were added.

## Preserved behavior and persistence decisions (D14/D15/D16/D29)

- D14: empty raw model overlay retries; missing/partial/filtered slots preserve
  canonical blocks unchanged and can still complete. SourceText, geometry,
  formatting and existing roles are retained; only translatedText and fallback
  fontRole/confidence/visualClusterId merge. No invented missing-block repair.
- D15: successful parsed context accumulates only grounded AI glossary/characters,
  preserving collision/manual rules. Invalid/missing trailer warns and preserves
  translation. Cumulative=false excludes AI trailer updates; canonical page-story
  memory is still generated, as the reference does. Failed pages never advance memory.
- D16: Carrot persists label/imagePath/createdAt, summarized settings,
  requestSummary including prompts/OCR hints/previous blocks/budget, systemPrompt,
  prompt, outputText/rawResponse, result.md and overlay-items. Rover preserves
  that artifact scope, using a managed-only settings/summary projection (unused
  API/Codex/cache settings are omitted), capped reference OCR/subcrop evidence.
  It does not introduce a complete work-context snapshot. Launch/runtime identity
  is the recipe manifest/pins plus resolved table above; launch args are logged
  by the owned server path and covered by deterministic reference comparison.
- Original page bytes go unchanged to the request. Enhanced retry uses the
  reference max-long-side 1900 and contrast 1.6 grayscale math, decoding/re-encoding
  only that assist view. It reuses the Step 2 Chromium resize port with rectangular
  dimensions. Full Electron-versus-sharp decoder/transparent-image pixel parity
  was not run; original-image parity is exact and assist math is source-derived.
- Each next-page request reads a cloned context only after persistence succeeds.
  Page/guide/story files are staged and fsynced in a journal, published with atomic
  file renames/fsynced directories, then context advances and the journal is removed
  durably. This is recoverable multi-file publication, not a claim of one filesystem
  rename atomically switching three files for arbitrary concurrent readers.
  `recoverTranslationTransaction(output, transaction)` explicitly rolls forward a
  retained journal; the baseline still refuses existing outputs and does not auto-resume.
- A fresh isolated work has no library ancestors. Optional `styleGuidePath` and
  paired `previousStoryPath`/`previousChapterPath` import one explicit predecessor
  read-only; all its live memory pages are retained, ordered and assigned negative
  indices/title-prefixed names. The pure reference ranking/prompt policy chooses
  recent/relevant pages; no six-page truncation is applied at import time.
- D29 export reads the saved canonical chapter, reference ordering/JSON/CSV
  serializers, and reserves a new chapter folder with reference path sanitation.
  Errors warn without invalidating saved translation. Full Step 8 path integration
  and future multi-work import remain out of scope.

## Phase 2 validation and evidence

All commands below executed from `RoverCarrot/`; exit files/logs are under
new ignored `test-data/validation/m1-step4/`.

| Command | Actual result | Evidence |
|---|---|---|
| `npm run check` | exit 0; 69/69 (typecheck, lint, build, tests) | `phase2-check-verified.log`, `.exit` |
| `npm run smoke` | exit 0; 15/15 baseline tests | `phase2-smoke.log`, `.exit` |
| `npm run check:boundaries` | exit 0; Core/Pipeline remain adapter-free | `phase2-boundaries.log`, `.exit` |
| `python3 -m unittest discover -s tests/python` | exit 0; 14/14 | `phase2-python.log`, `.exit` |
| `node tools/validate-ocr.mjs test-data/validation/m1-step4/phase2-validation-context.json cpu` | exit 0 both runners; 3 pages, 21/21 source/text, Python JSON/normalization/structure exact, no unbound or top-level differences | `phase2-ocr.log`, `.exit`; `differential-cpu-1791011850893/` |
| `node tools/validate-translation-artifacts.mjs <CARROT_DATA_ROOT>/library/works/e87507ab-c752-4f9b-b0c0-75901c4c1110/chapters/0a4d6eaf-de01-4533-887c-10c0ab74c057/runs/ab70a208-d8e9-42cd-b93c-96abb7f0e5da test-data/validation/m1-step4/phase2-artifacts-1` | exit 0; comparison below | `phase2-artifacts-1/artifact-comparison.json` |
| runtime provisioning / configure / CUDA build | not rerun in phase 2; prior configure exit 0 remains; Claude build not claimed | phase 1 evidence above; `claude-build/` owned by Claude |

OCR uses an exact copy of `m1-step3/validation-context-durable.json` in the new
Step 4 evidence directory, retaining all original absolute input bindings. The
existing tool writes relative to that copy, so no old evidence is overwritten.

Deterministic tests execute the read-only root reference with fixed page/OCR and
rich glossary/characters/current+previous-story inputs; system/prompt/messages
and managed body fields match, separate from provider-specific differences.
The launch fixture is the previous reference-generated argument list with only
model/mmproj/template paths replaced. Tests compare parsing/mapping/geometry,
partial/duplicate/empty outputs, trailer parse, grounding/manual collision,
collect-disabled memory and export ordering/quoting to the reference.
Fake-server tests cover real HTTP request and tokenization, empty-result retry
and enhanced artifact, ready/startup failure, timeout, abort, restart, busy port,
owned-only termination and SIGINT→SIGTERM→SIGKILL escalation. Integrity alteration
is refused. Persistence success and injected publication failure are tested,
including unchanged next-page context and explicit journal recovery.

Recorded Carrot artifacts: read-only run `ab70a208-d8e9-42cd-b93c-96abb7f0e5da`,
pages `05a43417`, `07140551`, `0a2318ed` (full IDs/paths/SHA in comparison JSON).
All were openai-api, not the managed provider. All three system prompts and
Task/Output/Coordinate/Strict refinement/Hayai locked-region/Geometry/Segmentation/
Rendering/Trailer sections match exactly. Previous-pass blocks match on page 1;
pages 2/3 differ in glossary-conflict instructions. Work glossary/story section
differs on all three because stored artifacts do not contain the full historical
context snapshot. Reconstructing it from today's mutable guide would be a false
oracle. These differences are retained explicitly; no full stored-prompt exact
parity is claimed. Rich fixed-context differential tests cover those dynamic
sections against real reference code instead. Managed-only body fields (model,
top_k, thinking/reasoning, local token bias) are compared in the fixed oracle,
not inferred from historical openai-api bodies. Translation wording is never
used for natural-language parity.

Intermediate phase-2 check logs retain lint/fixture/import failures; only final
successful logs are acceptance evidence. `phase2-check-9` failed because an
artifact module creation used the wrong working-directory prefix; it was corrected
and `phase2-check-10`, `-11` and final passed. Nothing failed is described as PASS.

## Changes to provisional Steps 1–3

- Core contracts add optional translation config/context/pending memory and
  Persistence.commit's optional second argument. Pipeline passes pending memory
  for successful results only. Existing page-only stage/persistence behavior stays
  the same; no scheduling or failure policy changes.
- CLI composition swaps in the production stage only when translation assets
  are configured. Config template contains blank asset paths, no personal paths.
  Public flags/default config location/output refusal are unchanged. Internal
  `configPath` injection supports isolated orchestrator validation without editing
  the user's config; an attempted public `--config` addition was removed after
  the existing observable-contract regression exposed it.
- `detection-resize.ts` adds optional destination height, with existing square
  default unchanged, to reuse the characterized Chromium resize in the assist image.
- Build asset-copy tool includes translation ESM modules/adapters. The boundary
  test's sharp allowlist includes only the new translation image adapter.
- All earlier 54 Node tests, smoke 15, Python 14 and Step 3 CPU differential passed.
  No previous observable contract change or USER_DECISION_REQUIRED is established.

## Outstanding scope / handoff information

Implementation-agent scope is complete subject to orchestrator verification;
Step 4 is not DONE and no handoff/ledger state was edited. Remaining acceptance:
Claude's final CUDA build/binary identity, real managed GPU lifecycle and four-page
production CLI run, inspection of saved memory/next-page prompts/exports, and
first-pass review. Fresh independent review remains deferred by the user.
Known limitations are the stored historical context reconstruction and assist
image decoder parity described above, not undisclosed full-parity claims.
No new USER_DECISION_REQUIRED. If pinned CUDA build or actual launch fails,
record its cause; do not silently change revision/runtime/features/model.

No Git mutation, handoff/state/ledger edit, reference/analysis/data-root/model
edit, old evidence overwrite, concurrent Claude runtime modification, system
package install, Docker/service change or external-process termination occurred.
Only owned fake test-server children were signaled in phase 2. Previous runtime
recipe/pins/tests were preserved. New ignored outputs/evidence and allowed
RoverCarrot files contain the implementation.

## Rework cycle 1

F1 (Medium, REQUIRED_FIX): fixed owned llama-server shutdown in this rework.
Reference `src/main/runtime/transport/llama-server-process.cjs:403–416`
(`stopServer`) sends exactly one SIGTERM on non-Windows, races child exit
against `delay(5000)`, then calls `terminateChildProcessTree` if still running.
`src/main/runtime/transport/process-termination.cjs` maps non-Windows force
termination to SIGKILL. Rover now uses the same single SIGTERM and 5000ms
pre-escalation bound, without SIGINT or a second graceful interrupt. Its existing
5000ms post-SIGKILL exit confirmation remains; the reference does not await
post-kill confirmation. Only the owned child is signaled.

The probe's abort/finally paths now share one disposal promise, as the managed
session already does, so concurrent cleanup cannot send a second interrupt.
Launch, readiness, translation, persistence and export behavior is unchanged.
The earlier Phase 2 SIGINT→SIGTERM escalation coverage above describes the
superseded implementation, not this rework's accepted shutdown behavior.

`tests/fake-llama.mjs` now models both SIGINT and SIGTERM as the same interrupt:
first interrupt starts 350ms cleanup then exits 0; a second interrupt exits 1
immediately. Stubborn mode ignores either interrupt. New regression tests use
the production default bound (no shortened grace period), verify normal exit 0
and exactly one interrupt, verify ignoring SIGTERM leads to SIGKILL only after
5000ms, and verify startup abort awaits exit 0, leaves the owned PID gone and
allows a fresh server on the same port. Concurrent dispose calls are covered.
The existing translation/retry lifecycle test now also requires child exit 0.

Commands executed from `RoverCarrot/`; new preserved evidence directory:
`test-data/validation/m1-step4/rework-cycle1-20261003-163600/`.

| Command | Exit / result | New evidence |
|---|---|---|
| `npm run check` | 0; typecheck, lint, build, 72/72 Node tests | `check.log`, `check.exit` |
| `npm run smoke` | 0; build, 15/15 smoke tests | `smoke.log`, `smoke.exit` |
| `npm run check:boundaries` | 0; runtime and Core/Pipeline boundaries pass | `boundaries.log`, `boundaries.exit` |
| `python3 -m unittest discover -s tests/python` | 0; 14/14 Python tests | `python.log`, `python.exit` |

No GPU is available in this sandbox: real b9553 CUDA/model lifecycle and E2E
were not rerun by this implementation agent. Claude's externally reported GPU
results are not claimed as this agent's validation; the Claude orchestrator
verification section is preserved for Claude. Post-fix real GPU shutdown
verification remains external.

No Git mutation or handoff/ledger edit occurred. The previous uncommitted
implementation was retained. Root Carrot references, analysis documents, Carrot
data root, user model directory and `test-data/runtime/llama-b9553/` build output
were not modified. Existing evidence was not overwritten. No Docker, sudo,
apt or termination of non-owned processes was used.
