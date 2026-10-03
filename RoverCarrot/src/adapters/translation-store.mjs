import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, open, realpath, stat } from 'node:fs/promises';
import { basename, join, dirname, resolve } from 'node:path';
import { buildTranslationJson, serializeTranslationCsv } from '../translation/ported/export.mjs';
const json = value => JSON.stringify(value, null, 2) + '\n';
async function durable(path, value) {
  const file = await open(path, 'wx');
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
}
async function syncDir(path) { const dir = await open(path, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
async function atomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await durable(temporary, value); await rename(temporary, path); await syncDir(dirname(path));
}
export function translationStore(log = () => {}) {
  let context, workDir, chapterDir, output, config, exportDir;
  return {
    context() { if (!context) throw new Error('Translation context not initialized'); return structuredClone(context); },
    async initialize(chapter, checked) {
      config = checked.translation; output = checked.output;
      if (!config) return;
      workDir = join(output, 'works', chapter.workId); chapterDir = join(workDir, 'chapters', chapter.id);
      const now = chapter.updatedAt;
      const guide = config.styleGuidePath ? JSON.parse(await readFile(config.styleGuidePath, 'utf8')) : {
        schemaVersion: 1, workId: chapter.workId, glossary: [], characters: [],
        rules: { honorifics: 'adapt', sfxMode: 'translate', defaultTone: 'natural_korean' }, createdAt: now, updatedAt: now };
      if (guide.schemaVersion !== 1 || !Array.isArray(guide.glossary) || !Array.isArray(guide.characters) || !guide.rules) throw new Error('Invalid work style-guide');
      const previous = config.cumulative !== false && config.previousStoryPath ? JSON.parse(await readFile(config.previousStoryPath, 'utf8')) : { pages: [] };
      if (!Array.isArray(previous.pages) || previous.pages.some(p => !Number.isInteger(p.pageIndex))) throw new Error('Invalid previous chapter story-memory');
      let previousPages = previous.pages, previousTitle = '';
      if (config.previousStoryPath && config.cumulative !== false) {
        if (!config.previousChapterPath) throw new Error('previousChapterPath is required to bind previousStoryPath to live pages');
        const live = JSON.parse(await readFile(config.previousChapterPath, 'utf8'));
        if (!Array.isArray(live.pages)) throw new Error('Invalid previous chapter');
        const byId = new Map(live.pages.map((page, pageIndex) => [page.id, { page, pageIndex }]));
        previousPages = previous.pages.flatMap(page => { const entry = byId.get(page.pageId); return entry ? [{ ...page, pageName: entry.page.name, pageIndex: entry.pageIndex }] : []; });
        previousTitle = live.title;
      }
      const recent = [...previousPages].sort((a, b) => a.pageIndex - b.pageIndex);
      context = { styleGuide: { ...guide, workId: chapter.workId }, storyMemory: { schemaVersion: 1, workId: chapter.workId,
        chapterId: chapter.id, pages: [], updatedAt: now }, previousStoryPages: recent.map((p, i) => ({ ...p, pageName: `${previousTitle} · ${p.pageName}`, pageIndex: i - recent.length })), pageIndexById: Object.fromEntries(chapter.pages.map((p,i) => [p.id,i])) };
      await atomic(join(workDir, 'style-guide.json'), json(context.styleGuide));
      await atomic(join(chapterDir, 'story-memory.json'), json(context.storyMemory));
      if (config.export !== false) {
        const root = config.exportRoot ?? join(output, 'exports'); await mkdir(root, { recursive: true });
        const normalized = [...chapter.title.trim()].map(c => c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? '_' : c).join('').replace(/[. ]+$/g, '').slice(0, 80) || '화';
        const base = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized) ? `_${normalized}` : normalized;
        for (let suffix = 1; ; suffix++) {
          const path = join(root, suffix === 1 ? base : `${base} (${suffix})`);
          try { await mkdir(path); exportDir = path; break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
        }
        await atomic(join(output, 'rover-export-folders.json'), json([{ rootPath: root, chapterId: chapter.id, folder: basename(exportDir) }]));
      }
    },
    async commit(chapter, pending) {
      if (!config) return false;
      if (pending) {
        const transaction = join(output, '.transactions', randomUUID()); await mkdir(transaction, { recursive: true });
        const entries = [[join(chapterDir, 'chapter.json'), chapter], [join(workDir, 'style-guide.json'), pending.styleGuide], [join(chapterDir, 'story-memory.json'), pending.storyMemory]];
        for (const [i, [, value]] of entries.entries()) await durable(join(transaction, `${i}.json`), json(value));
        await durable(join(transaction, 'manifest.json'), json(entries.map(([target], i) => ({ target, staged: `${i}.json` }))));
        await syncDir(transaction); await syncDir(dirname(transaction)); await syncDir(output);
        for (const [i, [target]] of entries.entries()) await atomic(target, await readFile(join(transaction, `${i}.json`)));
        context = { ...context, ...structuredClone(pending) };
        await rm(transaction, { recursive: true }); await syncDir(dirname(transaction));
      }
      if (exportDir) {
        try {
          const savedChapter = JSON.parse(await readFile(join(chapterDir, 'chapter.json'), 'utf8'));
          const document = buildTranslationJson({ chapter: savedChapter, readingDirection: config.readingDirection ?? (/^(ja|ar|fa|he|ur)(-|$)/.test(config.sourceLanguage ?? 'ja') ? 'rtl' : 'ltr'), workName: 'RoverCMT smoke' });
          await atomic(join(exportDir, 'translation.json'), json(document));
          await atomic(join(exportDir, 'translation.csv'), serializeTranslationCsv(document));
        } catch (error) { log('translation-export-warning', { message: String(error) }); }
      }
      return Boolean(pending);
    },
  };
}

// Explicit roll-forward for the journal left by an interrupted owned commit.
export async function recoverTranslationTransaction(output, transaction) {
  output = await realpath(output); transaction = await realpath(transaction);
  if (!transaction.startsWith(join(output, '.transactions') + '/')) throw new Error('Transaction outside output');
  const entries = JSON.parse(await readFile(join(transaction, 'manifest.json'), 'utf8'));
  for (const entry of entries) {
    const target = resolve(entry.target);
    if (!target.startsWith(join(output, 'works') + '/') || !['chapter.json', 'style-guide.json', 'story-memory.json'].includes(basename(target)) ||
      !/^[0-2]\.json$/.test(entry.staged) || await realpath(dirname(target)) !== dirname(target) || !(await stat(target)).isFile())
      throw new Error('Invalid transaction destination');
    await atomic(target, await readFile(join(transaction, entry.staged)));
  }
  await rm(transaction, { recursive: true }); await syncDir(dirname(transaction));
}
