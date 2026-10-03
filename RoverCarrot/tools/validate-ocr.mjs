// Read-only reference runners; all writes go to a newly created evidence directory.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ocrCpuThreadEnv } from '../dist/adapters/hayai.js';
import { normalizeHayai } from '../dist/ocr/normalization.js';
const [contextPath, device = 'cpu', pythonOverride] = process.argv.slice(2);
if (!contextPath || !['cpu', 'gpu'].includes(device)) throw new Error('Usage: node tools/validate-ocr.mjs <ignored-context.json> [cpu|gpu] [python]');
const context = JSON.parse(await readFile(contextPath, 'utf8'));
const root = resolve(contextPath, '..', `differential-${device}-${Date.now()}`);
await mkdir(root); console.log(root);
const require = createRequire(import.meta.url);
const reference = require('../../src/main/runtime/ocr/hint-normalization.cjs');
const env = { ...process.env, HF_HUB_OFFLINE: '1', HF_HOME: context.hfCache, HF_HUB_CACHE: join(context.hfCache, 'hub'),
  HF_MODULES_CACHE: join(context.hfCache, 'modules'), PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
  ...ocrCpuThreadEnv(device), MANGA_TRANSLATOR_OCR_GPU_BACKEND: 'cuda' };
const outputs = {};
for (const [who, script] of [['reference', resolve('../src/main/runtime/hayai-bboxes.py')], ['rover', resolve('runtime/hayai/worker.py')]]) {
  const dir = join(root, who); await mkdir(dir);
  const items = context.bindings.map(b => ({ image: b.raster, regions: b.manifest, output: join(dir, `${b.pageId}.json`) }));
  const batch = join(dir, 'batch.json'); await writeFile(batch, JSON.stringify({ items }));
  const started = performance.now();
  let stdout = '', stderr = '';
  const code = await new Promise((res, rej) => {
    const p = spawn('/usr/bin/time', ['-v', pythonOverride ?? context.python, '-u', script, '--batch', batch, '--progress', join(dir, 'progress.jsonl'), '--device', device], { env });
    p.stdout.on('data', b => { stdout += b; }); p.stderr.on('data', b => { stderr += b; });
    p.on('error', rej); p.on('close', res);
  });
  await writeFile(join(dir, 'process.json'), JSON.stringify({ code, elapsedMs: performance.now() - started, stdout, stderr }, null, 2));
  assert.equal(code, 0, stderr); outputs[who] = await Promise.all(items.map(i => readFile(i.output, 'utf8').then(JSON.parse)));
  console.log(`${who}: exit ${code}`);
}
const comparisons = [];
for (const [index, binding] of context.bindings.entries()) {
  const payload = outputs.rover[index], manifest = JSON.parse(await readFile(binding.manifest, 'utf8'));
  assert.deepEqual(payload, outputs.reference[index]); // ALL fields, presence, array order, exact values.
  assert.equal(payload.items.length, manifest.dialogueRegions.length);
  assert.equal(payload.schemaVersion, 'hayai-ocr-regions-v1');
  assert.deepEqual(payload.model, { id: 'JustANormalTinkerer/hayai-ocr-v2', revision: '3608bb2075b9b39cb9f63e57251bca665de248cd', processorId: 'google/siglip2-base-patch16-naflex', processorRevision: 'b53b807d3a2d5e2b3911292f2d69e5341cdc064c' });
  const rover = normalizeHayai(payload, payload.width, payload.height, { sourceLanguage: 'ja' });
  const ref = reference.normalizeOcrBboxHintPayload(payload, { imageWidth: payload.width, imageHeight: payload.height, sourceLanguage: 'ja' });
  assert.deepEqual(rover, ref); // ALL normalized fields, no field selection or sorting.
  const stored = JSON.parse(await readFile(binding.hints, 'utf8'));
  assert.equal(stored.items.length, payload.items.length, 'Stored Carrot raw item count');
  const topLevelDifferences = [];
  for (const field of new Set([...Object.keys(payload), ...Object.keys(stored)])) {
    if (field === 'items') continue;
    try {
      assert.equal(Object.hasOwn(payload, field), Object.hasOwn(stored, field));
      assert.deepEqual(payload[field], stored[field]);
    } catch {
      topLevelDifferences.push({ field, freshPresent: Object.hasOwn(payload, field),
        storedPresent: Object.hasOwn(stored, field), fresh: payload[field], stored: stored[field] });
    }
  }
  const storedNormalized = reference.normalizeOcrBboxHintPayload(stored, { imageWidth: payload.width, imageHeight: payload.height, sourceLanguage: 'ja' });
  assert.equal(storedNormalized.length, rover.length, 'Stored Carrot normalized item count');
  const chapter = JSON.parse(await readFile(binding.chapter, 'utf8'));
  const page = chapter.pages.find(p => p.id === binding.pageId);
  const differences = [];
  const sourceUnboundIds = [];
  let textEqual = 0, sourceEqual = 0;
  for (let i = 0; i < rover.length; i++) {
    const a = rover[i], b = storedNormalized[i];
    const { ocrText: at, ...as } = a, { ocrText: bt, ...bs } = b;
    assert.deepEqual(as, bs); // deterministic normalized structure, text recorded separately.
    const regionId = manifest.dialogueRegions[i].regionId;
    const block = page.blocks.find(b => b.id === regionId);
    if (!block) sourceUnboundIds.push(regionId);
    if (at === bt) textEqual++;
    if ((at ?? '') === block?.sourceText) sourceEqual++;
    if (at !== bt || (block && (at ?? '') !== block.sourceText)) differences.push({ id: a.id, regionId, rover: at ?? '', stored: bt ?? '', sourceText: block?.sourceText });
  }
  comparisons.push({ pageId: binding.pageId, items: rover.length, pythonExact: true, normalizationExact: true, structureExact: true, textEqual, sourceEqual, sourceUnbound: sourceUnboundIds.length, sourceUnboundIds, topLevelDifferences, differences });
}
await writeFile(join(root, 'comparison.json'), JSON.stringify(comparisons, null, 2));
console.log(JSON.stringify(comparisons, null, 2));
