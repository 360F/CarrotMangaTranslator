// Shared helpers for CLI tests. Every CLI run uses a temporary project root, so the
// real config/config.toml and logs/ of this checkout are never read or written.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../dist/cli/app.js';

export const realRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const fixtureText = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

export async function tempRoot(t, configText) {
  const root = await mkdtemp(join(tmpdir(), 'rovercmt-root-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (configText !== undefined) {
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config', 'config.toml'), configText);
  }
  return root;
}

export async function cli({ root, cwd = root, argv = [], tty = false, env = { LANG: 'C.UTF-8' }, stages }) {
  let out = '';
  const code = await runCli({ argv, projectRoot: root, cwd, isTTY: tty, env, stages, write: text => { out += text; } });
  return { code, out };
}

export async function runRecord(output) {
  const [name, ...rest] = await readdir(join(output, 'runs'));
  assert.equal(rest.length, 0);
  return JSON.parse(await readFile(join(output, 'runs', name), 'utf8'));
}

export async function logLines(root, name) {
  try {
    return (await readFile(join(root, 'logs', name), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Fingerprint of the checkout's real user config and logs (must not change during tests).
export async function realState() {
  const describe = async path => {
    try {
      const info = await stat(path);
      if (!info.isDirectory()) return `${info.size}@${info.mtimeMs}`;
      const names = (await readdir(path)).sort();
      return (await Promise.all(names.map(async name => `${name}:${await describe(join(path, name))}`))).join(',');
    } catch (error) {
      if (error.code === 'ENOENT') return 'missing';
      throw error;
    }
  };
  return [await describe(join(realRoot, 'config', 'config.toml')), await describe(join(realRoot, 'logs'))].join('|');
}
