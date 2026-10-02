import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { materializeImages, supportsImage } from './input.js';
import type { Chapter, Persistence } from '../core/contracts.js';

async function writeJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temp, path);
}

export function libraryPersistence(): Persistence {
  let output: string;
  let chapterPath: string;
  return {
    async initialize(config) {
      const inputStat = await stat(config.input).catch((error: NodeJS.ErrnoException) => {
        throw error.code === 'ENOENT' ? new Error(`Input not found: ${config.input}`) : error;
      });
      const inputs = inputStat.isDirectory()
        ? (await readdir(config.input, { withFileTypes: true }))
          .filter(entry => entry.isFile() && supportsImage(entry.name))
          .map(entry => join(config.input, entry.name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        : [config.input];
      if (!inputs.length) throw new Error('No supported image inputs');
      const images = await materializeImages(inputs);
      // Exclusive root creation refuses existing data, symlinks and concurrent writers.
      output = config.output;
      await mkdir(output).catch((error: NodeJS.ErrnoException) => {
        throw error.code === 'EEXIST' ? new Error(`Output directory already exists: ${config.output}`) : error;
      });
      const workId = randomUUID(), chapterId = randomUUID(), now = new Date().toISOString();
      const workDir = join(output, 'works', workId);
      const chapterDir = join(workDir, 'chapters', chapterId);
      const pagesDir = join(chapterDir, 'pages');
      await mkdir(pagesDir, { recursive: true });
      const pages = [];
      for (const [index, image] of images.entries()) {
        const id = randomUUID();
        const imagePath = join(pagesDir, `${String(index + 1).padStart(3, '0')}-${id}${image.extension}`);
        await writeFile(imagePath, image.bytes);
        pages.push({ id, name: basename(image.path), imagePath, width: image.width, height: image.height,
          blocks: [], analysisStatus: 'idle' as const, createdAt: now, updatedAt: now });
      }
      const chapter: Chapter = { id: chapterId, workId, title: 'RoverCMT smoke',
        sourceKind: inputStat.isDirectory() ? 'folder' : 'images', status: 'idle',
        pageOrder: pages.map(page => page.id), pages, createdAt: now, updatedAt: now };
      chapterPath = join(chapterDir, 'chapter.json');
      await writeJson(chapterPath, chapter);
      await writeJson(join(workDir, 'work.json'), { id: workId, title: 'RoverCMT smoke',
        chapterOrder: [chapterId], createdAt: now, updatedAt: now });
      // Publish the index last: partially imported work is not discoverable.
      await writeJson(join(output, 'index.json'), { workOrder: [workId] });
      return chapter;
    },
    async commit(chapter) { await writeJson(chapterPath, chapter); },
    async finish(result) {
      await mkdir(join(output, 'runs'), { recursive: true });
      await writeJson(join(output, 'runs', `${result.runId}.json`), result);
    },
  };
}
