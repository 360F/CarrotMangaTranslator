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
        const allowed = { sharp: ['src/adapters/input.ts', 'src/adapters/koharu.ts', 'src/adapters/translation-images.mjs'], 'smol-toml': ['src/cli/config-file.ts'], 'onnxruntime-node': ['src/adapters/koharu.ts'] };
        assert.ok(specifier.startsWith('node:') || (allowed[specifier] ?? []).some(file => path === resolve(file)), `Unexpected runtime dependency: ${specifier}`);
        continue;
      }
      const target = relative(root, resolve(dirname(path), specifier));
      assert.ok(!target.startsWith('..'), `Parent source import: ${path}: ${specifier}`);
      for (const layer of ['core', 'pipeline'])
        if (path.startsWith(resolve('src', layer)))
          assert.ok(!target.startsWith('adapters') && !target.startsWith('cli'), `${layer} imports adapter/CLI: ${specifier}`);
    }
  }
}
await inspect(root);
console.log('Runtime imports stay within RoverCMT; Core/Pipeline do not import adapters or CLI.');
