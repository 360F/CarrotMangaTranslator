import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { run } from '../dist/core/run.js';
import { loadConfig, resolveConfig } from '../dist/core/config.js';
import { libraryPersistence } from '../dist/adapters/library.js';
import { smokeStages } from '../dist/adapters/smoke.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'rovercmt-step1-'));
  await writeFile(join(dir, 'page.png'), png);
  const raw = { version: 1, mode: 'smoke', input: 'page.png', output: 'library' };
  await writeFile(join(dir, 'config.json'), JSON.stringify(raw));
  return { dir, config: await loadConfig(join(dir, 'config.json')) };
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
test('CLI config paths resolve against config directory; output follows loader layout', async () => {
  const { dir, config } = await fixture();
  const child = spawnSync(process.execPath, ['dist/cli.js', '--config', join(dir, 'config.json')], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.status, 'completed'); assert.equal(result.mode, 'smoke');
  const events = child.stderr.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].type, 'stage-start');
  assert.ok(events.filter(e => e.type === 'stage-end').every(e => e.elapsedMs >= 0));
  assert.equal((await chapter(config.output)).status, 'idle');
  const saved = JSON.parse(await readFile(join(config.output, 'runs', `${result.runId}.json`), 'utf8'));
  assert.deepEqual(saved, result);
});
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
  assert.equal(failed.status, 'failed'); assert.match(failed.issues[0].message, /EEXIST/);
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
