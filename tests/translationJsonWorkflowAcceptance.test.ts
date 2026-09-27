import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MangaPage } from "../src/shared/libraryTypes";
import type { PageWorkflowStage } from "../src/shared/pageWorkflowStages";
import { createPageWorkflowPlan } from "../src/shared/pageWorkflowTypes";
import { DEFAULT_RASTER_EXPORT_SETTINGS } from "../src/shared/linkedWorkspaceTypes";
import { makeBlock, makePage } from "./helpers/workspacePointerFixtures";

vi.mock("electron", () => ({
  app: { getVersion: () => "2.8.2" },
  shell: { openPath: vi.fn(async () => "") },
}));

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const roots: string[] = [];
const cleanups: Array<() => unknown> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.doUnmock("../src/main/appPaths");
  vi.resetModules();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function tempDir(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `translation-json-${label}-`));
  roots.push(root);
  return root;
}

/** A persisted chapter with two imported pages and no blocks yet. */
async function writeLibrary(libraryDir: string) {
  const workId = randomUUID();
  const chapterId = randomUUID();
  const directory = join(libraryDir, "works", workId, "chapters", chapterId);
  await mkdir(directory, { recursive: true });
  const pages = await Promise.all(
    [1, 2].map(async (index) => {
      const imagePath = join(directory, `00${index}.png`);
      await writeFile(imagePath, ONE_PIXEL_PNG);
      const { dataUrl: _dataUrl, ...page } = {
        ...makePage(),
        id: randomUUID(),
        name: `00${index}.png`,
        sourceFileName: `00${index}.png`,
        imagePath,
        blocks: [],
      };
      return page;
    }),
  );
  const timestamp = "2026-01-01T00:00:00.000Z";
  await writeFile(
    join(directory, "chapter.json"),
    JSON.stringify({
      id: chapterId,
      workId,
      title: "1화",
      sourceKind: "images",
      status: "idle",
      pageOrder: pages.map((page) => page.id),
      pages,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  await writeFile(
    join(libraryDir, "index.json"),
    JSON.stringify({ workOrder: [workId] }),
  );
  await writeFile(
    join(libraryDir, "works", workId, "work.json"),
    JSON.stringify({
      id: workId,
      title: "테스트 작품",
      chapterOrder: [chapterId],
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  return { workId, chapterId, pageIds: pages.map((page) => page.id) };
}

/** Deterministic stand-ins for Koharu detection, Hayai OCR and Gemma. */
function executeStage(stage: PageWorkflowStage, page: MangaPage): MangaPage {
  if (stage === "detect")
    return {
      ...page,
      blocks: ["a", "b"].map((suffix) =>
        makeBlock(false, {
          id: `${page.id}-detect-block-${suffix}`,
          sourceText: "",
          translatedText: "",
        }),
      ),
      blockOrder: [`${page.id}-detect-block-a`, `${page.id}-detect-block-b`],
    };
  if (stage === "ocr")
    return {
      ...page,
      blocks: page.blocks.map((block) => ({
        ...block,
        sourceText: `原文 ${block.id}`,
      })),
    };
  if (stage === "translate")
    return {
      ...page,
      analysisStatus: "completed",
      blocks: page.blocks.map((block) => ({
        ...block,
        translatedText: `번역 ${block.id}`,
      })),
    };
  throw new Error(`unexpected workflow stage: ${stage}`);
}

async function setup(
  enabled: boolean,
  prepareManagedRoot?: (root: string, chapterId: string) => Promise<void>,
) {
  const dataRoot = await tempDir("data");
  const libraryDir = join(dataRoot, "library");
  const outputParent = await tempDir("output");
  vi.resetModules();
  vi.doMock("../src/main/appPaths", () => ({
    getAppPaths: () => ({
      dataRoot,
      libraryDir,
      logFile: join(dataRoot, "test.log"),
    }),
  }));
  const ids = await writeLibrary(libraryDir);
  const { openChapter, listLibrary } =
    await import("../src/main/library/libraryReadFacade");
  const { savePageWorkflowResult, updatePagesAfterInpainting } =
    await import("../src/main/library/libraryMutationFacade");
  const { executePageWorkflow } =
    await import("../src/main/application/pageWorkflowService");
  const { LinkedWorkspaceSyncService } =
    await import("../src/main/linkedWorkspace/linkedWorkspaceSyncService");
  const { createLinkedWorkspaceSaveNotifier } =
    await import("../src/main/linkedWorkspace/linkedWorkspaceRuntime");
  const { createTranslationJsonExporter } =
    await import("../src/main/linkedWorkspace/linkedWorkspaceTranslationJson");
  const { installLinkedWorkspaceSaveNotifier } =
    await import("../src/main/linkedWorkspace/linkedWorkspaceNotifications");

  const createRenderSession = vi.fn(async () => {
    throw new Error("the translate-only workflow must not need a render");
  });
  const reportError = vi.fn();
  const service = new LinkedWorkspaceSyncService({
    dataRoot,
    jobs: { hasActive: false } as never,
    decodeImage: async () => null,
    getMainWindow: () => null,
    reportError,
    dependencies: {
      listLibrary,
      openChapter,
      updatePagesAfterInpainting,
      createPageExportRenderSession: createRenderSession as never,
      resolveManagedOutputParent: async () => outputParent,
    },
  });
  await service.initialize();
  cleanups.push(() => service.dispose());
  await prepareManagedRoot?.(
    join(outputParent, "테스트 작품", "1화"),
    ids.chapterId,
  );
  await service.connect({
    workId: ids.workId,
    chapterId: ids.chapterId,
    output: { ...DEFAULT_RASTER_EXPORT_SETTINGS, destinationMode: "fixed" },
    enqueueExistingPages: false,
  });
  const exporter = createTranslationJsonExporter({
    isEnabled: async () => enabled,
    getStatus: (chapterId) => service.getStatus(chapterId),
    openChapter: (chapterId) => openChapter(chapterId),
    reportError,
  });
  const exports: Promise<void>[] = [];
  const trackedExporter = {
    sync: (chapterId: string) => {
      const pending = exporter.sync(chapterId);
      exports.push(pending);
      return pending;
    },
  };
  cleanups.push(
    installLinkedWorkspaceSaveNotifier(
      createLinkedWorkspaceSaveNotifier(service, trackedExporter),
      reportError,
    ),
  );

  const stages: PageWorkflowStage[] = ["detect", "ocr", "translate"];
  const executed: PageWorkflowStage[] = [];
  const run = async () => {
    const result = await executePageWorkflow(
      {
        runId: randomUUID(),
        plan: { ...createPageWorkflowPlan(stages), stages },
        selection: [{ chapterId: ids.chapterId, pageIds: ids.pageIds }],
        signal: new AbortController().signal,
      },
      {
        readChapter: (chapterId) => openChapter(chapterId),
        acquirePage: async (chapterId, pageId) => {
          const chapter = await openChapter(chapterId);
          const page = chapter.pages.find((entry) => entry.id === pageId);
          if (!page) throw new Error("missing page");
          return page;
        },
        releasePage: vi.fn(),
        prepareStage: vi.fn(async () => {}),
        progress: vi.fn(),
        isFatal: () => true,
        execute: async (stage, _chapter, page) => {
          executed.push(stage);
          return executeStage(stage, page);
        },
        save: savePageWorkflowResult,
      },
    );
    await Promise.all(exports);
    return result;
  };
  const expectedRoot = join(outputParent, "테스트 작품", "1화");
  return {
    ...ids,
    createRenderSession,
    executed,
    expectedRoot,
    exports,
    openChapter,
    reportError,
    run,
    service,
  };
}

describe("translation.json workflow acceptance", () => {
  it("exports after Detect + OCR + Translation without typography, erase, layout or a result image", async () => {
    const f = await setup(true);
    expect(f.service.getStatus(f.chapterId).rootPath).toBe(f.expectedRoot);

    const result = await f.run();

    expect(result.status).toBe("completed");
    expect(new Set(f.executed)).toEqual(
      new Set(["detect", "ocr", "translate"]),
    );
    const chapter = await f.openChapter(f.chapterId);
    for (const page of chapter.pages) {
      expect(page.pageWorkflow?.steps.translate?.status).toBe("completed");
      expect(page.pageWorkflow?.steps.typography).toBeUndefined();
      expect(page.pageWorkflow?.steps.erase).toBeUndefined();
      expect(page.pageWorkflow?.steps.layout).toBeUndefined();
      expect(page.inpaintedImagePath).toBeUndefined();
    }
    const saved = JSON.parse(
      await readFile(join(f.expectedRoot, "translation.json"), "utf8"),
    );
    expect(saved).toEqual({
      schemaVersion: 1,
      workId: f.workId,
      chapterId: f.chapterId,
      pages: chapter.pages.map((page) => ({
        pageId: page.id,
        blocks: page.blocks.map((block) => ({
          blockId: block.id,
          sourceText: `原文 ${block.id}`,
          translatedText: `번역 ${block.id}`,
        })),
      })),
    });
    expect(saved.pages.map((page: { pageId: string }) => page.pageId)).toEqual(
      f.pageIds,
    );
    expect(f.createRenderSession).not.toHaveBeenCalled();
    expect(await readdir(f.expectedRoot)).not.toContain("result");
    expect(f.reportError).not.toHaveBeenCalled();
  });

  it("refreshes translatedText when a translation is edited later", async () => {
    const f = await setup(true);
    await f.run();
    const { savePagesBlocks } =
      await import("../src/main/library/libraryMutationFacade");
    const chapter = await f.openChapter(f.chapterId);
    const page = chapter.pages[0];
    await savePagesBlocks({
      chapterId: f.chapterId,
      pages: [
        {
          pageId: page.id,
          blocks: page.blocks.map((block, index) =>
            index === 0
              ? { ...block, translatedText: "직접 고친 번역" }
              : block,
          ),
          blockOrder: page.blockOrder,
        },
      ],
    });
    await Promise.all(f.exports);
    const saved = JSON.parse(
      await readFile(join(f.expectedRoot, "translation.json"), "utf8"),
    );
    expect(saved.pages[0].blocks[0]).toEqual({
      blockId: page.blocks[0].id,
      sourceText: `原文 ${page.blocks[0].id}`,
      translatedText: "직접 고친 번역",
    });
  });

  it("keeps the existing output untouched when the option is off", async () => {
    const f = await setup(false);
    expect((await f.run()).status).toBe("completed");
    await expect(
      readFile(join(f.expectedRoot, "translation.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.reportError).not.toHaveBeenCalled();
  });

  it.each([
    ["its own chapter", true, ""],
    ["another chapter", false, " (2)"],
  ])(
    "treats a managed folder's translation.json owned by %s accordingly",
    async (_label, ownedByChapter, suffix) => {
      const f = await setup(true, async (root, chapterId) => {
        await mkdir(root, { recursive: true });
        await writeFile(
          join(root, "translation.json"),
          JSON.stringify({
            schemaVersion: 1,
            chapterId: ownedByChapter ? chapterId : randomUUID(),
          }),
        );
      });
      expect(f.service.getStatus(f.chapterId).rootPath).toBe(
        `${f.expectedRoot}${suffix}`,
      );
    },
  );
});
