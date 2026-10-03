import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const revision = '9e3b928fd8c9d14dbf15a8768b9fdd7e5c721d66';
const templateSha = 'ae53464bf3be25802b3a5b37def7fd89667067d7577049b3b2d74c4d8de4c6d4';
export function launchArgs(config, templatePath) {
  // D32 fixed configuration. Ordered as launch-arguments.cjs buildLaunchArgs.
  return ['-m', config.modelPath, '--mmproj', config.mmprojPath,
    '--host', '127.0.0.1', '--port', String(config.port ?? 18180), '--repeat-last-n', '256',
    '--repeat-penalty', '1.08', '--presence-penalty', '0', '--frequency-penalty', '0',
    '--temp', '0.2', '--top-k', '64', '--top-p', '0.95', '--min-p', '0.0', '-rea', 'off',
    '--reasoning-budget', '0', '--fit', 'on', '--fit-target', '1024', '--fit-ctx', '65536',
    '-ngl', 'auto', '-fa', 'on', '-c', '65536', '-b', '1024', '-ub', '1024', '-np', '1',
    '--no-cache-prompt', '--no-warmup', '--mmproj-offload', '--cache-ram', '0',
    '--jinja', '--chat-template-file', templatePath, '--metrics', '--perf',
    '--cache-type-k', 'q4_0', '--cache-type-v', 'q4_0', '--kv-offload', '--ctx-checkpoints', '0',
    '--image-min-tokens', '1024', '--image-max-tokens', '1024',
    '--log-timestamps', '--log-prefix', '--log-colors', 'off'];
}
async function sha(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyInventory(root, identity) {
  if (identity.revision !== revision || identity.cuda !== '13.3') throw new Error('USER_DECISION_REQUIRED: unexpected llama.cpp revision');
  if (!Array.isArray(identity.inventory) || !identity.inventory.some(f => f.file === 'llama-server') || resolve(identity.binary) !== join(root, 'bin/llama-server')) throw new Error('Invalid llama-server identity inventory');
  for (const file of identity.inventory) {
    const name = file.file ?? file.name;
    if (!name || basename(name) !== name) throw new Error('Invalid binary inventory path');
    const path = join(root, 'bin', name);
    if ((await stat(path)).size !== file.bytes || await sha(path) !== file.sha256)
      throw new Error(`llama-server runtime integrity failed: ${name}`);
  }
}
export async function preflight(config, projectRoot, signal) {
  signal?.throwIfAborted();
  const binary = resolve(config.serverPath);
  const runtimeRoot = dirname(dirname(binary));
  await access(binary, constants.X_OK);
  const identity = JSON.parse(await readFile(join(runtimeRoot, 'binary-identity.json'), 'utf8'));
  await verifyInventory(runtimeRoot, identity);
  const pins = JSON.parse(await readFile(join(projectRoot, 'runtime/llama/model-pins.json'), 'utf8'));
  // A successful identity receipt avoids rehashing 22GB per page. Pin + path + size
  // + exact mtime bind it. A changed file requires explicit identity verification.
  const receipts = JSON.parse((await readFile(config.modelIdentityPath, 'utf8')).replace(/("mtimeNs"\s*:\s*)([0-9]+)/g, '$1"$2"'));
  for (const [i, path] of [config.modelPath, config.mmprojPath].entries()) {
    const info = await stat(path, { bigint: true });
    const pin = pins[i], receipt = receipts.find(r => r.path === path);
    if (!info.isFile() || basename(path) !== pin.file || info.size !== BigInt(pin.bytes) ||
      receipt?.sha256 !== pin.sha256 || receipt?.bytes !== pin.bytes ||
      BigInt(String(receipt?.mtimeNs)) !== info.mtimeNs)
      throw new Error(`Model identity changed; verify pinned SHA once and refresh receipt: ${path}`);
  }
  const template = join(projectRoot, 'runtime/llama/templates/gemma4-26b-4d7ae498.jinja');
  if ((await stat(template)).size !== 18683 || await sha(template) !== templateSha)
    throw new Error('Pinned Gemma chat template integrity failed');
  const env = { ...process.env, LD_LIBRARY_PATH: [join(runtimeRoot, 'cuda/lib64'), join(runtimeRoot, 'bin'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  const probe = await ownedProcess(binary, ['--list-devices'], { env, signal, timeoutMs: 60000 });
  if (probe.code !== 0 || !/CUDA\d+|CUDA.*(?:NVIDIA|RTX)/i.test(probe.output))
    throw new Error(`USER_DECISION_REQUIRED: llama-server CUDA preflight failed: ${probe.output}`);
  await verifyInventory(runtimeRoot, identity);
  return { binary, env, template, identity, models: pins };
}
function exited(child) { return child.exitCode !== null || child.signalCode !== null; }
async function waitExit(child, ms) {
  if (exited(child)) return true;
  let timer;
  return new Promise(resolve => {
    const done = value => { clearTimeout(timer); child.removeListener('exit', onExit); child.removeListener('error', onExit); child.removeListener('close', onExit); resolve(value); };
    const onExit = () => done(true);
    child.once('exit', onExit); child.once('error', onExit); child.once('close', onExit);
    timer = setTimeout(() => done(false), ms);
  });
}
export async function stopOwned(child, { gracefulMs = 5000, killMs = 5000, onSignal = () => {} } = {}) {
  if (!child || !child.pid || exited(child)) return;
  // Match reference non-Windows stopServer: one SIGTERM, then a 5s bound.
  // A second interrupt would terminate llama-server during cleanup with code 1.
  onSignal('SIGTERM'); child.kill('SIGTERM');
  if (await waitExit(child, gracefulMs)) return;
  onSignal('SIGKILL'); child.kill('SIGKILL');
  if (!await waitExit(child, killMs)) throw new Error('Owned llama-server failed to exit after SIGKILL');
}
async function ownedProcess(binary, args, { env, signal, timeoutMs }) {
  const child = spawn(binary, args, { env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error;
  child.stdout.on('data', b => { output = (output + b).slice(-16384); });
  child.stderr.on('data', b => { output = (output + b).slice(-16384); });
  child.on('error', e => { error = e; });
  let disposal;
  const dispose = () => disposal ??= stopOwned(child);
  const abort = () => { void dispose().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (!await waitExit(child, timeoutMs)) throw new Error('llama-server probe timed out');
    signal?.throwIfAborted();
    if (error) throw error;
    return { code: child.exitCode, output };
  } finally { signal?.removeEventListener('abort', abort); await dispose(); }
}
export async function startManaged(config, prepared, { signal, pollingMs = 1500, readyTimeoutMs = 1800000, stopOptions, log = () => {} } = {}) {
  signal?.throwIfAborted();
  const baseUrl = `http://127.0.0.1:${config.port ?? 18180}/v1`;
  // Refuse a busy port; never reuse or terminate a caller-owned endpoint.
  const { createServer } = await import('node:net');
  await new Promise((resolve, reject) => {
    const probe = createServer(); probe.once('error', reject);
    probe.listen(config.port ?? 18180, '127.0.0.1', () => probe.close(resolve));
  });
  const args = launchArgs(config, prepared.template);
  const child = spawn(prepared.binary, args, { env: prepared.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  log('llama-start', { pid: child.pid, binary: prepared.binary, args });
  let output = '', launchError, disposal;
  child.stdout.on('data', b => { output = (output + b).slice(-65536); log('llama-stdout', { text: String(b) }); });
  child.stderr.on('data', b => { output = (output + b).slice(-65536); log('llama-stderr', { text: String(b) }); });
  child.on('error', e => { launchError = e; });
  const dispose = () => disposal ??= stopOwned(child, { ...stopOptions, onSignal: value => {
    log('llama-stop-signal', { pid: child.pid, signal: value }); stopOptions?.onSignal?.(value);
  } }).finally(() => { signal?.removeEventListener('abort', abort); log('llama-stopped', { pid: child.pid, code: child.exitCode, signal: child.signalCode }); });
  const abort = () => { void dispose().catch(e => log('llama-stop-error', { message: String(e) })); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const started = Date.now();
    while (Date.now() - started < readyTimeoutMs) {
      signal?.throwIfAborted();
      if (launchError) throw launchError;
      if (exited(child)) throw new Error(`llama-server exited before readiness: ${child.exitCode}/${child.signalCode}`);
      try {
        const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.any([AbortSignal.timeout(2500), ...(signal ? [signal] : [])]) });
        const ok = response.ok; await response.body?.cancel();
        if (ok) {
          signal?.throwIfAborted();
          if (exited(child)) throw new Error('llama-server exited at readiness');
          return { baseUrl, child, args, dispose, output: () => output };
        }
      } catch (error) { if (signal?.aborted) throw error; }
      await delay(pollingMs, undefined, signal ? { signal } : undefined);
    }
    throw new Error(`Timed out while waiting for llama-server at ${baseUrl}`);
  } catch (error) {
    await dispose();
    throw new Error(`${error.message}\n${output}`, { cause: error });
  }
}
