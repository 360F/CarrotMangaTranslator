import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import type { MangaPage } from "../../shared/libraryTypes";
import type { LinkedWorkspaceRecordV1 } from "../../shared/linkedWorkspaceTypes";
import {
  buildLinkedMirrorFileName,
  resolvePathInside,
} from "./linkedWorkspacePaths";
import {
  readJsonFile,
  writeJsonFile,
  writeTextFileAtomically,
} from "../libraryStore/storage";

export type FileFingerprint = {
  size: number;
  mtimeMs: number;
  ctimeMs?: number;
  sha256: string;
};

export async function fingerprintFile(
  filePath: string,
  previous?: FileFingerprint,
): Promise<FileFingerprint> {
  const metadata = await stat(filePath);
  if (!metadata.isFile())
    throw new Error("연결된 원본 이미지가 파일이 아닙니다.");
  if (
    previous?.ctimeMs === metadata.ctimeMs &&
    previous.mtimeMs === metadata.mtimeMs &&
    previous.size === metadata.size
  )
    return previous;
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  stream.on("data", (chunk) => hash.update(chunk));
  await once(stream, "end");
  return {
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    sha256: hash.digest("hex"),
  };
}

export function fingerprintBuffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function countLinkedWorkspaceConflicts(
  rootPath: string,
): Promise<number> {
  let count = 0;
  for (const directory of ["result", "inpainted", "mask"] as const) {
    count += await countFiles(
      resolvePathInside(rootPath, `${directory}/.probe`),
      true,
    );
  }
  try {
    const mirror = await stat(
      resolvePathInside(rootPath, buildLinkedMirrorFileName(rootPath)),
    );
    if (mirror.isFile()) count += 1;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  return count;
}

async function countFiles(
  probePath: string,
  useParent: boolean,
): Promise<number> {
  const directory = useParent
    ? probePath.replace(/[\\/]\.probe$/, "")
    : probePath;
  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
      recursive: true,
    });
    return entries.filter((entry) => entry.isFile()).length;
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    throw error;
  }
}

export type LinkedMirrorArtifact = {
  path: string;
  bytes: number;
  sha256: string;
};

type LinkedMirrorPage = Pick<
  MangaPage,
  | "id"
  | "name"
  | "width"
  | "height"
  | "blocks"
  | "blockOrder"
  | "maskProvenance"
  | "translationCompletion"
> & {
  sourceRelativePath: string;
  source: LinkedMirrorArtifact;
  result?: LinkedMirrorArtifact;
  inpainted?: LinkedMirrorArtifact;
  mask?: LinkedMirrorArtifact;
};

export type LinkedMirrorChapter = {
  id: string;
  workId: string;
  workTitle: string;
  title: string;
  output: LinkedWorkspaceRecordV1["output"];
  pages: LinkedMirrorPage[];
};

export async function writeLinkedWorkspaceMirror({
  rootPath,
  appVersion,
  chapters,
  beforeCommit,
}: {
  rootPath: string;
  appVersion: string;
  chapters: LinkedMirrorChapter[];
  beforeCommit?: () => void;
}): Promise<void> {
  await writeJsonFile(
    resolvePathInside(rootPath, buildLinkedMirrorFileName(rootPath)),
    {
      schemaVersion: 1,
      appVersion,
      updatedAt: new Date().toISOString(),
      chapters,
    },
    beforeCommit,
  );
}

const TRANSLATION_JSON_FILE_NAME = "translation.json";
const TRANSLATION_CSV_FILE_NAME = "translation.csv";
const ROVER_EXPORT_FOLDERS_FILE_NAME = "rover-translation-exports.json";

/** The folder a chapter owns below one Rover export root. */
export type RoverExportFolder = {
  rootPath: string;
  chapterId: string;
  folder: string;
};

export async function writeTranslationJsonFile(
  directory: string,
  document: unknown,
): Promise<void> {
  await writeJsonFile(join(directory, TRANSLATION_JSON_FILE_NAME), document);
}

export async function writeTranslationCsvFile(
  directory: string,
  csv: string,
): Promise<void> {
  await writeTextFileAtomically(
    join(directory, TRANSLATION_CSV_FILE_NAME),
    csv,
  );
}

export async function readRoverExportFolders(
  dataRoot: string,
): Promise<RoverExportFolder[]> {
  const value = await readJsonFile<unknown>(
    join(dataRoot, ROVER_EXPORT_FOLDERS_FILE_NAME),
    null,
  );
  const folders =
    value && typeof value === "object" && "folders" in value
      ? value.folders
      : [];
  return Array.isArray(folders) ? folders.filter(isRoverExportFolder) : [];
}

export async function writeRoverExportFolders(
  dataRoot: string,
  folders: RoverExportFolder[],
): Promise<void> {
  await writeJsonFile(join(dataRoot, ROVER_EXPORT_FOLDERS_FILE_NAME), {
    schemaVersion: 1,
    folders,
  });
}

function isRoverExportFolder(value: unknown): value is RoverExportFolder {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.rootPath === "string" &&
    typeof entry.chapterId === "string" &&
    typeof entry.folder === "string"
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
