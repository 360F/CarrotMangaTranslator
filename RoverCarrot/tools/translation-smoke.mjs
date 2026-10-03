// Orchestrator GPU validation. Reads an explicit TOML; does not rewrite user config.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseConfigToml } from '../dist/cli/config-file.js';
import { runCli } from '../dist/cli/app.js';
import { preflight, startManaged } from '../dist/adapters/llama.mjs';
import { pageImages } from '../dist/adapters/translation-images.mjs';
import { translatePage } from '../dist/translation/translate.mjs';

const [mode, file, pageFile] = process.argv.slice(2);
if (!['lifecycle', 'e2e'].includes(mode) || !file) throw new Error('Usage: node tools/translation-smoke.mjs lifecycle|e2e <config.toml>');
const projectRoot = resolve('.');
const config = parseConfigToml(await readFile(file, 'utf8'), projectRoot);
if (!config.translation) throw new Error('Managed translation config required');
const evidence = config.output;
const log = (type, fields) => console.log(JSON.stringify({ type, ...fields }));

if (mode === 'lifecycle') {
  const prepared = await preflight(config.translation, projectRoot);
  await mkdir(evidence); // Refuse overwriting existing evidence.
  if (!pageFile) throw new Error('Lifecycle requires a bound page JSON as third argument');
  const page = JSON.parse(await readFile(pageFile, 'utf8'));
  assert.equal(page.imagePath, config.input);
  page.blocks = page.blocks.filter(b => b.sourceText.trim()).map(b => ({ ...b, translatedText: '' }));
  const context = { styleGuide: { schemaVersion: 1, workId: 'w', glossary: [], characters: [], rules: { honorifics: 'adapt', sfxMode: 'translate', defaultTone: 'natural_korean' } },
    storyMemory: { schemaVersion: 1, workId: 'w', chapterId: 'c', pages: [] } };
  const children = [];
  const open = async signal => { const server = await startManaged(config.translation, prepared, { signal, log }); children.push(server.child); return server; };
  const result = await translatePage(page, 0, context, config.translation, { open, images: pageImages, artifactRoot: evidence, log });
  assert.equal(result.status, 'completed'); assert.ok(result.page.blocks.some(b => b.translatedText.trim())); assert.ok(children[0].exitCode !== null || children[0].signalCode !== null);
  const restart = await open(); await restart.dispose();
  const abort = new AbortController();
  const starting = open(abort.signal); setTimeout(() => abort.abort(), 100); await assert.rejects(starting);
  // Invalid launch input after successful preflight: owned child must fail/clean.
  await assert.rejects(startManaged({ ...config.translation, modelPath: join(evidence, 'missing.gguf') }, prepared, { log, readyTimeoutMs: 10000 }));
  const final = await open(); await final.dispose();
  assert.ok(children.every(c => c.exitCode !== null || c.signalCode !== null));
  await writeFile(join(evidence, 'lifecycle-summary.json'), JSON.stringify({ status: 'PASS', result, identity: prepared.identity, children: children.map(c => ({ pid: c.pid, code: c.exitCode, signal: c.signalCode })) }, null, 2));
} else {
  if (!config.models?.koharu || !config.ocr || config.ocr.device !== 'gpu') throw new Error('E2E requires Koharu and OCR gpu');
  assert.deepEqual(config.stages, ['detect', 'ocr', 'translate']);
  const code = await runCli({ argv: [], projectRoot, cwd: projectRoot, configPath: resolve(file),
    isTTY: false, write: text => process.stdout.write(text) });
  assert.equal(code, 0);
  const index = JSON.parse(await readFile(join(config.output, 'index.json'), 'utf8'));
  const workDir = join(config.output, 'works', index.workOrder[0]);
  const work = JSON.parse(await readFile(join(workDir, 'work.json'), 'utf8'));
  const chapter = JSON.parse(await readFile(join(workDir, 'chapters', work.chapterOrder[0], 'chapter.json'), 'utf8'));
  assert.equal(chapter.pages.length, 4);
  assert.ok(chapter.pages.some(p => p.blocks.some(b => b.translatedText.trim())));
}
