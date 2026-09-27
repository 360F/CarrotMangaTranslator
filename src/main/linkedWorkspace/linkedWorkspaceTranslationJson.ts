import { stat } from "node:fs/promises";
import type { ChapterSnapshot } from "../../shared/libraryTypes";
import type { LinkedWorkspaceStatus } from "../../shared/linkedWorkspaceTypes";
import {
  readTranslationJsonChapterId,
  writeTranslationJsonFile,
} from "./linkedWorkspaceFiles";

/**
 * Read-only projection of the authoritative chapter text. It is regenerated
 * from the library on every save and is never read back into the project.
 */
export type TranslationJsonDocument = {
  schemaVersion: 1;
  workId: string;
  chapterId: string;
  pages: Array<{
    pageId: string;
    blocks: Array<{
      blockId: string;
      sourceText: string;
      translatedText: string;
    }>;
  }>;
};

export function buildTranslationJson(
  chapter: ChapterSnapshot,
): TranslationJsonDocument {
  return {
    schemaVersion: 1,
    workId: chapter.workId,
    chapterId: chapter.id,
    pages: chapter.pages.map((page) => ({
      pageId: page.id,
      blocks: page.blocks.map((block) => ({
        blockId: block.id,
        sourceText: block.sourceText,
        translatedText: block.translatedText,
      })),
    })),
  };
}

type TranslationJsonExporterDependencies = {
  isEnabled: () => Promise<boolean>;
  getStatus: (chapterId: string) => LinkedWorkspaceStatus;
  openChapter: (chapterId: string) => Promise<ChapterSnapshot>;
  reportError: (message: string, detail?: unknown) => void;
};

export function createTranslationJsonExporter(
  dependencies: TranslationJsonExporterDependencies,
) {
  const pending = new Map<string, Promise<void>>();
  return {
    /** Never rejects; each write re-reads the latest chapter state. */
    sync(chapterId: string): Promise<void> {
      const next = (pending.get(chapterId) ?? Promise.resolve())
        .then(() => writeChapterTranslationJson(dependencies, chapterId))
        .catch((error: unknown) => {
          dependencies.reportError("Failed to write translation.json", error);
        });
      pending.set(chapterId, next);
      void next.finally(() => {
        if (pending.get(chapterId) === next) pending.delete(chapterId);
      });
      return next;
    },
  };
}

async function writeChapterTranslationJson(
  dependencies: TranslationJsonExporterDependencies,
  chapterId: string,
): Promise<void> {
  if (!(await dependencies.isEnabled())) return;
  const status = dependencies.getStatus(chapterId);
  if (!status.connectionId || status.state === "disabled" || !status.rootPath)
    return;
  const rootPath = status.rootPath;
  // Never recreate a missing destination or take over another chapter's file.
  if (!(await isDirectory(rootPath))) return;
  const owner = await readTranslationJsonChapterId(rootPath);
  if (owner !== null && owner !== chapterId) return;
  const chapter = await dependencies.openChapter(chapterId);
  await writeTranslationJsonFile(rootPath, buildTranslationJson(chapter));
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
