import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  resolvePageBlocksForReading,
  resolveReadingDirection,
  type BlockReadingDirection,
} from "../../shared/blockReadingOrder";
import type { ChapterSnapshot, LibraryIndex } from "../../shared/libraryTypes";
import type { LinkedWorkspaceStatus } from "../../shared/linkedWorkspaceTypes";
import {
  readRoverExportFolders,
  writeRoverExportFolders,
  writeTranslationCsvFile,
  writeTranslationJsonFile,
} from "./linkedWorkspaceFiles";
import { escapeDelimitedCell } from "../../shared/reviewTable";
import { safeResultPathSegment } from "./linkedWorkspacePaths";

/**
 * Human-readable projection of the authoritative chapter text. Page and block
 * numbers follow the editor's reading order; internal ids are not exported.
 */
export type TranslationJsonDocument = {
  schemaVersion: 2;
  workName: string;
  inputName: string;
  pages: Array<{
    page: number;
    blocks: Array<{
      block: number;
      sourceText: string;
      translatedText: string;
    }>;
  }>;
};

export function buildTranslationJson({
  chapter,
  readingDirection,
  workName,
}: {
  chapter: ChapterSnapshot;
  readingDirection: BlockReadingDirection;
  workName: string;
}): TranslationJsonDocument {
  const pagesById = new Map(chapter.pages.map((page) => [page.id, page]));
  const ordered = chapter.pageOrder.flatMap((id) => pagesById.get(id) ?? []);
  const unordered = chapter.pages.filter((page) => !ordered.includes(page));
  return {
    schemaVersion: 2,
    workName,
    inputName: chapter.title,
    pages: [...ordered, ...unordered].map((page, pageIndex) => ({
      page: pageIndex + 1,
      blocks: resolvePageBlocksForReading(page, readingDirection).map(
        (block, blockIndex) => ({
          block: blockIndex + 1,
          sourceText: block.sourceText,
          translatedText: block.translatedText,
        }),
      ),
    })),
  };
}

/**
 * One row per block, in the document's page and block order. Like the review
 * table export: RFC 4180 quoting, CRLF rows and a BOM so Excel reads UTF-8.
 */
export function serializeTranslationCsv(
  document: TranslationJsonDocument,
): string {
  const rows = [
    ["page", "block", "sourceText", "translatedText"],
    ...document.pages.flatMap((page) =>
      page.blocks.map((entry) => [
        String(page.page),
        String(entry.block),
        entry.sourceText,
        entry.translatedText,
      ]),
    ),
  ];
  const lines = rows.map((row) =>
    row.map((cell) => escapeDelimitedCell(cell, ",")).join(","),
  );
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** The same work name and block reading direction the editor uses. */
export function resolveTranslationJsonContext(
  chapter: Pick<ChapterSnapshot, "workId">,
  library: LibraryIndex,
  sourceReadingDirection: BlockReadingDirection,
): { workName: string; readingDirection: BlockReadingDirection } {
  const work = library.works.find((entry) => entry.id === chapter.workId);
  return {
    workName: work?.title ?? "",
    readingDirection: resolveReadingDirection(
      work?.readingDirection,
      sourceReadingDirection,
    ),
  };
}

type TranslationJsonExporterDependencies = {
  dataRoot: string;
  isEnabled: () => Promise<boolean>;
  /** The configured Rover export root, or null when unset or unavailable. */
  resolveOutputRoot: () => Promise<string | null>;
  getStatus: (chapterId: string) => LinkedWorkspaceStatus;
  listStatuses: () => LinkedWorkspaceStatus[];
  openChapter: (chapterId: string) => Promise<ChapterSnapshot>;
  resolveContext: (
    chapter: ChapterSnapshot,
  ) => Promise<ReturnType<typeof resolveTranslationJsonContext>>;
  reportError: (message: string, detail?: unknown) => void;
};

export function createTranslationJsonExporter(
  dependencies: TranslationJsonExporterDependencies,
) {
  let queue = Promise.resolve();
  const unavailableReported = new Set<string>();
  return {
    /** Never rejects; each write re-reads the latest chapter state. */
    sync(chapterId: string): Promise<void> {
      const next = queue
        .then(() =>
          writeChapterTranslationJson(
            dependencies,
            chapterId,
            unavailableReported,
          ),
        )
        .catch((error: unknown) => {
          dependencies.reportError("Failed to write translation.json", error);
        });
      queue = next;
      return next;
    },
  };
}

async function writeChapterTranslationJson(
  dependencies: TranslationJsonExporterDependencies,
  chapterId: string,
  unavailableReported: Set<string>,
): Promise<void> {
  if (!(await dependencies.isEnabled())) return;
  const outputRoot = await dependencies.resolveOutputRoot();
  const chapter = await dependencies.openChapter(chapterId);
  const directory = outputRoot
    ? await resolveRoverExportDirectory(dependencies, outputRoot, chapter)
    : await resolveLinkedExportDirectory(dependencies, chapterId);
  if (!directory) {
    if (!unavailableReported.has(chapterId))
      dependencies.reportError(
        "translation.json has no available destination",
        { chapterId },
      );
    unavailableReported.add(chapterId);
    return;
  }
  unavailableReported.delete(chapterId);
  const document = buildTranslationJson({
    chapter,
    ...(await dependencies.resolveContext(chapter)),
  });
  await writeTranslationJsonFile(directory, document);
  await writeTranslationCsvFile(directory, serializeTranslationCsv(document));
}

/**
 * `<root>/<inputName>/`, owned per chapter through a registry so that another
 * chapter or an existing user folder is never written into.
 */
async function resolveRoverExportDirectory(
  dependencies: TranslationJsonExporterDependencies,
  rootPath: string,
  chapter: ChapterSnapshot,
): Promise<string> {
  const folders = await readRoverExportFolders(dependencies.dataRoot);
  const sameRoot = folders.filter(
    (entry) => pathKey(entry.rootPath) === pathKey(rootPath),
  );
  const owned = sameRoot.find((entry) => entry.chapterId === chapter.id);
  if (owned) return join(rootPath, owned.folder);
  const taken = new Set(sameRoot.map((entry) => entry.folder.toLowerCase()));
  const base = safeResultPathSegment(chapter.title, "화");
  for (let suffix = 1; ; suffix += 1) {
    const folder = suffix === 1 ? base : `${base} (${suffix})`;
    if (taken.has(folder.toLowerCase())) continue;
    if (await pathExists(join(rootPath, folder))) continue;
    await writeRoverExportFolders(dependencies.dataRoot, [
      ...folders,
      { rootPath, chapterId: chapter.id, folder },
    ]);
    return join(rootPath, folder);
  }
}

/** Without a Rover root, keep the existing linked auto-save destination. */
async function resolveLinkedExportDirectory(
  dependencies: TranslationJsonExporterDependencies,
  chapterId: string,
): Promise<string | null> {
  const status = dependencies.getStatus(chapterId);
  if (!status.connectionId || status.state === "disabled" || !status.rootPath)
    return null;
  const rootPath = status.rootPath;
  const shared = dependencies
    .listStatuses()
    .some(
      (other) =>
        other.chapterId !== chapterId &&
        other.rootPath !== undefined &&
        pathKey(other.rootPath) === pathKey(rootPath),
    );
  // Never recreate a missing destination or mix chapters in one file.
  if (shared || !(await pathExists(rootPath))) return null;
  return rootPath;
}

function pathKey(path: string): string {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return false;
    throw error;
  }
}
