import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../core/contracts.js';
import type { PreparedOcr, ReadOcr } from '../ocr/stage.js';
import { normalizeHayai } from '../ocr/normalization.js';

export function ocrCpuThreadEnv(device: string): Record<string, string> {
  return device === 'cpu' ? {
    MKL_NUM_THREADS: '2', NUMEXPR_NUM_THREADS: '2', OMP_NUM_THREADS: '2',
    OPENBLAS_NUM_THREADS: '2', VECLIB_MAXIMUM_THREADS: '2',
  } : {};
}
export function ocrTimeout(pageCount: number): number { return Math.max(60 * 60 * 1000, Math.max(1, pageCount) * 5 * 60 * 1000); }
export function runPython(python: string, args: string[], env: NodeJS.ProcessEnv, timeout: number,
  log: (type: string, fields: Record<string, unknown>) => void = () => {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false, stdout = '', stderr = '';
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      let end;
      while ((end = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, end); stdout = stdout.slice(end + 1);
        try { log('ocr-progress', JSON.parse(line)); } catch { log('ocr-stdout', { line }); }
      }
    });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-20000); log('ocr-stderr', { line: chunk }); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    // close follows process exit AND stream closure: no OCR process survives
    // into the next stage, including timeout and nonzero exits.
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`HayaiOCR timed out after ${timeout} ms`));
      else if (code !== 0) reject(new Error(`HayaiOCR exited ${code ?? signal}: ${stderr}`));
      else resolve();
    });
  });
}
export function hayaiReader(config: NonNullable<Config['ocr']>, root: string,
  log: (type: string, fields: Record<string, unknown>) => void = () => {}): ReadOcr {
  return async (inputs: PreparedOcr[]) => {
    await mkdir(root, { recursive: true });
    const items = [];
    for (const input of inputs) {
      const dir = join(root, input.pageId); await mkdir(dir, { recursive: true });
      const regions = join(dir, 'workflow-regions.json'), output = join(dir, 'ocr-bbox-hints.json');
      await writeFile(regions, JSON.stringify(input.manifest));
      items.push({ image: input.page.imagePath, regions, output });
    }
    const batch = join(root, 'batch.json');
    await writeFile(batch, JSON.stringify({ items }));
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONPATH: '', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
      HF_HOME: config.hfCache, HF_HUB_CACHE: join(config.hfCache, 'hub'), HF_MODULES_CACHE: join(config.hfCache, 'modules'),
      HF_HUB_DISABLE_XET: '1', MANGA_TRANSLATOR_OCR_GPU_BACKEND: 'cuda',
      ...ocrCpuThreadEnv(config.device) };
    await runPython(config.python, ['-u', fileURLToPath(new URL('../../runtime/hayai/worker.py', import.meta.url)),
      '--batch', batch, '--progress', join(root, 'progress.jsonl'), '--device', config.device], env,
      config.timeoutMs ?? ocrTimeout(items.length), log);
    return Promise.all(items.map(async (item, index) => {
      const payload = JSON.parse(await readFile(item.output, 'utf8'));
      if (payload.schemaVersion !== 'hayai-ocr-regions-v1') throw new Error('Unsupported HayaiOCR output');
      const page = inputs[index]!.page;
      return normalizeHayai(payload, page.width, page.height, { sourceLanguage: config.sourceLanguage });
    }));
  };
}
