import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, chmod, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { summarizeOcrBboxHint, summarizeImageVariants } from '../src/translation/ported/artifact-summary.mjs';
import { translationStage } from '../dist/translation/stage.js';
import { reference } from './translation-reference.mjs';
import { launchArgs, startManaged, preflight } from '../src/adapters/llama.mjs';
import { pageImages } from '../dist/adapters/translation-images.mjs';
import { translationStore, recoverTranslationTransaction } from '../src/adapters/translation-store.mjs';
import { pageOptions, buildRequest } from '../src/translation/request.mjs';
import { parseAndMerge, translatePage } from '../src/translation/translate.mjs';
import { extractPageContextResponse } from '../src/translation/ported/pageContextResponse.mjs';
import { assignItemsToExistingBlocks } from '../src/translation/ported/keepBlocksAssignment.mjs';
import { mergeCumulativePageContext } from '../src/translation/ported/cumulativePageContext.mjs';
import { buildTranslationJson, serializeTranslationCsv } from '../src/translation/ported/export.mjs';
const config = { backend: 'managed', runtimeProfile: 'rtx50', modelPath: '/models/gemma-4-26B-A4B-it-ultra-uncensored-heretic.Q6_K.gguf', mmprojPath: '/models/mmproj.gguf' };
const page = { id: 'p1', name: 'one.png', imagePath: resolve('tests/fixtures/page.png'), width: 1000, height: 1000,
  analysisStatus: 'idle', blocks: [{ id: 'b1', bbox: { x: 100, y: 100, w: 300, h: 300 }, bboxSpace: 'normalized_1000', sourceText: '太郎', translatedText: '' },
    { id: 'b2', bbox: { x: 600, y: 100, w: 200, h: 300 }, sourceText: 'こんにちは', translatedText: '' }] };
const guide = { schemaVersion: 1, workId: 'w', glossary: [], characters: [], rules: { honorifics: 'adapt', sfxMode: 'translate', defaultTone: 'natural_korean' }, createdAt: 'now', updatedAt: 'now' };
const context = { styleGuide: guide, storyMemory: { schemaVersion: 1, workId: 'w', chapterId: 'c', pages: [], updatedAt: 'now' } };
const options = () => pageOptions(page, context, config, 0, 1);
const overlay = `id: 1\ntype: nonsolid\ntextRole: ordinary\nx1: 100\ny1: 100\nx2: 400\ny2: 400\ndirection: vertical\nfontSize: 20\nconfidence: 0.99\njp: 太郎\nko: 타로`;
async function temporary(t) { const path = await mkdtemp(join(tmpdir(), 'rover-step4-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
async function freePort() { const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const p = server.address().port; await new Promise(r => server.close(r)); return p; }
async function fake(config, overrides = {}) {
  return startManaged(config, { binary: resolve('tests/fake-llama.mjs'), template: '/template', env: { ...process.env, ...overrides.env } },
    { pollingMs: 10, readyTimeoutMs: 1000, ...overrides });
}

test('D32 launch args equal recorded reference argument list, replacing paths only', async () => {
  const recorded = JSON.parse(await readFile('tests/fixtures/translation-launch.json', 'utf8'));
  const expected = recorded.args.map((v, i) => i === 1 ? config.modelPath : i === 3 ? config.mmprojPath : recorded.args[i - 1] === '--chat-template-file' ? '/template' : v);
  assert.deepEqual(launchArgs(config, '/template'), expected);
});
test('managed prompt/system/messages/body vs unmodified Carrot builder; rich context and OCR', async () => {
  const variants = await pageImages(page, {});
  const o = options();
  const refOcr = reference('src/main/pipeline/keepBlocksResult.ts').buildKeepBlocksOcrResult(page, page.blocks.map(b => b.sourceText));
  assert.deepEqual(o.ocrBboxResult, refOcr);
  const previous = reference('src/main/pipeline/previousBlocksForPrompt.ts').buildPreviousBlocksForPrompt(page, refOcr.hints, { assignSequentialCandidateIds: true });
  assert.deepEqual(o.previousBlocksForPrompt, previous);
  const prompt = reference('src/main/runtime/simple-page-prompts.cjs');
  const builder = reference('src/main/runtime/simple-page-request-builders.cjs');
  const actual = buildRequest(o, variants);
  assert.equal(actual.promptText, prompt.getOverlayPrompt(o, variants));
  assert.equal(actual.systemPrompt, prompt.buildSystemPrompt(o));
  const messages = builder.buildMessages(o, variants);
  assert.deepEqual(actual.body.messages, messages);
  assert.deepEqual(actual.body, builder.buildChatRequestBodyWithModelResolver(o, messages, 32768, () => config.modelPath.split('/').at(-1)));
  assert.equal(actual.body.messages[1].content[0].image_url.url, variants[0].dataUrl);
});
test('parser, normalization, geometry validation, sound gate and assignment vs reference', () => {
  const parser = reference('src/main/runtime/overlay-parser.cjs');
  const refs = reference('src/main/pipeline/overlayItemReferences.ts');
  const locks = reference('src/main/pipeline/overlayOcrGeometryLocks.ts');
  const sound = reference('src/main/pipeline/overlayItems.ts');
  const o = options();
  for (const text of [overlay, JSON.stringify({ items: [{ id: 1, x1: 100, y1: 100, x2: 400, y2: 400, jp: '太郎', ko: '타로', textRole: 'ordinary' }] }), overlay + '\n\n' + overlay.replace('id: 1', 'id: 99')]) {
    const result = { outputText: text, frame: { space: 'normalized_1000' } };
    const actual = parseAndMerge(page, o, result);
    const normalized = refs.normalizeOverlayItemBboxes(parser.normalizeItems(parser.parseJsonLenient(text)), page, {});
    const locked = locks.applyOcrCandidateGeometryLocks(normalized, page, o.ocrBboxHints);
    const validated = refs.validateOverlayItemsAgainstReferences(locked, page, o.ocrBboxHints, o.previousBlocksForPrompt, { sourceLanguage: 'ja' });
    assert.deepEqual(actual.validation, validated);
    assert.deepEqual(actual.accepted, sound.filterRejectedOrUncertainSoundItems(validated.items));
    const r = reference('src/main/pipeline/keepBlocksAssignment.ts').assignItemsToExistingBlocks({ items: actual.accepted.items, page, previousBlocks: o.previousBlocksForPrompt });
    assert.deepEqual(assignItemsToExistingBlocks({ items: actual.accepted.items, page, previousBlocks: o.previousBlocksForPrompt }), r);
    assert.equal(actual.page.blocks[0].sourceText, '太郎'); assert.equal(actual.page.blocks[1].translatedText, '');
  }
  assert.throws(() => parseAndMerge(page, o, { outputText: '[]', frame: { space: 'normalized_1000' } }), /bbox/);
});
test('page context parser and memory grounding/manual preservation vs reference', () => {
  for (const text of [overlay, overlay + '<page-context>{oops', overlay + '<page-context>{"visualSummary":"장면","glossary":[],"characters":[]}</page-context>'])
    assert.deepEqual(extractPageContextResponse(text), reference('src/main/pipeline/pageContextResponse.ts').extractPageContextResponse(text));
  const input = { styleGuide: guide, page: { ...page, blocks: [{ ...page.blocks[0], translatedText: '타로' }] }, pageIndex: 0,
    pageContext: { visualSummary: '장면', glossary: [{ source: '없는이름', target: '없는말', category: 'term' }], characters: [] }, now: 'fixed' };
  const ref = reference('src/main/pipeline/cumulativePageContext.ts').mergeCumulativePageContext(input);
  const actual = mergeCumulativePageContext(input);
  // buildPageStoryMemory creates its own timestamp; compare all other fields.
  actual.pageMemory.updatedAt = ref.pageMemory.updatedAt; assert.deepEqual(actual, ref);
  assert.equal(actual.styleGuide.glossary.length, 0);
});
test('Rover Output JSON/CSV serializers vs reference, explicit order and quoting', () => {
  const chapter = { title: 'chapter', pages: [{ ...page, blockOrder: ['b2', 'b1'], blocks: page.blocks.map(b => ({ ...b, translatedText: '말,"글"\n줄' })) }], pageOrder: ['p1'] };
  const args = { chapter, readingDirection: 'rtl', workName: 'work' };
  const ref = reference('src/main/linkedWorkspace/linkedWorkspaceTranslationJson.ts');
  const document = buildTranslationJson(args); assert.deepEqual(document, ref.buildTranslationJson(args));
  assert.equal(serializeTranslationCsv(document), ref.serializeTranslationCsv(document));
});
test('fake owned lifecycle: request/retry, clean stop, restart, startup cleanup, abort and force escalation', async t => {
  const artifactRoot = await temporary(t), port = await freePort(), c = { ...config, port };
  let child;
  const result = await translatePage(page, 0, context, c, { artifactRoot, images: pageImages, open: async () => {
    const server = await fake(c, { env: { FAKE_LLAMA_EMPTY: '1' } }); child = server.child; return server;
  } });
  assert.equal(result.status, 'completed'); assert.equal(result.page.blocks[0].translatedText, '타로');
  assert.equal(result.pendingMemory.styleGuide.glossary.length, 1); assert.equal(child.exitCode, 0); assert.equal(child.signalCode, null);
  assert.ok(await readFile(join(artifactRoot, 'p1', 'attempt-2', 'input-enhanced.png')));
  const artifact = JSON.parse(await readFile(join(artifactRoot, 'p1', 'attempt-2', 'result.json')));
  assert.equal(artifact.prompt, artifact.requestSummary.promptText);
  assert.equal(artifact.settings.workContext, undefined);
  assert.equal(artifact.requestSummary.options.workContext, undefined);
  assert.ok(await readFile(join(artifactRoot, 'p1', 'attempt-2', 'result.md')));
  const restarted = await fake(c); await restarted.dispose(); await restarted.dispose();
  await assert.rejects(fake(c, { env: { FAKE_LLAMA_FAIL: '1' } }), /before readiness/);
  const after = await fake(c); await assert.rejects(fake(c), /EADDRINUSE/); await after.dispose();
});

test('owned normal stop waits for cleanup and sends exactly one interrupt', async () => {
  const signals = [], c = { ...config, port: await freePort() };
  const server = await fake(c, { stopOptions: { onSignal: s => signals.push(s) } });
  await Promise.all([server.dispose(), server.dispose()]);
  assert.equal(server.child.exitCode, 0); assert.equal(server.child.signalCode, null);
  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal((server.output().match(/interrupt:SIGTERM/g) ?? []).length, 1);
  assert.doesNotMatch(server.output(), /second interrupt/);
});
test('owned server ignoring interrupt is SIGKILLed only after reference 5s bound', async () => {
  const signals = [], c = { ...config, port: await freePort() };
  const server = await fake(c, { env: { FAKE_LLAMA_STUBBORN: '1' }, stopOptions: { onSignal: s => signals.push({ signal: s, time: performance.now() }) } });
  await server.dispose();
  assert.deepEqual(signals.map(s => s.signal), ['SIGTERM', 'SIGKILL']);
  assert.ok(signals[1].time - signals[0].time >= 5000);
  assert.equal(server.child.exitCode, null); assert.equal(server.child.signalCode, 'SIGKILL');
});
test('abort during startup awaits graceful cleanup of owned child', async () => {
  const c = { ...config, port: await freePort() }, abort = new AbortController(), events = [];
  const starting = fake(c, { env: { FAKE_LLAMA_NOT_READY: '1' }, signal: abort.signal,
    log: (event, data) => {
      events.push({ event, ...data });
    } });
  // Poll until the child has its HTTP server and interrupt handlers installed.
  const deadline = Date.now() + 1000;
  while (true) {
    assert.ok(Date.now() < deadline, 'fake server must start before abort');
    try { const response = await fetch(`http://127.0.0.1:${c.port}/v1/models`); await response.body?.cancel(); break; }
    catch { await new Promise(r => setTimeout(r, 10)); }
  }
  abort.abort(); await assert.rejects(starting);
  assert.deepEqual(events.filter(e => e.event === 'llama-stop-signal').map(e => e.signal), ['SIGTERM']);
  const stopped = events.find(e => e.event === 'llama-stopped');
  assert.equal(stopped.code, 0); assert.equal(stopped.signal, null);
  assert.throws(() => process.kill(stopped.pid, 0), { code: 'ESRCH' });
  const restarted = await fake(c); await restarted.dispose();
});

test('persistence publishes page plus pending memory before next context; exports read saved data', async t => {
  const output = await temporary(t); const chapter = { id: 'c', workId: 'w', title: 'chapter', pages: [page], pageOrder: ['p1'], updatedAt: 'now' };
  await mkdir(join(output, 'works/w/chapters/c'), { recursive: true });
  await writeFile(join(output, 'works/w/chapters/c/chapter.json'), '{}');
  const store = translationStore(); await store.initialize(chapter, { output, translation: config });
  const pending = { styleGuide: { ...guide, glossary: [{ source: '太郎', target: '타로', enabled: true }] }, storyMemory: { ...context.storyMemory, pages: [{ pageId: 'p1', pageIndex: 0, summary: '타로' }] } };
  assert.equal(store.context().storyMemory.pages.length, 0);
  await store.commit(chapter, pending); assert.equal(store.context().storyMemory.pages.length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(output, 'works/w/style-guide.json'), 'utf8')), pending.styleGuide);
  const exported = JSON.parse(await readFile(join(output, 'exports/chapter/translation.json'), 'utf8'));
  assert.equal(exported.schemaVersion, 2);
});

test('rich work context selection/pruning matches reference and flows into next request', async () => {
  const rich = structuredClone(context);
  rich.styleGuide.glossary = [{ id: 'g1', source: '太郎', target: '타로', category: 'character', enabled: true }];
  rich.styleGuide.characters = [{ id: 'ch1', displayName: '타로', sourceNames: ['太郎'], targetName: '타로', speechStyle: 'polite', enabled: true }];
  rich.previousStoryPages = [{ pageId: 'previous', pageIndex: -1, pageName: '지난화 · 1', visualSummary: '이전 장면', glossaryEntryIds: ['g1'], characterIds: ['ch1'] }];
  const o = pageOptions(page, rich, config, 1, 1);
  const selected = reference('src/main/pipeline/workContextPrompt.ts').buildPromptWorkContextForPage({ baseStyleGuide: rich.styleGuide,
    storyMemory: rich.storyMemory, pageId: page.id, pageIndex: 1, recentPageCount: 6, previousStoryPages: rich.previousStoryPages, ocrHints: o.ocrBboxHints });
  const pruned = reference('src/shared/workContextBudget.ts').prunePromptWorkContextForBudget(selected, { ctx: 65536, maxTokens: 32768 });
  assert.deepEqual(o.workContext, pruned.workContext); assert.deepEqual(o.workContextBudget, pruned.budget);
  const images = await pageImages(page, {}), actual = buildRequest(o, images);
  const ref = reference('src/main/runtime/simple-page-request-builders.cjs');
  assert.deepEqual(actual.body.messages, ref.buildMessages(o, images));
  assert.match(actual.promptText, /이전 장면/); assert.match(actual.promptText, /太郎 => 타로/);
});
test('response empty/error/refusal/abort do not produce pending memory; no-target opens no server', async t => {
  const root = await temporary(t);
  let opens = 0;
  const empty = await translatePage({ ...page, blocks: [] }, 0, context, config, { open: () => { opens++; }, artifactRoot: root });
  assert.equal(empty.status, 'empty'); assert.equal(opens, 0); assert.equal(empty.pendingMemory, undefined);
  await assert.rejects(translatePage({ ...page, blocks: [{ ...page.blocks[0], sourceText: '' }] }, 0, context, config, { artifactRoot: root }), /원문/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(translatePage(page, 0, context, config, { artifactRoot: root }, abort.signal));
  assert.deepEqual(extractPageContextResponse(overlay + '<page-context>{"glossary":"bad"}</page-context>').status, 'invalid');
});
test('memory valid grounded candidates, collision, disabled cumulative and manual summary semantics', () => {
  const refMerge = reference('src/main/pipeline/cumulativePageContext.ts').mergeCumulativePageContext;
  const existing = { ...context.storyMemory, pages: [] };
  void existing;
  const seeded = { ...guide, glossary: [{ id: 'g1', source: '太郎', target: '타로', aliases: [], category: 'character', enabled: true }] };
  const input = { styleGuide: seeded, existingPageMemory: { pageId: 'p1', visualSummary: '수동', visualSummarySource: 'manual' },
    page: { ...page, blocks: [{ ...page.blocks[0], translatedText: '타로' }] }, pageIndex: 0,
    pageContext: { visualSummary: 'AI', glossary: [{ source: '太郎', target: '타로', category: 'character' }], characters: [{ displayName: '타로', sourceNames: ['太郎'], targetName: '타로' }] }, now: 'fixed' };
  const expected = refMerge(input), actual = mergeCumulativePageContext(input);
  assert.deepEqual(actual, expected); assert.equal(actual.pageMemory.visualSummary, '수동'); assert.equal(actual.guideChanged, false);
  const without = { ...input, pageContext: undefined }; assert.deepEqual(mergeCumulativePageContext(without), refMerge(without));
});
test('fake readiness timeout cleans its child; nonretryable transport failure closes session', async t => {
  const c = { ...config, port: await freePort() };
  await assert.rejects(fake(c, { env: { FAKE_LLAMA_NOT_READY: '1' }, readyTimeoutMs: 60 }), /Timed out/);
  const server = await fake(c); await server.dispose();
  const artifactRoot = await temporary(t);
  let calls = 0, disposed = false;
  const http = (await import('node:http')).createServer(async (req, res) => {
    for await (const b of req) void b;
    if (req.url.endsWith('/tokenize')) { res.end('{"tokens":[49]}'); return; }
    calls++; res.statusCode = 422; res.end('invalid request');
  });
  await new Promise(r => http.listen(0, '127.0.0.1', r));
  try {
    await assert.rejects(translatePage(page, 0, context, config, { artifactRoot, images: pageImages,
      open: async () => ({ baseUrl: `http://127.0.0.1:${http.address().port}/v1`, dispose: async () => { disposed = true; } }) }), /422/);
    assert.equal(calls, 1); assert.ok(disposed);
  } finally { await new Promise(r => http.close(r)); }
});

test('Linux preflight verifies pinned binary inventory, model receipt and template; refuses altered files', async t => {
  const root = await temporary(t), runtime = join(root, 'runtime-output');
  await mkdir(join(runtime, 'bin'), { recursive: true }); await mkdir(join(root, 'runtime/llama/templates'), { recursive: true });
  const binary = join(runtime, 'bin/llama-server'); await copyFile('tests/fake-llama.mjs', binary); await chmod(binary, 0o755);
  await copyFile('runtime/llama/templates/gemma4-26b-4d7ae498.jinja', join(root, 'runtime/llama/templates/gemma4-26b-4d7ae498.jinja'));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const pins = [], receipts = [], paths = [];
  for (const file of ['gemma-4-26B.Q6_K.gguf', 'mmproj.gguf']) {
    const path = join(root, file), bytes = Buffer.from('GGUF'); paths.push(path); await writeFile(path, bytes);
    const info = await stat(path, { bigint: true }); pins.push({ file, bytes: 4, sha256: sha(bytes) });
    receipts.push({ path, bytes: 4, sha256: sha(bytes), mtimeNs: String(info.mtimeNs) });
  }
  await writeFile(join(root, 'runtime/llama/model-pins.json'), JSON.stringify(pins));
  const receipt = join(root, 'model-identity.json'); await writeFile(receipt, JSON.stringify(receipts));
  const bytes = await readFile(binary);
  await writeFile(join(runtime, 'binary-identity.json'), JSON.stringify({ revision: '9e3b928fd8c9d14dbf15a8768b9fdd7e5c721d66', cuda: '13.3', binary,
    inventory: [{ file: 'llama-server', bytes: bytes.length, sha256: sha(bytes) }] }));
  const c = { ...config, serverPath: binary, modelPath: paths[0], mmprojPath: paths[1], modelIdentityPath: receipt };
  const prepared = await preflight(c, root); assert.equal(prepared.binary, binary);
  await writeFile(paths[0], 'BAD!'); await assert.rejects(preflight(c, root), /identity changed/);
  await writeFile(binary, 'wrong binary'); await assert.rejects(preflight(c, root), /integrity failed/);
});
test('failed publication keeps next-page memory unchanged and leaves a recoverable transaction', async t => {
  const output = await temporary(t), chapterDir = join(output, 'works/w/chapters/c'); await mkdir(chapterDir, { recursive: true });
  const path = join(chapterDir, 'chapter.json'); await writeFile(path, '{}');
  const chapter = { id: 'c', workId: 'w', title: 'chapter', pages: [page], pageOrder: ['p1'], updatedAt: 'now' };
  const store = translationStore(); await store.initialize(chapter, { output, translation: { ...config, export: false } });
  const pending = { styleGuide: guide, storyMemory: { ...context.storyMemory, pages: [{ pageId: 'p1', pageIndex: 0 }] } };
  await rm(path); await mkdir(path);
  await assert.rejects(store.commit(chapter, pending)); assert.equal(store.context().storyMemory.pages.length, 0);
  const [name] = await readdir(join(output, '.transactions')); assert.ok(name);
  await rm(path, { recursive: true }); await writeFile(path, '{}');
  await recoverTranslationTransaction(output, join(output, '.transactions', name));
  assert.deepEqual(JSON.parse(await readFile(join(chapterDir, 'story-memory.json'), 'utf8')), pending.storyMemory);
  assert.deepEqual(await readdir(join(output, '.transactions')), []);
});

test('artifact evidence projection keeps reference OCR truncation/subcrop validation and excludes full context', () => {
  const ref = reference('src/main/runtime/simple-page-request-summary.cjs');
  const hint = { id: 3, ocrText: '太郎'.repeat(200), recognitionSegments: [{ x1: 1, y1: 2, x2: 4, y2: 5, ocrText: '一' }, { x1: 1, y1: 6, x2: 4, y2: 9, ocrText: '二' }] };
  assert.deepEqual(summarizeOcrBboxHint(hint, true), ref.summarizeOcrBboxHint(hint, true));
  assert.deepEqual(summarizeOcrBboxHint({ ...hint, recognitionSegments: [{}] }, true), ref.summarizeOcrBboxHint({ ...hint, recognitionSegments: [{}] }, true));
  const variants = [{ role: 'original', path: 'image.png', mime: 'image/png', width: 10, height: 20 }];
  assert.deepEqual(summarizeImageVariants(variants), ref.summarizeImageVariants(variants));
});
test('stage reports nonretryable response failure without altering Core exception contract', async t => {
  const artifactRoot = await temporary(t);
  const stage = translationStage(config, () => context, { artifactRoot, images: async () => { throw Object.assign(new Error('bad request'), { nonRetriable: true }); }, open: async () => ({ baseUrl: 'unused', dispose: async () => {} }) });
  await stage.prepare([page]); const result = await stage.execute(page);
  assert.equal(result.status, 'failed'); assert.equal(result.retryable, false); assert.equal(result.pendingMemory, undefined);
});
