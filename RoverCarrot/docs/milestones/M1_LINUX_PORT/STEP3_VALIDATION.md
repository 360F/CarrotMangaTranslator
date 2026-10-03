# M1 Step 3 — OCR / Hayai validation

Implementation evidence (2026-10-03): implementation agent(Codex)의 구현·CPU 검증과 orchestrator(Claude)의 1차 검증·GPU 검증. commit·handoff는 orchestrator가 수행한다. workflow가 요구하는 독립 review는 별도 fresh review session이 수행하며 아직 하지 않았다. 이 문서는 Step DONE 선언이 아니다.

## Reference source / observable contract

Reference는 root fork `fd461737`이며 runtime에서 import하지 않는다.

| Carrot source / function | Rover port | 보존한 contract |
|---|---|---|
| `src/main/runtime/hayai-bboxes.py` | `runtime/hayai/worker.py` | 원본 전체 byte-identical 복사. manifest/output schema, 11-file SHA verification, F32 greedy, 8 crops, 128 tokens, 256 patches, subdivision/retry/health, NFKC normalize_text, OOM split |
| `pageWorkflowOcr.ts`: prepare / manifestForBlocks / clipOcrSubdivision | `src/ocr/stage.ts`: prepareOcr | target 순서→id=i+1, original raster, normalized bbox round-trip의 reference 연산순서·Math.round, geometryKey 일치시에만 metadata 재사용 |
| `pageWorkflowPolicy.ts`: workflowTargetBlocks / workflowStageKey / workflowRegionKey; `pageRevision.ts` | `src/ocr/stage.ts` | 빈 sourceText 대상(내부 overwrite 지원), page id/revision/stage-key guard |
| `hint-normalization.cjs`: Hayai path, copyRecognitionSegments / copyOcrHealth / limitPartitionedHints | `src/ocr/normalization.ts` | pixel clamp/round, 원래 id, confirmed B#### partition, segments 2–8/containment ±1, health whitelist, 80 cap |
| `prompts/ocr-text.cjs`, glossary-omission / model-profile truncateText / language-profile | `src/ocr/ocr-text.mjs`, `glossary-omission.mjs` | 일본어 Latin/ruby noise, glossary omission, control/whitespace, 160자 prefix **+ truncation notice** |
| `pageWorkflowOcr.ts`: applyWorkflowOcrResult | `src/ocr/stage.ts`: applyOcr | missing hint 실패; healthy sourceText/segments 저장; failed는 빈 sourceText와 ocrFailure, 부분 결과 보존 |
| `pageWorkflowRuntime.ts`: prepareWorkflowOcrBatch; simple-page-ocr commands / progress / waitForOcrIdle | `src/adapters/hayai.ts`, Stage.prepare / pipeline | 모든 대상 page 한 subprocess batch, progress JSONL, max(1h, pages×5m) timeout, close 이후 결과 적용·다음 stage |
| translationRuntimePort: detector release before OCR | `src/cli/app.ts` composition | OCR prepare 전 run-owned Koharu session close |

Windows DLL search / long-path helper는 원본 그대로 둔다. POSIX에서는 원본 자체가 no-op이다. ROCm branch도 원본에 있지만 Rover config/lock/배포에는 노출하지 않는다. Paddle/external-command/installer/managed Python은 이식하지 않았다.

Reference를 trace한 실제 `manifestForBlocks`는 **ocrSubdivision만 clip**하고 recognitionBboxes는 그대로 넘긴다. 이 순서를 그대로 보존했다. 정상 Hayai 출력은 pixel-space / text label / confirmed B#### partition이므로 legacy Paddle/anime/adjacency normalization 경로는 adapter의 입력 contract 밖이다. 원본 Node 정규화와 전체-field differential로 이 범위를 검증했다.

## D9 / D13 / boundary 기록

- **D9:** 미리 설치한 Linux Python 3.12 venv executable와 writable HF cache를 config `[ocr]`에서 받는다. CPU/cu130 hash lock을 제공하며 Core는 Python 설치·model download·subprocess를 알지 않는다. 별도 installer/container/managed runtime architecture는 추가하지 않았다.
- **D13:** raw sourceText 저장으로 바꾸지 않았다. sanitize는 OCR result normalization 시점이고, ocrFailure.rawText도 이미 sanitize된 text다. Python raw JSON은 output artifact로 남는다.
- OCR reads: imagePath/width/height, block bbox/id/sourceText, workflowOrigin geometry/recognitionBboxes/ocrSubdivision. Writes: sourceText, recognitionSegments, ocrFailure. Pipeline은 Stage.prepare→execute와 persistence만 호출한다. adapters import 없음.
- Core/Pipeline의 최소 확장: optional Stage.prepare로 batch를 준비하고 stage가 결과 map을 보유한다. 순차 baseline(사용자 결정)에 따라 단일 worker process다. 여러 runtime profile은 한 reader config로 고정되므로 혼합되지 않는다. prepared page state와 batch map은 OCR stage 동안 메모리에 유지된다. preparation elapsed는 reference elapsedPerPage처럼 page별 stage timing에 나누어 포함한다.
- Detector는 CLI composition에서 OCR 전 release. OCR은 성공/오류/timeout 모두 process `close`를 기다린다. Step 4 runtime은 구현하지 않았으며 다음 generic stage 이전의 closure를 테스트했다.
- failed OCR은 page issue / run partial, 해당 page의 후속 stage를 생략한다. 부분 block state는 정상 persistence boundary로 저장된다.

## D31 reference binding (read-only)

2026-10-03 사용자 결정대로 설치 앱 `<CARROT_DATA_ROOT>`를 사용했다. 예전 Step 2 개발 data root를 사용하거나 다시 생성하지 않았다. 실제 경로는 Git 제외 `test-data/validation/m1-step3/validation-context.json`에만 있다.

Chapter: `library/works/e87507ab-c752-4f9b-b0c0-75901c4c1110/chapters/0a4d6eaf-de01-4533-887c-10c0ab74c057/chapter.json` (53 pages).
Run: chapter 아래 `runs/6468497c-ba1c-40e2-a4be-5dc1aa089252/pages/<pageId>/attempt-1/`.
전체 설치 corpus: 55 OCR output files / 269 items / ocrHealth 0; chapter run subtree만 보면 46 files / 261 items이고 나머지는 다른 saved artifact 위치다.

Settings: `translation.sourceLanguage="ja"`, `ocr.pipeline="hayai"`, `device="gpu"`, `qualityMode="full"`, `gpuBackend="cuda"`, saved `gpuCudaTag="cu129"`; 설치된 Hayai runtime variant와 실제 기준 stack은 **cu130**. CPU comparison은 device만 cpu로 바꾼 fresh 실행이다. 같은 chapter의 현 persisted block ID와 manifest regionId binding을 확인했다.

| Page ID | Raster | OCR regions |
|---|---|---|
| 05a43417-fed4-4cdd-ae8c-0455ef5933fa | pages/046-05a43417-fed4-4cdd-ae8c-0455ef5933fa.png | 1 |
| 07140551-e963-4d9f-a89d-30a0d421d15e | pages/033-07140551-e963-4d9f-a89d-30a0d421d15e.png | 9 |
| 0a2318ed-7f2d-4e42-afae-f9731eb2c745 | pages/004-0a2318ed-7f2d-4e42-afae-f9731eb2c745.png | 11 |

각 입력은 저장된 `workflow-regions.json` + 해당 original PNG다. `hayai-regions.json`은 detection artifact이며 이번 OCR 비교 입력과 혼동하지 않았다. 기대값은 같은 attempt의 `ocr-bbox-hints.json`; chapter sourceText는 별도로 비교했다. 저장된 결과는 fresh baseline으로 부르지 않는다.

File identities (`<CARROT_DATA_ROOT>/` 기준; full inventory는 `binding-identities.json`):

| Page | File | Bytes | SHA-256 |
|---|---|---:|---|
| 05a43417 | workflow-regions.json | 538 | `9c99ef04db18f07553dabc868589e1646e25322c561bd8571fda11f9eea62fcd` |
| 05a43417 | ocr-bbox-hints.json | 830 | `efb13c146f89c95f972a5e9bd90af4cc61ff40986b738871c1a8c4aaba4afb5c` |
| 05a43417 | 046-05a43417-fed4-4cdd-ae8c-0455ef5933fa.png | 2150237 | `c25c1127a9200435090f8aa3ffd666a6e39211107f5f985060b051c0a44f5a00` |
| 07140551 | workflow-regions.json | 2156 | `75782430f16360889e56981e3eba73b34cb643573b70c7b7ec0c128d5700387d` |
| 07140551 | ocr-bbox-hints.json | 3893 | `de154c685ba851adcf11509f5dcb4c08aa68973260ef1c1f82ce700b60446b7a` |
| 07140551 | 033-07140551-e963-4d9f-a89d-30a0d421d15e.png | 1987844 | `b872de4b795a3bcf6a58ff0071eed3871d0956543213c1b127a539820037fb9a` |
| 0a2318ed | workflow-regions.json | 2572 | `749189be03636ad5e16d4c2f11dc7957d1a305106706074f23e2fd7a206f35b7` |
| 0a2318ed | ocr-bbox-hints.json | 4640 | `f2acec57c0b6039591c255adc3f1abb9df54c9b37511b55701ce81bd30e4dee4` |
| 0a2318ed | 004-0a2318ed-7f2d-4e42-afae-f9731eb2c745.png | 3275084 | `b9943f7db4a47f9ad3915934edcf10831d2d35136f1f53927e201b15f093fd35` |
| chapter | chapter.json | 832669 | `63be7fa5cc1c96e0c698afae1e86974bf5e9d0b95ad511ea5ac0c579f3244577` |

## S0 / S1 runtime identity

Ubuntu 26.04.1 LTS / WSL2 x86_64, glibc 2.43, 62 GiB RAM, Python **3.12.15**, uv **0.12.22**. System Python 3.14는 inference에 사용하지 않았다. GPU는 `/usr/lib/wsl/lib/nvidia-smi`에서 `GPU access blocked by the operating system`; CUDA inference 실행 불가. 환경 원문은 `environment.txt`.

CPU 설치 exit 0 / import·real model load 성공:

| Package | Version |
|---|---|
| torch | 2.9.1+cpu |
| torchvision | 0.24.1+cpu |
| transformers | 5.13.1 |
| tokenizers | 0.23.0rc0 |
| huggingface-hub | 1.29.0 |
| safetensors | 0.8.0 |
| numpy | 2.5.2 |
| pillow | 12.3.0 |

Linux lock 생성(CPU / cu130 모두 exit 0):

```bash
uv pip compile runtime/hayai/requirements-cpu-linux.in --python-version 3.12 \
  --python-platform x86_64-unknown-linux-gnu --generate-hashes \
  --index https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
  --output-file runtime/hayai/requirements-cpu-linux.lock
# cu130도 동일 command에서 input/output와 index의 cpu를 cu130으로 변경
uv venv --python <PYTHON_3_12> test-data/validation/m1-step3/venv-cpu
uv pip sync --python test-data/validation/m1-step3/venv-cpu/bin/python --require-hashes \
  --index https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
  runtime/hayai/requirements-cpu-linux.lock
```

위 설치는 초기 evidence다. Rework cycle 1에서 durable runtime으로 교체하고 CPU/cu130 venv를 모두 설치했다(아래 참조). 기존 환경과 evidence는 보존했다. pin substitution 없음.

## S2 model identity / offline

Model `JustANormalTinkerer/hayai-ocr-v2@3608bb2075b9b39cb9f63e57251bca665de248cd`, processor `google/siglip2-base-patch16-naflex@b53b807d3a2d5e2b3911292f2d69e5341cdc064c`.

| Repo | File | Bytes | SHA-256 |
|---|---|---:|---|
| Hayai | config.json | 342 | `581b762f1dfd55d0108f3f84e3f157bc762524af37fb0c19a7172a18b75582e2` |
| Hayai | configuration_hayai.py | 401 | `47abd38cf1bae7aef27d01f5b8b4aa0960a7bc625a8afad79c4762ff5e5ed970` |
| Hayai | model.safetensors | 622502784 | `4c645b221db8428cda04991be234c18133bb8861142a3d87cba04c5099b02328` |
| Hayai | modeling_hayai.py | 28251 | `3d78976206549964abd55f776ab059e002adc72d2167daf168e46a12a5f4ae62` |
| Hayai | tokenizer_config.json | 244 | `6fb6c69afaedf1275872d3e62e276fd4467bd00da7a84cbbb5566a2cd28f58f6` |
| Hayai | tokenizer.json | 1247253 | `f8a0a909c628a684fe463094614e236a8b1d3609e7770f77e7beafaf1056bf13` |
| Siglip2 | config.json | 329 | `c0b8c2e7f0527b0bea1b1d9abe0381c0f294352df92439c54590b8420e539118` |
| Siglip2 | preprocessor_config.json | 393 | `1125703e5446d5b6ff4d5893a33bac128cdd21dc12e3dad2469a648fb0ae3bf7` |
| Siglip2 | special_tokens_map.json | 636 | `baec30ea10906f16adb8c18af7a34023002c1746542612b8b41c9f09e1351351` |
| Siglip2 | tokenizer_config.json | 40160 | `d2343400f0f86133053325951b696df8fd0f53a007cf6a546e6c2b4361344f47` |
| Siglip2 | tokenizer.json | 34356304 | `58a1696e79c9d97937389ed116f552a15c84811d7b8023918b86f4bc5775b1b0` |

Reference worker / Rover worker SHA-256: `06a86529b2f7125f4454f8a82e4d8eee5d1a6fc9a78e4b0432ba1822a19393be` (byte-identical).

11 files는 설치 앱 cache에서 새 writable `test-data/validation/m1-step3/hf-cache`로 dereference copy한 뒤 verify_snapshot으로 모두 확인했다. 원본 cache에 쓰지 않았다. 빈 cache에서 11 files 전체를 network download한 검증은 대체로 copy+SHA verification을 사용했다.

**Offline 조건을 실제로 확인:** 최초 단순 snapshot copy에서 reference worker exit 1 (`OfflineModeIsEnabled`: Hub tree metadata 없음). Writable cache에 pinned repo tree metadata를 `snapshot_download(..., allow_patterns=["config.json"])`로 준비했다. 다음 reference exit 1은 pinned modeling_hayai.py의 `Siglip2VisionConfig.from_pretrained("google/siglip2-base-patch16-naflex")`가 `main` ref를 요구했기 때문이다. 설치 앱 `refs/main`을 read-only 확인·copy했고 그 값은 pinned processor revision과 같았다. 이후 **HF_HUB_OFFLINE=1 전체 reference/Rover load+inference exit 0**. model/worker/Hub 코드를 patch하지 않았다. 실패 기록도 보존했다.

## S3 / S4 / S6 differential and reference comparison

`RoverCarrot/`에서:

```bash
npm run build
node tools/validate-ocr.mjs test-data/validation/m1-step3/validation-context.json cpu
```

이 command는 매번 새 timestamp evidence directory를 만든다. 수정하지 않은 root `src/main/runtime/hayai-bboxes.py`를 **원래 위치에서** 실행하고 Rover worker를 별도로 실행한다. 같은 Python env/cache, 같은 manifest/raster, 동일 CPU 2-thread env, 동일 F32 inference defaults다. Output만 새 evidence tree에 쓴다.

| Comparison | Result |
|---|---|
| Python reference vs Rover entire JSON | PASS, 3 pages / 21 items, exact all fields |
| Reference Node normalizeOcrBboxHintPayload vs Rover normalized hints | PASS, 21/21, entire objects exact |
| Stored Carrot normalized hint deterministic structure | PASS, 21/21 |
| OCR text vs stored Carrot OCR text | 21 equal / 0 different |
| OCR sourceText vs same regionId chapter block | 21 equal / 0 different |
| Faithful reference TS function bodies (scratch) vs Rover manifest/revision/stage-key/healthy binding | PASS, 3 pages / 21 regions |
| Same reference TS failed binding / partial exception page+message | PASS, 3 synthetic failed cases |
| Synthetic normalization differential (health × language; 81 items, segments, noise, truncation, glossary) | PASS, 16 cases, all fields exact |

Core binding comparator scratch preserves reference function bodies, stubs only IO/type graph, and is kept in ignored evidence (`rover-step3-reference-binding.ts`, `rover-step3-binding.mjs`). It does not import Rover helpers into the reference side. Standard tests do not require parent source.

Evidence root는 Git 제외 `RoverCarrot/test-data/validation/m1-step3/`다. 최종 profiled fresh run: `differential-cpu-1791004979638/`. 전체 process 시간(reference/Rover): **14.995 s / 14.400 s**, page당 amortized **4.998 s / 4.800 s**; peak RSS **1,434,744 / 1,415,652 KiB** (`process.json`의 time -v). 모델 load가 포함된 새 process 측정이며 OS file cache를 비우지 않아 cold filesystem benchmark를 주장하지 않는다. 이전 성공 run `differential-cpu-1791004619504/`도 보존했다.

## S5 failure paths

No real ocrHealth entry exists in the installed reference corpus. Bound pages have no subdivision. Real failed/recovered/subdivided inference parity is **not claimed**.

```bash
python3 -m unittest discover -s tests/python -v
```

Exit 0, **11/11** tests: reference recovery suite port (9), GPU-request/no-GPU refusal and recursive OOM split/single-crop failure (2). Fake recognizer validates whole read, preemptive subdivision, retry recovery, exhausted retry→failed, unknown generation length, manifest segment containment and token recorder.

Node tests cover missing hint, page id/revision/stage-key mismatch, changed geometry disabling reuse, bbox clip, existing source skip/internal overwrite, failed evidence persistence, recovered segments/failure clearing, 80 cap, truncation notice, batch single call and wait, timeout/nonzero process close, page partial/next-stage skip and OCR config rejection. CPU-only real Python invocation with `--device gpu` exit **1**, GPU refusal before inference / no CPU fallback (`gpu-unavailable-process.json`).

## Real 4-page CLI / strict persistence / preservation

Local ignored config has `stages=["detect","ocr"]`, installed-root Koharu path, configured CPU venv and **new writable** HF cache. Other stages were not run.

```bash
HF_HUB_OFFLINE=1 node dist/cli.js
```

Exit **0**, Detect PASS / OCR PASS. Output: `test-data/output/m1-step3-20261003-141746/`. Four pages have **10 / 2 / 10 / 20 = 42 blocks**, each with persisted sourceText and schema-supported workflowOrigin. Full block text/origin evidence is `strict-schema.json`.

Strict schema validation used actual **unmodified** root LibraryChapterFileSchema bundled by esbuild 0.25.12 + zod 3.25.76 under `/tmp`, no root dependency install/source edit. Reference 53-page chapter and new OCR output both PASS / **0 issues**. This is schema compliance; Windows GUI open/use remains Step 8.

Existing input/output inventory: **60 files** hashed before/after, **0 changed/missing** (`user-data-before.json`, `user-data-after.json`). Bound reference manifest/hints/raster/chapter SHA rechecked unchanged. No existing baseline/output was regenerated or overwritten.

## Regression / comparator audit

| Command | Exit / result | Evidence |
|---|---|---|
| npm run check | 0, 53/53 | check-final-config-timing.log |
| npm run smoke | 0, 15/15 | smoke-final-timing.log |
| npm run check:boundaries | 0, PASS | boundaries-final-timing.log |
| Python unittest discover | 0, 11/11 | python-tests-final.log |
| git diff --check | 0 | read-only check |

Comparators do not sort regions or apply tolerance. Python comparison uses deepStrictEqual on **entire parsed JSON**: field presence, schema, dimensions, coordinateSpace, item count/order/id/label/geometry/score/text/review metadata/sourceDetectionIds/segments/health, effectReviewRegions, noTextDetected/textEvidenceCount and model pins. JSON formatting is outside contract. Model pins/count/schema additionally asserted explicitly.

Normalization comparator uses entire hint arrays/objects (including omitted vs present fields, segment text, health and reviewReasons). Stored comparison excludes only top-level ocrText from the deterministic structure assertion, compares it separately, records every differing region, and separately compares sourceText by regionId. It does not declare text differences a failure. This corpus has no segment text differences. Binding compares full page objects, exact manifests, revisions/stage keys, failed exception page and message. Strict schema uses actual Carrot strict parser with no field removal / coercion / relaxed rules. Original strict tests were not relaxed: detection-only persisted test now selects detect only; CLI fixtures inject OCR through internal API.

## Known differences / limitations

No observed non-text behavior difference or text difference in the bound 21 regions (CPU) or in the 261 regions of the 46-page GPU run below. No USER_DECISION_REQUIRED pin substitution or algorithm change. Linux CPU/CUDA vs stored CUDA text equality is this sample's observation, not a universal parity guarantee. No real subdivided/recovered/failed Hayai case exists in the reference corpus; those paths are covered only by deterministic tests and a synthetic strict-schema shape check. Snapshot-only offline initialization failed as documented above; prepared cache succeeded. Performance optimization and parallel CPU/GPU scheduling are not implemented.

## GPU (Claude GPU run)

The cu130 venv is installed from the exact hash lock under the durable runtime.
No GPU inference was run by the implementation agent in rework cycle 1.
From `RoverCarrot/`, Claude can run:

```bash
node tools/validate-ocr.mjs test-data/validation/m1-step3/validation-context-durable.json gpu \
  "$PWD/test-data/runtime/hayai-cu130/bin/python"
```

Each run creates a new `differential-gpu-<timestamp>/` directory; preserve prior evidence.

### Claude orchestrator verification

Run by Claude (orchestrator) outside the implementation sandbox on 2026-10-03, after rework cycle 1. This is the orchestrator's first-pass check, **not** the independent review required by the workflow. Evidence is Git-ignored under `test-data/validation/m1-step3/` (`claude-review/` and the directories named below).

Environment: RTX 5090 32 GiB, driver 616.92 (WSL), durable `test-data/runtime/hayai-cu130` from `requirements-cu130-linux.lock`: torch `2.9.1+cu130` (CUDA 13.0, `torch.cuda.is_available()` true), torchvision 0.24.1+cu130, transformers 5.13.1, tokenizers 0.23.0rc0, huggingface-hub 1.29.0, safetensors 0.8.0, numpy 2.5.2, pillow 12.3.0. Both workers logged `[hayai-ocr] using CUDA 13.0 device 0: NVIDIA GeForce RTX 5090`.

| Check (command from `RoverCarrot/`) | Result | Evidence |
|---|---|---|
| `npm run check` / `npm run smoke` / `npm run check:boundaries` / `python3 -m unittest discover -s tests/python` | exit 0: 54/54, 15/15, PASS, 11/11 | terminal |
| Documented GPU differential, 3 bound pages: `node tools/validate-ocr.mjs test-data/validation/m1-step3/validation-context-durable.json gpu "$PWD/test-data/runtime/hayai-cu130/bin/python"` | exit 0; reference worker == Rover worker (entire JSON), normalization exact, stored structure exact, text 21/21, sourceText 21/21 | `differential-gpu-1791006345460/` |
| Same tool on **all 46** run pages that have `workflow-regions.json` (Claude-built ignored context `claude-review/context-all46-durable.json`) | exit 0; 261 items; text 261/261; top-level differences 0; sourceText 256/256 bound, 5 `sourceUnbound` (blocks re-detected in the chapter after that run) | `claude-review/differential-gpu-1791006363693/comparison.json` |
| Claude's independent comparator over the same 46-page outputs (`claude-review/compare-all.mjs`: entire Python JSON, reference `normalizeOcrBboxHintPayload` vs Rover, stored raw top-level fields, stored item count, every non-text item field and segment geometry, then text) | pythonExact 46/46, normExact 46/46, stored count 46/46, stored structure 46/46, text 261/261, problems 0 | `.../differential-gpu-1791006363693/claude-compare.json` |
| Sanitize fuzz differential (reference `ocr-text.cjs` vs Rover port; ja/en/ko/unset, glossary omission terms, work-context ruby glossary, control/long input) | 20,006 cases, 0 differences | `claude-review/fuzz-sanitize.out` |
| Normalization fuzz differential (Hayai-shaped payloads: out-of-bounds/degenerate boxes, id collisions, 2–9 segments, health variants, >80 items) | 5,000 cases, 0 differences | `claude-review/fuzz-normalize.out` |
| 4-page CLI on GPU (`device="gpu"`, cu130 venv, `HF_HUB_OFFLINE=1`; local config temporarily switched and restored byte-identical) | exit 0, Detect PASS / OCR PASS, 10/2/10/20 = 42 blocks, 0 empty sourceText, 42/42 equal to the CPU cycle-1 output; wall 27.5 s (incl. Koharu CPU detection) | `test-data/output/m1-step3-claude-gpu-durable-20261003-144735/`, `claude-review/cli-gpu-2.*` |
| Strict schema: unmodified root `LibraryChapterFileSchema` bundled fresh by Claude (separately from the implementation agent's bundle) | GPU output, CPU cycle-1 output, reference 53-page chapter: PASS / 0 issues. Negative controls (wrong type, unknown `workflowOrigin` field, malformed `ocrFailure`) FAIL as expected. A page produced by Rover `applyOcr` with a failed hint (`ocrFailure`) and a recovered hint with `recognitionSegments`: PASS | `claude-review/strict-schema-claude/` |
| Existing input/output preservation | 114 files hashed before/after the GPU CLI run: unchanged | `claude-review/user-data-*-2.sha` |

Not verified here: real subdivided/recovered/failed inference (no such case in the reference corpus), Windows Carrot GUI open/use (Step 8).

## Pre-review rework (Claude orchestrator)

Cycle 1 addresses only C1–C3; these are not entries in the independent Review findings table.

- C1: uv 0.12.22 (PyPI Linux x86_64 wheel) and CPython 3.12.15
  (uv-managed python-build-standalone download) now reside on the persistent
  project filesystem in Git-ignored `test-data/runtime/`.
  CPU and cu130 venvs use this interpreter and the unchanged hash locks.
  Config `[ocr].python` points to `test-data/runtime/hayai-cpu/bin/python`;
  device remains cpu. New context: `test-data/validation/m1-step3/validation-context-durable.json`.
  Old context, venvs and evidence remain untouched.
- C2: `src/adapters/hayai.ts` applies MKL/NUMEXPR/OMP/OPENBLAS/VECLIB
  thread defaults of 2 only for cpu. Deterministic CPU/gpu/gpu:0 test in
  `tests/ocr.test.mjs`; validation tool uses the same device rule.
- C3: `tools/validate-ocr.mjs` asserts stored raw and normalized item counts;
  records every raw top-level field difference except items (including presence);
  missing current region bindings are recorded as `sourceUnbound` count and
  `sourceUnboundIds`, without failing OCR parity. Entire Python JSON,
  normalization and deterministic structure assertions remain exact.

### Durable provisioning (no HOME writes)

From `RoverCarrot/`, the exact bootstrap used is:

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

For this rework, `UV_CACHE_DIR="$PWD/test-data/validation/m1-step3/uv-cache"`
reused the existing durable wheel cache; fresh sessions can use the runtime cache above.
CUDA installation (no GPU required), using the same OCR_UV/OCR_PYTHON/cache variables:

```bash
"$OCR_UV" venv --python "$OCR_PYTHON" test-data/runtime/hayai-cu130
"$OCR_UV" pip sync --python test-data/runtime/hayai-cu130/bin/python --require-hashes \
  --index https://download.pytorch.org/whl/cu130 --index-strategy unsafe-best-match \
  runtime/hayai/requirements-cu130-linux.lock
```

Provisioning exit codes: PyPI wheel download/extraction **0**, uv Python install **0**,
CPU venv/sync **0**, cu130 venv/sync **0**. Exact tool/interpreter versions confirmed.
`pyvenv.cfg` in both venvs points to the durable interpreter, not /tmp.
Install logs: `test-data/validation/m1-step3/rework-cycle1/python-install.log`
and `venv-install.log`. Wheel source metadata: `test-data/runtime/uv-source.json`.

### Cycle 1 self-validation

All commands below ran from `RoverCarrot/`; logs and exact exit-code files
are in `test-data/validation/m1-step3/rework-cycle1/`.

| Command | Exit / result | Evidence |
|---|---|---|
| `npm run check` | 0; 54/54 tests | `check.log`, `check.exit` |
| `npm run smoke` | 0; 15/15 tests | `smoke.log`, `smoke.exit` |
| `npm run check:boundaries` | 0 | `boundaries.log`, `boundaries.exit` |
| `python3 -m unittest discover -s tests/python` | 0; 11/11 tests | `python-tests.log`, `python-tests.exit` |
| `node tools/validate-ocr.mjs test-data/validation/m1-step3/validation-context-durable.json cpu` | 0; 3 pages / 21 items exact Python, normalization, stored structure; 21/21 stored text and sourceText; 0 unbound; 0 top-level differences | `differential.log`, `differential.exit`; `../differential-cpu-1791006166241/comparison.json` |
| `HF_HUB_OFFLINE=1 node dist/cli.js --output test-data/output/m1-step3-rework-cycle1` | 0; 4 pages, Detect/OCR PASS, 10/2/10/20 blocks with sourceText | `cli.log`, `cli.exit`, `cli-summary.json` |
| Before/after SHA-256 inventory | 0; 106 files unchanged/missing 0 | `user-data-before.json`, `user-data-after.json`, `preservation.json` |
| `git diff --check` | 0 | read-only check |

New CLI output is `test-data/output/m1-step3-rework-cycle1/`.
The hash inventory covers every pre-existing input/output file plus bound
reference manifest/hints/raster/chapter files, and was rechecked after both
inference commands completed. No Git mutation, handoff/state edit, root
reference edit or old evidence overwrite was performed. GPU inference is
the only requested follow-up left to Claude; cu130 installation is complete.

## Review findings

| ID | Severity | Disposition | Status | Rounds | Finding / evidence |
|---|---|---|---|---|---|
