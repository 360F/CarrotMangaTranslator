import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, cp, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveConfig } from '../dist/core/config.js';
import { libraryPersistence } from '../dist/adapters/library.js';
import { smokeStages } from '../dist/adapters/smoke.js';
import { run } from '../dist/core/run.js';
import { cli, fixtureText, logLines, realRoot, realState, runRecord, tempRoot } from './cli-helpers.mjs';

const before = await realState();
after(async () => assert.equal(await realState(), before, 'tests must not touch the real config/config.toml or logs/'));

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
test('CLI with fixture config: mixed directory natural order, ignores unsupported files and nested directories', async t => {
  const { dir, config } = await setup(t);
  await mkdir(config.input);
  const names = ['10.jpg', '2.webp', '1.png', '3.jpeg', '4.jfif'];
  for (const name of names) await writeFile(join(config.input, name), fixtures[name.endsWith('png') ? 'png' : name.endsWith('webp') ? 'webp' : 'jpeg']);
  await writeFile(join(config.input, 'notes.txt'), 'private note');
  await mkdir(join(config.input, 'nested'));
  await writeFile(join(config.input, 'nested', '5.png'), fixtures.png);
  const root = await tempRoot(t, await fixtureText('config.toml'));
  const { code, out } = await cli({ root, cwd: dir });
  assert.equal(code, 0, out);
  const result = await runRecord(config.output);
  assert.equal(result.status, 'completed');
  assert.equal(result.events.filter(e => e.type === 'stage-start').length, 5 * 7);
  const chapter = await loadChapter(config.output);
  assert.deepEqual(chapter.pages.map(p => p.name), ['1.png', '2.webp', '3.jpeg', '4.jfif', '10.jpg']);
  for (const page of chapter.pages) {
    assert.equal(page.width, 3); assert.equal(page.height, 2);
    assert.deepEqual(await readFile(page.imagePath), await readFile(join(config.input, page.name)));
  }
  assert.ok(out.endsWith('\nResult: PASS\nOutput: output\n'), out);
  assert.ok(!out.includes('{') && !out.includes(result.runId) && !out.includes('Details'), out);
  const events = (await logLines(root, 'log_all.log')).filter(e => e.type === 'stage-end');
  assert.equal(events.length, 5 * 7);
  assert.ok(events.every(e => e.runId === result.runId && e.pageId && e.elapsedMs >= 0));
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
test('CLI --input/--output override config defaults; relative to CWD; absolute paths unchanged', async t => {
  const { dir } = await setup(t);
  for (const name of ['input', 'other']) { await mkdir(join(dir, name)); await writeFile(join(dir, name, '1.png'), fixtures.png); }
  await writeFile(join(dir, 'other', '2.webp'), fixtures.webp);
  const root = await tempRoot(t, await fixtureText('config.toml'));
  const cases = [ // [CLI args, expected input dir, expected output relative to CWD]
    [[], 'input', 'output'],
    [['--input', 'other'], 'other', 'output'],
    [['--output', 'out-only'], 'input', 'out-only'],
    [['--output', join(dir, 'abs-out'), '--input', join(dir, 'other')], 'other', 'abs-out'],
  ];
  for (const [argv, input, output] of cases) {
    // Outputs are never reused; clear the config default output before the next case falls back to it.
    await rm(join(dir, 'output'), { recursive: true, force: true });
    const { code, out } = await cli({ root, cwd: dir, argv });
    assert.equal(code, 0, out);
    const result = await runRecord(join(dir, output));
    assert.equal(result.output, join(dir, output));
    const chapter = await loadChapter(result.output);
    assert.deepEqual(chapter.pages.map(p => p.name), input === 'other' ? ['1.png', '2.webp'] : ['1.png']);
  }
  await assert.rejects(access(join(root, 'output')));
});
test('pre-stage failures: missing paths, bad arguments, TOML/schema errors fail clearly without output', async t => {
  const { dir } = await setup(t);
  await mkdir(join(dir, 'input')); await writeFile(join(dir, 'input', '1.png'), fixtures.png);
  const noPaths = await fixtureText('config-no-paths.toml');
  for (const [config, argv, reason] of [
    [noPaths, [], /input path is required/],
    [noPaths, ['--input', 'input'], /output path is required/],
    [noPaths, ['--output', 'output'], /input path is required/],
    [noPaths, ['--input', 'input', '--output', ''], /non-empty path/],
    [noPaths, ['--config', 'x.toml'], /Invalid arguments/],
    [noPaths, ['--input'], /Invalid arguments/],
    [noPaths, ['--input', '--output', 'output'], /Invalid arguments/],
    [noPaths, ['--input', 'a', '--input', 'b'], /Invalid arguments/],
    ['version = 1\nmode = "smoke"\n[paths\n', [], /Invalid TOML/],
    ['version = 2\nmode = "smoke"\n', [], /version=1/],
    ['version = 1\nmode = "smoke"\nsecret = "x"\n', [], /Unknown key in \[top level\]: secret/],
    ['version = 1\nmode = "smoke"\n[paths]\ninput = "input"\noutput = "output"\nextra = 1\n', [], /Unknown key in \[paths\]/],
    ['version = 1\nmode = "smoke"\n[paths]\ninput = "input"\noutput = "output"\n[pipeline]\nstages = ["bad"]\n', [], /stages/],
    ['version = 1\nmode = "smoke"\n[paths]\ninput = "missing"\noutput = "output"\n', [], /Input not found/],
  ]) {
    const root = await tempRoot(t, config);
    const { code, out } = await cli({ root, cwd: dir, argv });
    assert.equal(code, 1, out);
    const lines = out.trimEnd().split('\n');
    assert.equal(lines[0], 'Result: FAIL', out);
    assert.match(lines[1], /^Reason: /); assert.match(lines[1], reason);
    assert.equal(lines[2], `Details: ${join(root, 'logs', 'critical.log')}`); // CWD is not the project root
    assert.ok(!out.includes('%') && !out.includes('{'), out);
    assert.match(JSON.stringify(await logLines(root, 'critical.log')), reason);
    await assert.rejects(access(join(dir, 'output')));
  }
});
test('entry dist/cli.js: config and logs fixed at project root, first run creates config, failures point to absolute Details', async t => {
  // A disposable copy of the built entry gets its own project root, exactly like a checkout.
  const root = await tempRoot(t);
  await cp(join(realRoot, 'dist'), join(root, 'dist'), { recursive: true });
  await cp(join(realRoot, 'package.json'), join(root, 'package.json'));
  await symlink(join(realRoot, 'node_modules'), join(root, 'node_modules'));
  const { dir } = await setup(t);
  await mkdir(join(dir, 'input')); await writeFile(join(dir, 'input', '1.png'), fixtures.png);
  const node = (cwd, ...args) => spawnSync(process.execPath, [join(root, 'dist', 'cli.js'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8' } });

  const created = node(dir);
  assert.equal(created.status, 2, created.stdout + created.stderr);
  assert.equal(created.stdout, `Config created: ${join(root, 'config', 'config.toml')} — edit it and run again.\n`);
  assert.deepEqual(await readdir(join(root, 'config')), ['config.toml']);
  const template = await readFile(join(root, 'config', 'config.toml'), 'utf8');
  assert.match(template, /^# RoverCMT configuration/); assert.match(template, /Relative paths resolve/);
  assert.deepEqual((await readdir(dir)).sort(), ['input']); // no pipeline, nothing written in CWD

  await writeFile(join(root, 'config', 'config.toml'), template.replace('test-data/input/example', 'input').replace('test-data/output/example-run', 'output'));
  const pass = node(dir);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.equal(pass.stderr, '');
  assert.ok(pass.stdout.endsWith('\nResult: PASS\nOutput: output\n'), pass.stdout);
  assert.match(pass.stdout, /^Detect {12}100% \[█{20}\] PASS$/m);
  assert.equal((await runRecord(join(dir, 'output'))).status, 'completed');
  assert.deepEqual((await readdir(join(root, 'logs'))).sort(), ['log_all.log']);
  assert.deepEqual((await readdir(dir)).sort(), ['input', 'output']); // no config/logs in CWD

  const outside = node(dir);
  assert.equal(outside.status, 1);
  assert.equal(outside.stdout, `Result: FAIL\nReason: Output directory already exists: ${join(dir, 'output')}\nDetails: ${join(root, 'logs', 'critical.log')}\n`);
  const inside = node(root, '--input', join(dir, 'input'), '--output', join(dir, 'output'));
  assert.equal(inside.status, 1);
  assert.match(inside.stdout, /\nDetails: logs\/critical\.log\n$/);
  const critical = await logLines(root, 'critical.log');
  assert.equal(critical.length, 2);
  assert.ok(critical.every(entry => /Output directory already exists/.test(entry.message)));
});
