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
import { resolveDefaultAppSettings } from "../src/main/appSettings";
import { withTranslationResourceHint } from "../src/main/pageWorkflow/pageWorkflowResourceHints";
import { makeBlock, makePage } from "./helpers/workspacePointerFixtures";

vi.mock("electron", () => ({
  app: { getVersion: () => "2.8.2" },
  shell: { openPath: vi.fn(async () => "") },
}));

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const WORK_NAME = "미정 작품";
const INPUT_NAME =
  "アグネスタキオンさんご夫妻がお隣に引っ越してきました_yanyo_yanyanyo1";
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

/** A persisted four-page folder import with no blocks yet. */
async function writeLibrary(libraryDir: string) {
  const workId = randomUUID();
  const chapterId = randomUUID();
  const directory = join(libraryDir, "works", workId, "chapters", chapterId);
  await mkdir(directory, { recursive: true });
  const pages = await Promise.all(
    [1, 2, 3, 4].map(async (index) => {
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
      title: INPUT_NAME,
      sourceKind: "folder",
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
      title: WORK_NAME,
      chapterOrder: [chapterId],
      readingDirection: "rtl",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  return { workId, chapterId, pageIds: pages.map((page) => page.id) };
}

/** Deterministic stand-ins for Koharu detection, Hayai OCR and Gemma. */
function executeStage(stage: PageWorkflowStage, page: MangaPage): MangaPage {
  if (stage === "detect") {
    const blocks = [
      ["right", 700],
      ["left", 100],
    ].map(([suffix, x]) =>
      makeBlock(false, {
        id: `${page.id}-detect-block-${suffix}`,
        bbox: { x: Number(x), y: 100, w: 150, h: 100 },
        sourceText: "",
        translatedText: "",
      }),
    );
    return { ...page, blocks, blockOrder: blocks.map((block) => block.id) };
  }
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

async function setup({
  enabled,
  roverOutput,
}: {
  enabled: boolean;
  roverOutput: boolean;
}) {
  const dataRoot = await tempDir("data");
  const libraryDir = join(dataRoot, "library");
  const outputRoot = await tempDir("rover-output");
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
  const {
    savePageWorkflowResult,
    savePagesBlocks,
    updatePagesAfterInpainting,
  } = await import("../src/main/library/libraryMutationFacade");
  const { executePageWorkflow } =
    await import("../src/main/application/pageWorkflowService");
  const { LinkedWorkspaceSyncService } =
    await import("../src/main/linkedWorkspace/linkedWorkspaceSyncService");
  const { createLinkedWorkspaceSaveNotifier } =
    await import("../src/main/linkedWorkspace/linkedWorkspaceRuntime");
  const { createTranslationJsonExporter, resolveTranslationJsonContext } =
    await import("../src/main/linkedWorkspace/linkedWorkspaceTranslationJson");
  const { installLinkedWorkspaceSaveNotifier } =
    await import("../src/main/linkedWorkspace/linkedWorkspaceNotifications");

  const createRenderSession = vi.fn(async () => {
    throw new Error("the translate-only workflow must not need a render");
  });
  const reportError = vi.fn();
  // Carrot's linked auto-save stays connected to its own managed destination.
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
    },
  });
  await service.initialize();
  cleanups.push(() => service.dispose());
  await service.connect({
    workId: ids.workId,
    chapterId: ids.chapterId,
    output: { ...DEFAULT_RASTER_EXPORT_SETTINGS, destinationMode: "fixed" },
    enqueueExistingPages: false,
  });
  const exporter = createTranslationJsonExporter({
    dataRoot,
    isEnabled: async () => enabled,
    resolveOutputRoot: async () => (roverOutput ? outputRoot : null),
    getStatus: (chapterId) => service.getStatus(chapterId),
    listStatuses: () => service.listStatuses(),
    openChapter: (chapterId) => openChapter(chapterId),
    resolveContext: async (chapter) =>
      resolveTranslationJsonContext(chapter, await listLibrary(), "rtl"),
    reportError,
  });
  const exports: Promise<void>[] = [];
  cleanups.push(
    installLinkedWorkspaceSaveNotifier(
      createLinkedWorkspaceSaveNotifier(service, {
        sync: (chapterId: string) => {
          const pending = exporter.sync(chapterId);
          exports.push(pending);
          return pending;
        },
      }),
      reportError,
    ),
  );

  // The parallel preference is on; this plan cannot overlap stages.
  const settings = resolveDefaultAppSettings();
  settings.modelProvider = "openai-api";
  settings.api.experimentalParallelAcceleration = true;
  const stages: PageWorkflowStage[] = ["detect", "ocr", "translate"];
  const request = withTranslationResourceHint(
    {
      plan: { ...createPageWorkflowPlan(stages), stages },
      selection: [{ chapterId: ids.chapterId, pageIds: ids.pageIds }],
    },
    settings,
  );
  const executed: PageWorkflowStage[] = [];
  const run = async () => {
    const result = await executePageWorkflow(
      { ...request, runId: randomUUID(), signal: new AbortController().signal },
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
  return {
    ...ids,
    createRenderSession,
    executed,
    exports,
    linkedRoot: service.getStatus(ids.chapterId).rootPath ?? "",
    openChapter,
    outputRoot,
    reportError,
    request,
    run,
    savePagesBlocks,
    settings,
  };
}

describe("translation.json workflow acceptance", () => {
  it("exports numbered text into the Rover Output after Detect + OCR + Translation only", async () => {
    const f = await setup({ enabled: true, roverOutput: true });
    expect(f.request.plan.experimentalParallelAcceleration).toBe(false);

    const result = await f.run();

    expect(result.status).toBe("completed");
    expect(result.issues).toEqual([]);
    expect(f.settings.api.experimentalParallelAcceleration).toBe(true);
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
    expect(await readdir(f.outputRoot)).toEqual([INPUT_NAME]);
    expect((await readdir(join(f.outputRoot, INPUT_NAME))).sort()).toEqual([
      "translation.csv",
      "translation.json",
    ]);
    const saved = JSON.parse(
      await readFile(
        join(f.outputRoot, INPUT_NAME, "translation.json"),
        "utf8",
      ),
    );
    expect(saved).toEqual({
      schemaVersion: 2,
      workName: WORK_NAME,
      inputName: INPUT_NAME,
      pages: f.pageIds.map((pageId, index) => ({
        page: index + 1,
        blocks: ["right", "left"].map((suffix, blockIndex) => ({
          block: blockIndex + 1,
          sourceText: `原文 ${pageId}-detect-block-${suffix}`,
          translatedText: `번역 ${pageId}-detect-block-${suffix}`,
        })),
      })),
    });
    const csv = await readFile(
      join(f.outputRoot, INPUT_NAME, "translation.csv"),
      "utf8",
    );
    expect(csv).toBe(
      [
        "﻿page,block,sourceText,translatedText",
        ...saved.pages.flatMap(
          (page: { page: number; blocks: (typeof saved.pages)[0]["blocks"] }) =>
            page.blocks.map(
              (entry: {
                block: number;
                sourceText: string;
                translatedText: string;
              }) =>
                `${page.page},${entry.block},${entry.sourceText},${entry.translatedText}`,
            ),
        ),
        "",
      ].join("\r\n"),
    );
    // Carrot's linked destination keeps its own managed location.
    expect(f.linkedRoot).toContain(join("results", WORK_NAME, INPUT_NAME));
    expect(f.linkedRoot.startsWith(f.outputRoot)).toBe(false);
    expect(await readdir(f.linkedRoot)).not.toContain("translation.json");
    expect(await readdir(f.linkedRoot)).not.toContain("translation.csv");
    expect(f.createRenderSession).not.toHaveBeenCalled();
    expect(f.reportError).not.toHaveBeenCalled();
  });

  it("refreshes translatedText when a translation is edited later", async () => {
    const f = await setup({ enabled: true, roverOutput: true });
    await f.run();
    const page = (await f.openChapter(f.chapterId)).pages[0];
    await f.savePagesBlocks({
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
      await readFile(
        join(f.outputRoot, INPUT_NAME, "translation.json"),
        "utf8",
      ),
    );
    expect(saved.pages[0].blocks[0]).toEqual({
      block: 1,
      sourceText: `原文 ${page.blocks[0].id}`,
      translatedText: "직접 고친 번역",
    });
  });

  it("falls back to the linked auto-save destination without a Rover Output", async () => {
    const f = await setup({ enabled: true, roverOutput: false });
    expect((await f.run()).status).toBe("completed");
    expect(await readdir(f.outputRoot)).toEqual([]);
    const saved = JSON.parse(
      await readFile(join(f.linkedRoot, "translation.json"), "utf8"),
    );
    expect(saved.inputName).toBe(INPUT_NAME);
    expect(saved.pages).toHaveLength(4);
    expect(await readdir(f.linkedRoot)).toContain("translation.csv");
  });

  it("keeps every output untouched when the option is off", async () => {
    const f = await setup({ enabled: false, roverOutput: true });
    expect((await f.run()).status).toBe("completed");
    expect(await readdir(f.outputRoot)).toEqual([]);
    expect(await readdir(f.linkedRoot)).not.toContain("translation.json");
    expect(await readdir(f.linkedRoot)).not.toContain("translation.csv");
    expect(f.reportError).not.toHaveBeenCalled();
  });
});
