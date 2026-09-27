import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChapterSnapshot } from "../src/shared/libraryTypes";
import type { LinkedWorkspaceStatus } from "../src/shared/linkedWorkspaceTypes";
import {
  buildTranslationJson,
  createTranslationJsonExporter,
} from "../src/main/linkedWorkspace/linkedWorkspaceTranslationJson";
import { TRANSLATION_JSON_FILE_NAME } from "../src/main/linkedWorkspace/linkedWorkspaceFiles";
import { makeBlock, makePage } from "./helpers/workspacePointerFixtures";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function makeTwoPageChapter(): ChapterSnapshot {
  const first = makePage({
    withBubbleLayout: true,
    additionalBlocks: [
      makeBlock(false, {
        id: "block-b",
        sourceText: "二番目",
        translatedText: "두 번째",
      }),
    ],
    blockPatch: {
      id: "block-a",
      sourceText: "一番目",
      translatedText: "첫 번째",
    },
  });
  const second = {
    ...makePage({
      blockPatch: {
        id: "block-c",
        sourceText: "三番目",
        translatedText: "세 번째",
      },
    }),
    id: "page-2",
    name: "page-2.png",
  };
  return {
    id: "chapter-1",
    workId: "work-1",
    title: "1화",
    sourceKind: "images",
    status: "idle",
    pageOrder: [second.id, first.id],
    pages: [second, first],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "translation-json-"));
  roots.push(root);
  return root;
}

function connectedStatus(
  rootPath: string,
  patch: Partial<LinkedWorkspaceStatus> = {},
): LinkedWorkspaceStatus {
  return {
    chapterId: "chapter-1",
    connectionId: "connection-1",
    state: "idle",
    pendingCount: 0,
    failedCount: 0,
    rootPath,
    ...patch,
  };
}

function makeExporter(options: {
  chapter: () => ChapterSnapshot;
  enabled?: boolean;
  status: LinkedWorkspaceStatus;
}) {
  const reportError = vi.fn();
  const exporter = createTranslationJsonExporter({
    isEnabled: async () => options.enabled ?? true,
    getStatus: () => options.status,
    openChapter: async () => structuredClone(options.chapter()),
    reportError,
  });
  return { exporter, reportError };
}

describe("buildTranslationJson", () => {
  it("keeps stored page and block order and only the translation fields", () => {
    const document = buildTranslationJson(makeTwoPageChapter());
    expect(document).toEqual({
      schemaVersion: 1,
      workId: "work-1",
      chapterId: "chapter-1",
      pages: [
        {
          pageId: "page-2",
          blocks: [
            {
              blockId: "block-c",
              sourceText: "三番目",
              translatedText: "세 번째",
            },
          ],
        },
        {
          pageId: "page-1",
          blocks: [
            {
              blockId: "block-a",
              sourceText: "一番目",
              translatedText: "첫 번째",
            },
            {
              blockId: "block-b",
              sourceText: "二番目",
              translatedText: "두 번째",
            },
          ],
        },
      ],
    });
    const serialized = JSON.stringify(document);
    for (const excluded of [
      "bbox",
      "renderBbox",
      "bubbleLayout",
      "fontSizePx",
      "textColor",
      "pageWorkflow",
      "inpaint",
      "mask",
      "reviewStatus",
    ])
      expect(serialized).not.toContain(excluded);
  });
});

describe("createTranslationJsonExporter", () => {
  it("writes nothing when the option is off", async () => {
    const root = await makeRoot();
    const { exporter } = makeExporter({
      chapter: makeTwoPageChapter,
      enabled: false,
      status: connectedStatus(root),
    });
    await exporter.sync("chapter-1");
    expect(await readdir(root)).toEqual([]);
  });

  it("writes nothing for an unlinked or disabled chapter", async () => {
    const root = await makeRoot();
    for (const status of [
      {
        chapterId: "chapter-1",
        state: "unlinked",
        pendingCount: 0,
        failedCount: 0,
      },
      connectedStatus(root, { state: "disabled" }),
    ] as LinkedWorkspaceStatus[]) {
      const { exporter } = makeExporter({
        chapter: makeTwoPageChapter,
        status,
      });
      await exporter.sync("chapter-1");
    }
    expect(await readdir(root)).toEqual([]);
  });

  it("writes the projection into the linked destination root", async () => {
    const root = await makeRoot();
    const { exporter, reportError } = makeExporter({
      chapter: makeTwoPageChapter,
      status: connectedStatus(root),
    });
    await exporter.sync("chapter-1");
    expect(
      JSON.parse(
        await readFile(join(root, TRANSLATION_JSON_FILE_NAME), "utf8"),
      ),
    ).toEqual(buildTranslationJson(makeTwoPageChapter()));
    expect(reportError).not.toHaveBeenCalled();
  });

  it("rewrites the latest text after an edit, even with overlapping syncs", async () => {
    const root = await makeRoot();
    let chapter = makeTwoPageChapter();
    const { exporter } = makeExporter({
      chapter: () => chapter,
      status: connectedStatus(root),
    });
    const first = exporter.sync("chapter-1");
    chapter = structuredClone(chapter);
    chapter.pages[1].blocks[0].translatedText = "수정된 번역";
    await Promise.all([first, exporter.sync("chapter-1")]);
    const saved = JSON.parse(
      await readFile(join(root, TRANSLATION_JSON_FILE_NAME), "utf8"),
    );
    expect(saved.pages[1].blocks[0]).toEqual({
      blockId: "block-a",
      sourceText: "一番目",
      translatedText: "수정된 번역",
    });
  });

  it("never recreates a missing destination", async () => {
    const root = join(await makeRoot(), "removed");
    const { exporter, reportError } = makeExporter({
      chapter: makeTwoPageChapter,
      status: connectedStatus(root),
    });
    await exporter.sync("chapter-1");
    await expect(readdir(root)).rejects.toMatchObject({ code: "ENOENT" });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not overwrite another chapter's translation.json in a shared root", async () => {
    const root = await makeRoot();
    const foreign = JSON.stringify({ schemaVersion: 1, chapterId: "other" });
    await writeFile(join(root, TRANSLATION_JSON_FILE_NAME), foreign);
    const { exporter } = makeExporter({
      chapter: makeTwoPageChapter,
      status: connectedStatus(root),
    });
    await exporter.sync("chapter-1");
    expect(await readFile(join(root, TRANSLATION_JSON_FILE_NAME), "utf8")).toBe(
      foreign,
    );
  });

  it("reports failures without rejecting the save notification", async () => {
    const root = await makeRoot();
    const { exporter, reportError } = makeExporter({
      chapter: () => {
        throw new Error("library read failed");
      },
      status: connectedStatus(root),
    });
    await expect(exporter.sync("chapter-1")).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(
      "Failed to write translation.json",
      expect.any(Error),
    );
  });
});
