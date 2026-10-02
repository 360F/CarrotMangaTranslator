import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseConfigToml, loadOrCreateConfig, CONFIG_TEMPLATE } from '../dist/cli/config-file.js';
import { projectRootFrom } from '../dist/cli/app.js';
import { LOG_LIMITS, trimLogFile } from '../dist/cli/log.js';
import { StageProgress } from '../dist/cli/progress.js';
import { smokeStages } from '../dist/adapters/smoke.js';
import { cli, fixtureText, logLines, realRoot, realState, runRecord, tempRoot } from './cli-helpers.mjs';

const before = await realState();
after(async () => assert.equal(await realState(), before, 'tests must not touch the real config/config.toml or logs/'));
const png = await readFile(new URL('./fixtures/page.png', import.meta.url));
async function pages(t, count = 4) {
  const root = await tempRoot(t, await fixtureText('config.toml'));
  const cwd = join(root, 'work');
  await mkdir(join(cwd, 'input'), { recursive: true });
  for (let i = 1; i <= count; i += 1) await writeFile(join(cwd, 'input', `${i}.png`), png);
  return { root, cwd };
}

test('TOML: tables map to the existing config meaning; template parses; errors are rejected', async () => {
  const config = parseConfigToml(await fixtureText('config.toml'), '/work');
  assert.deepEqual(config, { version: 1, mode: 'smoke', input: '/work/input', output: '/work/output',
    stages: ['detect', 'ocr', 'translate', 'typography', 'erase', 'layout', 'render'] });
  const unordered = parseConfigToml('version = 1\nmode = "smoke"\n[paths]\ninput = "/a"\noutput = "b"\n[pipeline]\nstages = ["render", "detect"]\n', '/w');
  assert.deepEqual([unordered.input, unordered.output, unordered.stages], ['/a', '/w/b', ['detect', 'render']]);
  assert.equal(parseConfigToml('version = 1\nmode = "smoke"\n[paths]\ninput = "a"\noutput = "b"\n', '/w').stages.length, 11);
  const template = parseConfigToml(CONFIG_TEMPLATE, '/w');
  assert.deepEqual([template.input, template.output], ['/w/test-data/input/example', '/w/test-data/output/example-run']);
  assert.ok(CONFIG_TEMPLATE.split('\n').filter(line => line.startsWith('#')).length >= 8);
  for (const [text, message] of [
    ['version = ', /Invalid TOML/], ['version = 1\nmode = "smoke"\npaths = 3\n', /\[paths\] must be a table/],
    ['version = 1\nmode = "smoke"\n[pipeline]\nstages = "detect"\n', /stages/], ['mode = "smoke"\n', /version=1/],
  ]) assert.throws(() => parseConfigToml(text, '/w', { input: 'a', output: 'b' }), message);
});

test('first run creates the single config file from the internal template and does not run', async t => {
  const root = await tempRoot(t);
  const path = join(root, 'config', 'config.toml');
  assert.equal(await loadOrCreateConfig(path, root, {}), null);
  assert.equal(await readFile(path, 'utf8'), CONFIG_TEMPLATE);
  assert.equal((await loadOrCreateConfig(path, root, {})).models, undefined);
  const fresh = await tempRoot(t);
  const { code, out } = await cli({ root: fresh });
  assert.equal(code, 2);
  assert.equal(out, 'Config created: config/config.toml — edit it and run again.\n');
  assert.deepEqual(await readdir(join(fresh, 'config')), ['config.toml']);
  assert.ok(!out.includes('PASS'));
  assert.deepEqual(await readdir(fresh), ['config', 'logs']); // no output, no pipeline
  assert.deepEqual(await logLines(fresh, 'critical.log'), []);
});

test('project root is derived from the entry module, not the CWD', () => {
  assert.equal(projectRootFrom(new URL('../dist/cli.js', import.meta.url)), realRoot);
  assert.equal(projectRootFrom('file:///opt/x/RoverCarrot/dist/cli.js'), '/opt/x/RoverCarrot');
});

test('PASS screen (non-TTY): ordered stage lines with 100%, Result and Output only; details go to log_all.log', async t => {
  const { root, cwd } = await pages(t);
  const { code, out } = await cli({ root, cwd });
  assert.equal(code, 0);
  const bar = '█'.repeat(20);
  assert.equal(out, ['Detect', 'OCR', 'Translate', 'Typography', 'Erase', 'Layout', 'Render']
    .map(name => `${name.padEnd(18)}100% [${bar}] PASS\n`).join('') + '\nResult: PASS\nOutput: output\n');
  const log = await logLines(root, 'log_all.log');
  const types = log.map(entry => entry.type);
  for (const type of ['cli-start', 'run-start', 'input-materialized', 'stage-start', 'stage-end', 'run-end', 'run-result'])
    assert.ok(types.includes(type), type);
  const runStart = log.find(entry => entry.type === 'run-start');
  assert.deepEqual([runStart.input, runStart.output], [join(cwd, 'input'), join(cwd, 'output')]);
  assert.equal(log.find(entry => entry.type === 'run-result').runId, (await runRecord(join(cwd, 'output'))).runId);
  assert.deepEqual(await logLines(root, 'critical.log'), []);
});

test('TTY progress redraws in place with page-count percentages; ASCII fallback without UTF-8 locale', async t => {
  const { root, cwd } = await pages(t);
  const { code, out } = await cli({ root, cwd, tty: true, env: { LANG: 'C' } });
  assert.equal(code, 0);
  assert.ok(out.includes('\x1b[7A')); // cursor-up redraw of the 7 stage rows, no cursor hiding
  assert.ok(!out.includes('\x1b[?25l'));
  for (const pct of ['  0%', ' 25%', ' 50%', ' 75%', '100%']) assert.ok(out.includes(`OCR               ${pct}`), pct);
  assert.match(out, /OCR {15} 50% \[##########----------\] Processing/);
  assert.ok(!out.includes('█'));
  // Observed order equals the pipeline's stage-major order: Detect completes before OCR starts.
  const firstOcr = out.indexOf('OCR                25%');
  assert.ok(out.lastIndexOf('Detect             75%') < out.indexOf('Detect            100%'));
  assert.ok(out.indexOf('Detect            100%') < firstOcr);
});

test('stage FAIL screen: failing stage marked, later stages skipped, Details only on failure, critical.log records it', async t => {
  const { root, cwd } = await pages(t);
  const stages = smokeStages();
  const ocr = stages.find(stage => stage.id === 'ocr');
  let seen = 0;
  ocr.execute = async page => (++seen === 4 ? { status: 'failed', page, message: 'fixture OCR failure', retryable: false }
    : { status: 'completed', page });
  const { code, out } = await cli({ root, cwd: root, stages, argv: ['--input', join(cwd, 'input'), '--output', join(cwd, 'out')] });
  assert.equal(code, 1);
  assert.match(out, /^Detect {12}100% \[█{20}\] PASS$/m);
  assert.match(out, /^OCR {15}100% \[█{20}\] FAIL$/m);
  assert.match(out, /^Translate {9} 75% \[█{15}░{5}\] Skipped$/m);
  assert.ok(out.endsWith('\nResult: FAIL\nFailed: OCR\nDetails: logs/critical.log\n'), out); // CWD == project root
  const critical = await logLines(root, 'critical.log');
  assert.equal(critical.length, 1);
  assert.equal(critical[0].stage, 'ocr'); assert.equal(critical[0].message, 'fixture OCR failure');
  assert.ok(!critical.some(entry => /stage-(start|end)/.test(entry.type)));
  assert.equal((await runRecord(join(cwd, 'out'))).status, 'partial');
});

test('infrastructure failure mid-stage marks the running stage FAIL', () => {
  let out = '';
  const progress = new StageProgress(['detect', 'ocr'], text => { out += text; }, false, true);
  progress.start(2);
  for (const pageId of ['a', 'b']) progress.event({ type: 'stage-end', runId: 'r', pageId, stage: 'detect', status: 'completed' });
  progress.event({ type: 'stage-start', runId: 'r', pageId: 'a', stage: 'ocr' });
  assert.equal(progress.inFlight(), 'ocr');
  assert.deepEqual(progress.finish(progress.inFlight()), ['ocr']);
  assert.match(out, /^OCR {15} {2}0% \[░{20}\] FAIL$/m);
});

test('logs stay under their size caps, trimmed by whole lines, without backup files', async t => {
  const { root, cwd } = await pages(t, 1);
  await mkdir(join(root, 'logs'));
  const filler = name => {
    const line = JSON.stringify({ old: name, pad: 'x'.repeat(200) }) + '\n';
    return line.repeat(Math.ceil((LOG_LIMITS[name] + 1024 * 1024) / line.length));
  };
  for (const name of ['log_all.log', 'critical.log']) await writeFile(join(root, 'logs', name), filler(name));
  const { code } = await cli({ root, cwd, argv: ['--output', 'missing-parent/x'] }); // fails: critical gets an entry
  assert.equal(code, 1);
  assert.deepEqual((await readdir(join(root, 'logs'))).sort(), ['critical.log', 'log_all.log']);
  for (const name of ['log_all.log', 'critical.log']) {
    assert.ok((await stat(join(root, 'logs', name))).size <= LOG_LIMITS[name], name);
    const lines = await logLines(root, name); // every remaining line is complete JSON
    assert.equal(lines.at(-1).type === 'pre-stage-failure' || lines.at(-1).type === 'run-result', true, lines.at(-1).type);
  }
  const file = join(root, 'small.log');
  await writeFile(file, 'aaaa\nbbbb\ncccc\n');
  trimLogFile(file, 11); // 15 bytes -> drop the partial first line, keep 10 bytes of whole lines
  assert.equal(await readFile(file, 'utf8'), 'bbbb\ncccc\n');
  trimLogFile(file, 9);
  assert.equal(await readFile(file, 'utf8'), 'cccc\n');
  trimLogFile(file, 100);
  assert.equal(await readFile(file, 'utf8'), 'cccc\n');
});
