import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../dist/core/run.js';
import { resolveConfig } from '../dist/core/config.js';
import { cli, tempRoot, runRecord } from './cli-helpers.mjs';
import { libraryPersistence } from '../dist/adapters/library.js';
import { smokeStages } from '../dist/adapters/smoke.js';
const png = await readFile(new URL('./fixtures/pixel.png', import.meta.url));
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'rovercmt-step1-'));
  await writeFile(join(dir, 'page.png'), png);
  const raw = { version: 1, mode: 'smoke', input: 'page.png', output: 'library' };
  return { dir, config: resolveConfig(raw, dir) };
}
async function chapter(output) {
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  const index = await json(join(output, 'index.json'));
  assert.deepEqual(Object.keys(index), ['workOrder']);
  const workDir = join(output, 'works', index.workOrder[0]);
  const work = await json(join(workDir, 'work.json'));
  assert.equal(work.id, index.workOrder[0]);
  const chapterDir = join(workDir, 'chapters', work.chapterOrder[0]);
  const record = await json(join(chapterDir, 'chapter.json'));
  assert.equal(record.workId, work.id);
  assert.equal(record.id, work.chapterOrder[0]);
  assert.deepEqual(record.pageOrder, record.pages.map(page => page.id));
  for (const page of record.pages) {
    assert.ok(page.imagePath.startsWith(chapterDir + '/pages/'));
    assert.equal(page.width, 1); assert.equal(page.height, 1);
    assert.deepEqual(await readFile(page.imagePath), png);
    assert.equal(page.analysisStatus, 'idle');
    assert.ok(!('dataUrl' in page)); assert.ok(!('pageWorkflow' in page));
  }
  return record;
}
test('CLI: input/output resolve against CWD, not the project root; output follows loader layout', async t => {
  const { dir, config } = await fixture();
  const root = await tempRoot(t, 'version = 1\nmode = "smoke"\n[paths]\ninput = "page.png"\noutput = "library"\n');
  const { code, out } = await cli({ root, cwd: dir });
  assert.equal(code, 0, out);
  assert.ok(!out.includes('{'), out);
  const result = await runRecord(config.output);
  assert.equal(result.status, 'completed'); assert.equal(result.mode, 'smoke');
  assert.equal(result.events[0].type, 'stage-start');
  assert.ok(result.events.filter(e => e.type === 'stage-end').every(e => e.elapsedMs >= 0));
  assert.equal((await chapter(config.output)).status, 'idle');
  assert.equal(result.output, join(dir, 'library'));
  await assert.rejects(readdir(join(root, 'library')));
  await assert.rejects(readdir(join(root, 'config', 'library')));
});
test('config input/output are defaults; overrides win; relative paths use base, absolute stay', () => {
  const raw = { version: 1, mode: 'smoke', input: 'in', output: 'out' };
  const pick = c => [c.input, c.output];
  assert.deepEqual(pick(resolveConfig(raw, '/work')), ['/work/in', '/work/out']);
  assert.deepEqual(pick(resolveConfig(raw, '/work', { input: 'other' })), ['/work/other', '/work/out']);
  assert.deepEqual(pick(resolveConfig(raw, '/work', { output: 'run2' })), ['/work/in', '/work/run2']);
  assert.deepEqual(pick(resolveConfig(raw, '/work', { input: '/abs/in', output: '/abs/out' })), ['/abs/in', '/abs/out']);
  assert.deepEqual(pick(resolveConfig({ ...raw, input: '/cfg/in' }, '/work')), ['/cfg/in', '/work/out']);
  assert.deepEqual(pick(resolveConfig({ version: 1, mode: 'smoke' }, '/work', { input: 'a', output: 'b' })), ['/work/a', '/work/b']);
  assert.equal(resolveConfig(raw).input, join(process.cwd(), 'in'));
  assert.throws(() => resolveConfig({ version: 1, mode: 'smoke', output: 'out' }, '/work'), /input path is required/);
  assert.throws(() => resolveConfig({ version: 1, mode: 'smoke', input: 'in' }, '/work'), /output path is required/);
  for (const bad of [{ input: '' }, { input: 3 }, { output: '  ' }])
    assert.throws(() => resolveConfig({ ...raw, ...bad }, '/work'), /non-empty path/);
  assert.throws(() => resolveConfig(raw, '/work', { output: '' }), /non-empty path/);});
test('programmatic Core boundary executes stage-major across naturally ordered pages', async () => {
  const { dir, config } = await fixture();
  await mkdir(join(dir, 'input'));
  await writeFile(join(dir, 'input', '10.png'), png); await writeFile(join(dir, 'input', '2.png'), png);
  config.input = join(dir, 'input'); config.stages = ['ocr', 'detect'];
  const result = await run(config, { persistence: libraryPersistence(), stages: smokeStages() });
  assert.equal(result.status, 'completed');
  const starts = result.events.filter(e => e.type === 'stage-start');
  assert.deepEqual(starts.map(e => e.stage), ['detect', 'detect', 'ocr', 'ocr']);
  assert.deepEqual((await chapter(config.output)).pages.map(p => p.name), ['2.png', '10.png']);
});
test('page failures return partial, persist partial page and skip later stages for that page', async () => {
  const { config } = await fixture(); config.stages = ['detect', 'ocr'];
  const stages = smokeStages();
  stages[0].execute = async page => ({ status: 'failed', page: { ...page, analysisStatus: 'failed' }, message: 'fixture failure', retryable: true });
  const result = await run(config, { persistence: libraryPersistence(), stages });
  assert.equal(result.status, 'partial'); assert.equal(result.issues[0].stage, 'detect');
  assert.equal(result.events.filter(e => e.type === 'stage-start').length, 1);
  const records = await readdir(join(config.output, 'runs'));
  assert.equal(records.length, 1);
});
test('thrown provider and infrastructure failures are represented', async () => {
  const { config } = await fixture(); config.stages = ['detect'];
  const stages = smokeStages(); stages[0].execute = async () => { throw new Error('provider failed'); };
  const result = await run(config, { persistence: libraryPersistence(), stages });
  assert.equal(result.status, 'partial'); assert.equal(result.issues[0].message, 'provider failed');
  const failed = await run(config, { persistence: libraryPersistence(), stages });
  assert.equal(failed.status, 'failed'); assert.match(failed.issues[0].message, /Output directory already exists/);
  assert.equal((await readdir(join(config.output, 'runs'))).length, 1);
});
test('invalid configs and missing implementations fail before output writes', async () => {
  const { config } = await fixture();
  for (const patch of [{ version: 2 }, { mode: 'real' }, { stages: ['bad'] }, { stages: ['ocr', 'ocr'] }, { secret: 'no' }])
    assert.throws(() => resolveConfig({ ...config, ...patch }, '/tmp'));
  const result = await run(config, { persistence: libraryPersistence(), stages: [] });
  assert.equal(result.status, 'failed');
  await assert.rejects(readFile(join(config.output, 'index.json')));
});
test('invalid input fails before creating output', async () => {
  const { config } = await fixture();
  await writeFile(config.input, 'invalid');
  const result = await run(config, { persistence: libraryPersistence(), stages: smokeStages() });
  assert.equal(result.status, 'failed');
  await assert.rejects(readdir(config.output));
});
test('runtime dependency boundary check', () => {
  execFileSync(process.execPath, ['tests/boundaries.mjs'], { encoding: 'utf8' });
});

test('existing output and symlink destinations are refused without writes', async () => {
  const { dir, config } = await fixture();
  await mkdir(config.output);
  const sentinel = join(config.output, 'index.json');
  await writeFile(sentinel, 'user data');
  const result = await run(config, { persistence: libraryPersistence(), stages: smokeStages() });
  assert.equal(result.status, 'failed');
  assert.equal(await readFile(sentinel, 'utf8'), 'user data');
  const { symlink } = await import('node:fs/promises');
  const link = join(dir, 'linked-library');
  await symlink(config.output, link);
  config.output = link;
  assert.equal((await run(config, { persistence: libraryPersistence(), stages: smokeStages() })).status, 'failed');
  assert.deepEqual(await readdir(config.output), ['index.json']);
});

test('persistence failure produces failed run instead of successful provider completion', async () => {
  const { config } = await fixture();
  const persistence = libraryPersistence();
  persistence.commit = async () => { throw new Error('storage failure'); };
  const result = await run(config, { persistence, stages: smokeStages() });
  assert.equal(result.status, 'failed');
  assert.equal(result.issues[0].message, 'storage failure');
  assert.ok(!result.events.some(event => event.type === 'stage-end' && event.status === 'completed'));
});
