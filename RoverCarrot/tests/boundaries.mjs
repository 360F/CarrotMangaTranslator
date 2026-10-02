import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('src');
async function inspect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { await inspect(path); continue; }
    const source = await readFile(path, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) {
        assert.ok(specifier.startsWith('node:') || (specifier === 'sharp' && path === resolve('src/adapters/input.ts')), `Unexpected runtime dependency: ${specifier}`);
        continue;
      }
      const target = relative(root, resolve(dirname(path), specifier));
      assert.ok(!target.startsWith('..'), `Parent source import: ${path}: ${specifier}`);
      if (path.startsWith(resolve('src/core'))) assert.ok(!target.startsWith('adapters'), 'Core imports adapter');
      if (path.startsWith(resolve('src/pipeline'))) assert.ok(!target.startsWith('adapters'), 'Pipeline imports adapter');
    }
  }
}
await inspect(root);
console.log('Runtime imports stay within RoverCMT; Core/Pipeline do not import adapters.');
