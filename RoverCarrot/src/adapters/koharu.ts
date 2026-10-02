import { resizeDetectorRgb } from './detection-resize.js';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, basename } from 'node:path';
import { availableParallelism } from 'node:os';
import sharp from 'sharp';
import { KOHARU_LAYOUT_ONNX_FILE, KOHARU_LAYOUT_ONNX_BYTES, KOHARU_LAYOUT_ONNX_SHA256 } from '../detection/constants.js';

export type PreparedImage = { width: number; height: number; data: Float32Array; dims: number[] };
export type KoharuRuntime = {
  infer: (image: PreparedImage) => Promise<Record<string, unknown>>;
  close?: () => Promise<void>;
};
export type DetectionLog = (type: string, fields: Record<string, unknown>) => void;

export async function prepareImage(path: string): Promise<PreparedImage> {
  try {
    const image = sharp(path, { failOn: 'warning', limitInputPixels: 120_000_000 });
    const metadata = await image.metadata();
    const { data: source, info } = await image.toColourspace('srgb').flatten({ background: '#000000' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (!metadata.width || !metadata.height || info.width !== metadata.width || info.height !== metadata.height || info.channels !== 3)
      throw new Error('Expected a complete source RGB raster');
    const data = resizeDetectorRgb(source, info.width, info.height);
    const pixels = 1152 * 1152;
    const tensor = new Float32Array(3 * pixels);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let c = 0; c < 3; c++) for (let p = 0; p < pixels; p++)
      tensor[c * pixels + p] = (data[p * 3 + c]! / 255 - mean[c]!) / std[c]!;
    return { width: metadata.width, height: metadata.height, data: tensor, dims: [1, 3, 1152, 1152] };
  } catch (error) {
    throw new Error(`Koharu image decode/preprocessing failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export async function checkModel(path: string) {
  if (!path || !isAbsolute(path)) throw new Error('models.koharu must be a non-empty absolute path');
  if (basename(path) !== KOHARU_LAYOUT_ONNX_FILE) throw new Error(`Koharu model filename must be ${KOHARU_LAYOUT_ONNX_FILE}`);
  const info = await stat(path).catch(error => { throw new Error('Koharu model file not found or unreadable', { cause: error }); });
  if (!info.isFile() || info.size !== KOHARU_LAYOUT_ONNX_BYTES) throw new Error('Koharu model byte size mismatch');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  if (sha256 !== KOHARU_LAYOUT_ONNX_SHA256) throw new Error('Koharu model SHA-256 mismatch');
  return { filename: basename(path), bytes: info.size, sha256 };
}

// One lazy session per run, shared across pages; no raw output cache.
export function koharuRuntime(path: string, log: DetectionLog = () => {}): KoharuRuntime {
  let pending: Promise<import('onnxruntime-node').InferenceSession> | undefined;
  let ort: typeof import('onnxruntime-node');
  const create = async () => {
    log('detect-model', await checkModel(path));
    try { ort = await import('onnxruntime-node'); }
    catch (error) { log('detect-runtime-failure', { phase: 'native-load', cause: String(error) }); throw new Error('Koharu native ONNX Runtime load failed', { cause: error }); }
    const start = performance.now();
    let session: import('onnxruntime-node').InferenceSession;
    try {
      session = await ort.InferenceSession.create(path, { executionProviders: ['cpu'], executionMode: 'sequential',
        graphOptimizationLevel: 'all', intraOpNumThreads: Math.max(1, Math.min(8, availableParallelism())),
        interOpNumThreads: 1, enableMemPattern: true });
    } catch (error) { log('detect-runtime-failure', { phase: 'session', cause: String(error) }); throw new Error('Koharu CPU ONNX session creation failed', { cause: error }); }
    if (!session.inputNames.includes('input') || !['dets', 'labels', 'masks'].every(name => session.outputNames.includes(name))) {
      await session.release(); throw new Error('Koharu input/output name mismatch');
    }
    const contracts = [
      ['input', [1, 3, 1152, 1152]], ['dets', [1, 300, 4]], ['labels', [1, 300, 5]], ['masks', [1, 300, 288, 288]],
    ] as const;
    for (const [name, shape] of contracts) {
      const metadata = [...session.inputMetadata, ...session.outputMetadata].find(entry => entry.name === name);
      if (!metadata?.isTensor || metadata.type !== 'float32' || metadata.shape.join(',') !== shape.join(',')) {
        await session.release(); throw new Error(`Koharu ${name} metadata type/shape mismatch`);
      }
    }
    log('detect-session', { provider: 'cpu', platform: process.platform, arch: process.arch, elapsedMs: performance.now() - start,
      inputNames: session.inputNames, outputNames: session.outputNames, inputMetadata: session.inputMetadata, outputMetadata: session.outputMetadata });
    return session;
  };
  return {
    async infer(image) {
      if (image.dims.join(',') !== '1,3,1152,1152' || image.data.length !== 3 * 1152 * 1152)
        throw new Error('Koharu input tensor shape mismatch');
      const session = await (pending ??= create());
      const input = new ort.Tensor('float32', image.data, image.dims);
      try {
        const outputs = await session.run({ input }, ['dets', 'labels', 'masks']);
        // Transfer numeric data ownership before disposing native tensors.
        try { return Object.fromEntries(Object.entries(outputs).map(([name, tensor]) =>
          [name, { dims: [...tensor.dims], type: tensor.type, data: Float32Array.from(tensor.data as Float32Array) }])); }
        finally { for (const tensor of Object.values(outputs)) tensor.dispose(); }
      } catch (error) { log('detect-runtime-failure', { phase: 'inference', cause: String(error) }); throw new Error('Koharu ONNX inference failed', { cause: error }); }
      finally { input.dispose(); }
    },
    async close() {
      if (!pending) return;
      // A failed creation has no native handle; its inference caller owns that error.
      const session = await pending.catch(() => undefined);
      pending = undefined;
      if (session) await session.release();
    },
  };
}
