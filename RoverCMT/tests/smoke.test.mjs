import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { STAGES } from '../dist/core/contracts.js';
import { resolveConfig } from '../dist/core/config.js';
import { libraryPersistence } from '../dist/adapters/library.js';
import { smokeStages } from '../dist/adapters/smoke.js';
import { run } from '../dist/core/run.js';

const fixtures = Object.fromEntries(await Promise.all(['png', 'jpeg', 'webp'].map(async format =>
  [format, await readFile(new URL(`./fixtures/page.${format}`, import.meta.url))])));
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'rovercmt-input-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = resolveConfig({ version: 1, mode: 'smoke', input: 'input', output: 'output' }, dir);
  return { dir, config };
}
async function execute(config) {
  return run(config, { persistence: libraryPersistence(), stages: smokeStages() });
}
async function loadChapter(output) {
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  const index = await json(join(output, 'index.json'));
  const workDir = join(output, 'works', index.workOrder[0]);
  const work = await json(join(workDir, 'work.json'));
  return json(join(workDir, 'chapters', work.chapterOrder[0], 'chapter.json'));
}
for (const [extension, format] of Object.entries({ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', jfif: 'jpeg', webp: 'webp', JPG: 'jpeg' })) {
  test(`single ${extension}: decode, dimensions, original copy and idle state`, async t => {
    const { dir, config } = await setup(t);
    config.input = join(dir, `page.${extension}`);
    await writeFile(config.input, fixtures[format]);
    const result = await execute(config);
    assert.equal(result.status, 'completed', JSON.stringify(result.issues));
    const { pages } = await loadChapter(config.output);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].width, 3); assert.equal(pages[0].height, 2);
    assert.equal(pages[0].analysisStatus, 'idle');
    assert.equal(extname(pages[0].imagePath), extension === 'jfif' ? '.jpg' : `.${extension.toLowerCase()}`);
    assert.deepEqual(await readFile(pages[0].imagePath), fixtures[format]);
  });
}
test('explicit CLI config: mixed directory natural order, ignores unsupported files and nested directories', async t => {
  const { dir, config } = await setup(t);
  await mkdir(config.input);
  const names = ['10.jpg', '2.webp', '1.png', '3.jpeg', '4.jfif'];
  for (const name of names) await writeFile(join(config.input, name), fixtures[name.endsWith('png') ? 'png' : name.endsWith('webp') ? 'webp' : 'jpeg']);
  await writeFile(join(config.input, 'notes.txt'), 'private note');
  await mkdir(join(config.input, 'nested'));
  await writeFile(join(config.input, 'nested', '5.png'), fixtures.png);
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ version: 1, mode: 'smoke', input: 'input', output: 'output' }));
  const child = spawnSync(process.execPath, ['dist/cli.js', '--config', path], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, 'completed');
  assert.equal(result.events.filter(e => e.type === 'stage-start').length, 5 * STAGES.length);
  const chapter = await loadChapter(config.output);
  assert.deepEqual(chapter.pages.map(p => p.name), ['1.png', '2.webp', '3.jpeg', '4.jfif', '10.jpg']);
  for (const page of chapter.pages) {
    assert.equal(page.width, 3); assert.equal(page.height, 2);
    assert.deepEqual(await readFile(page.imagePath), await readFile(join(config.input, page.name)));
  }
  assert.deepEqual(JSON.parse(await readFile(join(config.output, 'runs', `${result.runId}.json`), 'utf8')), result);
});
for (const format of ['png', 'jpeg', 'webp']) {
  test(`corrupt ${format} fails before output creation`, async t => {
    const { dir, config } = await setup(t);
    config.input = join(dir, `broken.${format}`);
    await writeFile(config.input, fixtures[format].subarray(0, Math.floor(fixtures[format].length / 2)));
    const result = await execute(config);
    assert.equal(result.status, 'failed'); assert.match(result.issues[0].message, /Invalid image/);
    await assert.rejects(access(config.output));
  });
}
test('extension mismatch and unsupported single file fail; invalid supported member fails whole directory', async t => {
  const { dir, config } = await setup(t);
  for (const [name, bytes] of [['wrong.png', fixtures.jpeg], ['page.txt', fixtures.png], ['bad.jpg', Buffer.from('invalid')]]) {
    config.input = join(dir, name); await writeFile(config.input, bytes);
    assert.equal((await execute(config)).status, 'failed');
    await assert.rejects(access(config.output));
  }
  config.input = join(dir, 'mixed'); await mkdir(config.input);
  await writeFile(join(config.input, '1.png'), fixtures.png);
  await writeFile(join(config.input, '2.jpg'), 'invalid');
  assert.equal((await execute(config)).status, 'failed');
  await assert.rejects(access(config.output));
});
test('directory without supported images has an actionable failure', async t => {
  const { config } = await setup(t); await mkdir(config.input);
  await writeFile(join(config.input, 'notes.txt'), 'ignored');
  const result = await execute(config);
  assert.equal(result.status, 'failed'); assert.match(result.issues[0].message, /No supported image inputs/);
  await assert.rejects(access(config.output));
});
