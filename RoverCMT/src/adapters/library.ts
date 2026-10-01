import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
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
      const inputStat = await stat(config.input);
      const inputs = inputStat.isDirectory()
        ? (await readdir(config.input, { withFileTypes: true }))
          .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.png')
          .map(entry => join(config.input, entry.name)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        : [config.input];
      if (!inputs.length) throw new Error('No PNG inputs');
      const images = await Promise.all(inputs.map(async path => {
        if (extname(path).toLowerCase() !== '.png') throw new Error('Step 1 supports PNG input only');
        const bytes = await readFile(path);
        if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
            bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`Invalid PNG header: ${path}`);
        const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
        if (!width || !height || width > 100000 || height > 100000) throw new Error('Invalid PNG dimensions');
        return { path, width, height };
      }));
      // Exclusive root creation refuses existing data, symlinks and concurrent writers.
      output = config.output;
      await mkdir(output);
      const workId = randomUUID(), chapterId = randomUUID(), now = new Date().toISOString();
      const workDir = join(output, 'works', workId);
      const chapterDir = join(workDir, 'chapters', chapterId);
      const pagesDir = join(chapterDir, 'pages');
      await mkdir(pagesDir, { recursive: true });
      const pages = [];
      for (const [index, image] of images.entries()) {
        const id = randomUUID();
        const imagePath = join(pagesDir, `${String(index + 1).padStart(3, '0')}-${id}.png`);
        await copyFile(image.path, imagePath);
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
