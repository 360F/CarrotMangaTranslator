import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join, win32, isAbsolute } from 'node:path';
import { cpus, platform, arch, release } from 'node:os';
import { createHash } from 'node:crypto';
import { checkModel, koharuRuntime, prepareImage } from './adapters/koharu.js';
import { parseKoharuLayoutOutputs } from './detection/outputs.js';
import { buildHayaiRegionManifest, type HayaiRegionManifest } from './detection/geometry.js';

const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i]!, value = process.argv[i + 1];
  if (!['--context', '--model', '--data-root', '--output', '--reference-tensor'].includes(flag) || args[flag] || !value)
    throw new Error('Usage: validate:detect -- --context <LOCAL_CONTEXT> [--model <ABS_MODEL>] [--data-root <ABS_ROOT>] [--output <NEW_DIR>]');
  args[flag] = value;
}
const contextPath = resolve(args['--context'] ?? 'test-data/validation/m1-step2/validation-context.json');
const context = JSON.parse(await readFile(contextPath, 'utf8'));
const model = args['--model'] ?? context.model;
const root = args['--data-root'] ?? context.dataRoot;
if (!isAbsolute(model) || !isAbsolute(root) || resolve(root) !== resolve(context.dataRoot)) throw new Error('Absolute model/data-root and context binding required');
const output = resolve(args['--output'] ?? join(dirname(contextPath), `run-${Date.now()}`));
await mkdir(output); // Never replace earlier evidence.
const save = async (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
await save('environment.json', { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model,
  node: process.version, onnxruntime: '1.27.0', provider: 'cpu', distro: await readFile('/etc/os-release', 'utf8') });
const identity = await checkModel(model);
await save('model-check.json', identity);
const chapter = JSON.parse(await readFile(context.chapter, 'utf8'));
const page = chapter.pages.find((entry: { id: string }) => entry.id === context.pageId);
if (!page) throw new Error('Reference page missing from chapter');
const pagePath = context.page ?? join(dirname(context.chapter), 'pages', win32.basename(page.imagePath));
const reference: HayaiRegionManifest = JSON.parse(await readFile(context.reference, 'utf8'));
const runtimeEvents: unknown[] = [];
const runtime = koharuRuntime(model, (type, fields) => runtimeEvents.push({ type, ...fields }));
let status = 'BLOCKED';
try {
  const start = performance.now();
  const prepared = await prepareImage(pagePath);
  if (args['--reference-tensor']) {
    const bytes = await readFile(args['--reference-tensor']);
    if (bytes.length !== prepared.data.byteLength) throw new Error('Reference preprocessing tensor byte length mismatch');
    const external = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (!external.every(Number.isFinite)) throw new Error('Nonfinite reference tensor');
    let count = 0, sum = 0, max = 0;
    for (let i = 0; i < external.length; i++) {
      const delta = Math.abs(external[i]! - prepared.data[i]!);
      if (delta) count++;
      sum += delta; max = Math.max(max, delta);
    }
    await save('preprocessing-comparison.json', { differentValues: count, total: external.length, meanAbsoluteDelta: sum / external.length, maxAbsoluteDelta: max });
    prepared.data = external;
  }
  if (prepared.width !== reference.width || prepared.height !== reference.height) throw new Error('Reference/source page dimensions disagree');
  const tensorHash = createHash('sha256').update(new Uint8Array(prepared.data.buffer)).digest('hex');
  const inferStart = performance.now();
  const raw = await runtime.infer(prepared);
  const postStart = performance.now();
  const detections = parseKoharuLayoutOutputs(raw, prepared);
  const actual = buildHayaiRegionManifest({ imageWidth: prepared.width, imageHeight: prepared.height, detections, executionProvider: 'cpu' });
  await save('runtime.json', { events: runtimeEvents, preprocessingMs: inferStart - start, inferenceIncludingSessionMs: postStart - inferStart,
    postprocessMs: performance.now() - postStart, tensorHash, tensorShape: prepared.dims,
    outputShapes: Object.fromEntries(Object.entries(raw).map(([name, tensor]) => [name, (tensor as { dims: number[] }).dims])) });
  await save('actual-regions.json', actual);
  const rows = (['dialogueRegions', 'effectRegions'] as const).flatMap(kind => {
    const old = reference[kind], next = actual[kind];
    return Array.from({ length: Math.max(old.length, next.length) }, (_, order) => {
      const a = old[order], b = next[order];
      if (!a || !b) return { kind, order, reference: a, actual: b, missing: true };
      const intersection = Math.max(0, Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0])) *
        Math.max(0, Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]));
      const area = (r: typeof a) => (r.bbox[2] - r.bbox[0]) * (r.bbox[3] - r.bbox[1]);
      return { kind, order, reference: a, actual: b, iou: intersection / (area(a) + area(b) - intersection),
        coordinateDelta: b.bbox.map((value, i) => value - a.bbox[i]!), confidenceDelta: b.detectorConfidence - a.detectorConfidence,
        sameProvenance: JSON.stringify(a.sourceDetectionIds) === JSON.stringify(b.sourceDetectionIds),
        sameSubdivision: JSON.stringify(a.ocrSubdivision) === JSON.stringify(b.ocrSubdivision) };
    });
  });
  const sameCounts = reference.dialogueRegions.length === actual.dialogueRegions.length && reference.effectRegions.length === actual.effectRegions.length;
  // Compare ordered detection provenance instead of assigning arbitrary IoU tolerances.
  const sameOrder = sameCounts && rows.every(row => row.sameProvenance && row.reference?.kind === row.actual?.kind);
  const values = rows.flatMap(row => row.iou === undefined ? [] : [row.iou]);
  status = sameOrder ? 'IN_PROGRESS' : 'BLOCKED';
  await save('comparison.json', { status, notes: sameOrder ? 'IMPLEMENTED — independent validation pending; numerical differences require review' : 'count/type/order/provenance discrepancy requires investigation',
    pageId: page.id, sourceSha256: createHash('sha256').update(await readFile(pagePath)).digest('hex'),
    referenceCounts: [reference.dialogueRegions.length, reference.effectRegions.length], actualCounts: [actual.dialogueRegions.length, actual.effectRegions.length],
    sameCounts, sameOrder, exact: JSON.stringify(reference) === JSON.stringify(actual),
    iou: { min: Math.min(...values), mean: values.reduce((a,b) => a+b,0)/values.length, max: Math.max(...values) }, rows });
  await save('subdivision-comparison.json', { exact: rows.every(row => row.sameSubdivision),
    rows: rows.filter(row => row.kind === 'dialogueRegions').map(row => ({ order: row.order, reference: row.reference?.ocrSubdivision,
      actual: row.actual?.ocrSubdivision, exact: row.sameSubdivision })) });
  console.log(`Detection validation: ${status}; evidence: ${output}`);
  if (status === 'BLOCKED') process.exitCode = 1;
} catch (error) {
  await save('failure.json', { status: 'BLOCKED', message: String(error), stack: error instanceof Error ? error.stack : undefined });
  throw error;
} finally { await runtime.close?.(); }
