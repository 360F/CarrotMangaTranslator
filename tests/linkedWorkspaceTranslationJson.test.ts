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
import type { ChapterSnapshot, LibraryIndex } from "../src/shared/libraryTypes";
import type { LinkedWorkspaceStatus } from "../src/shared/linkedWorkspaceTypes";
import type { TranslationBlock } from "../src/shared/textTypes";
import {
  buildTranslationJson,
  createTranslationJsonExporter,
  resolveTranslationJsonContext,
  serializeTranslationCsv,
} from "../src/main/linkedWorkspace/linkedWorkspaceTranslationJson";
import { readRoverExportFolders } from "../src/main/linkedWorkspace/linkedWorkspaceFiles";
import { safeResultPathSegment } from "../src/main/linkedWorkspace/linkedWorkspacePaths";
import { resolveSettingsSourceReadingDirection } from "../src/main/settings/translationOptions";
import { resolveDefaultAppSettings } from "../src/main/appSettings";
import { makeBlock, makePage } from "./helpers/workspacePointerFixtures";

const INPUT_NAME =
  "アグネスタキオンさんご夫妻がお隣に引っ越してきました_yanyo_yanyanyo1";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `translation-json-${label}-`));
  roots.push(root);
  return root;
}

function block(
  id: string,
  x: number,
  y: number,
  text: string,
): TranslationBlock {
  return makeBlock(false, {
    id,
    bbox: { x, y, w: 100, h: 80 },
    sourceText: `原文 ${text}`,
    translatedText: `번역 ${text}`,
  });
}

/** Four pages whose stored array order differs from the authoritative pageOrder. */
function makeFourPageChapter(title = INPUT_NAME): ChapterSnapshot {
  const pages = ["p1", "p2", "p3", "p4"].map((id) => ({
    ...makePage(),
    id: `page-${id}`,
    name: `${id}.png`,
    blocks: [
      // Stored array order is deliberately not the reading order.
      block(`${id}-left`, 100, 100, `${id}-left`),
      block(`${id}-right`, 700, 100, `${id}-right`),
      block(`${id}-lower`, 400, 600, `${id}-lower`),
    ],
    // Only the lower block is ordered explicitly; the rest is repaired.
    blockOrder: [`${id}-lower`],
  }));
  return {
    id: "chapter-1",
    workId: "work-1",
    title,
    sourceKind: "folder",
    status: "completed",
    pageOrder: ["page-p1", "page-p2", "page-p3", "page-p4"],
    pages: [pages[2], pages[0], pages[3], pages[1]],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeLibrary(readingDirection?: "auto" | "rtl" | "ltr"): LibraryIndex {
  return {
    workOrder: ["work-1"],
    works: [
      {
        id: "work-1",
        title: "미정 작품",
        chapterOrder: ["chapter-1"],
        ...(readingDirection ? { readingDirection } : {}),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        chapters: [],
      },
    ],
  };
}

function status(
  chapterId: string,
  patch: Partial<LinkedWorkspaceStatus> = {},
): LinkedWorkspaceStatus {
  return {
    chapterId,
    connectionId: `connection-${chapterId}`,
    state: "idle",
    pendingCount: 0,
    failedCount: 0,
    ...patch,
  };
}

async function makeExporter(options: {
  chapters?: () => ChapterSnapshot[];
  enabled?: boolean;
  outputRoot?: string | null;
  statuses?: LinkedWorkspaceStatus[];
}) {
  const dataRoot = await makeRoot("data");
  const reportError = vi.fn();
  const chapters = options.chapters ?? (() => [makeFourPageChapter()]);
  const statuses = options.statuses ?? [];
  const exporter = createTranslationJsonExporter({
    dataRoot,
    isEnabled: async () => options.enabled ?? true,
    resolveOutputRoot: async () => options.outputRoot ?? null,
    getStatus: (chapterId) =>
      statuses.find((entry) => entry.chapterId === chapterId) ?? {
        chapterId,
        state: "unlinked",
        pendingCount: 0,
        failedCount: 0,
      },
    listStatuses: () => statuses,
    openChapter: async (chapterId) => {
      const chapter = chapters().find((entry) => entry.id === chapterId);
      if (!chapter) throw new Error("missing chapter");
      return structuredClone(chapter);
    },
    resolveContext: async (chapter) =>
      resolveTranslationJsonContext(chapter, makeLibrary("rtl"), "rtl"),
    reportError,
  });
  return { dataRoot, exporter, reportError };
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Minimal RFC 4180 reader (quoted cells, "" escapes, CRLF records). */
function parseCsv(text: string): string[][] {
  expect(text.startsWith("﻿")).toBe(true);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else cell += char;
  }
  expect(quoted).toBe(false);
  expect(row).toEqual([]);
  return rows;
}

function csvRowsOf(document: ReturnType<typeof buildTranslationJson>) {
  return [
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
}

describe("serializeTranslationCsv", () => {
  it("writes one escaped row per block in the JSON order", () => {
    const document = {
      schemaVersion: 2 as const,
      workName: "미정 작품",
      inputName: INPUT_NAME,
      pages: [
        {
          page: 1,
          blocks: [
            { block: 1, sourceText: "原文", translatedText: "번역문" },
            {
              block: 2,
              sourceText: 'ライス, "HERO"',
              translatedText: '두 줄짜리\r\n"번역문", 끝\n세 번째 줄',
            },
          ],
        },
        {
          page: 2,
          blocks: [{ block: 1, sourceText: "END", translatedText: "" }],
        },
      ],
    };

    const csv = serializeTranslationCsv(document);

    expect(csv).toBe(
      "﻿page,block,sourceText,translatedText\r\n" +
        "1,1,原文,번역문\r\n" +
        '1,2,"ライス, ""HERO""","두 줄짜리\r\n""번역문"", 끝\n세 번째 줄"\r\n' +
        "2,1,END,\r\n",
    );
    expect(parseCsv(csv)).toEqual(csvRowsOf(document));
  });

  it("round-trips a chapter projection without changing its text", () => {
    const document = buildTranslationJson({
      chapter: makeFourPageChapter(),
      readingDirection: "rtl",
      workName: "미정 작품",
    });
    expect(parseCsv(serializeTranslationCsv(document))).toEqual(
      csvRowsOf(document),
    );
  });
});

describe("buildTranslationJson", () => {
  it("numbers pages by pageOrder and blocks by the editor's reading order", () => {
    const document = buildTranslationJson({
      chapter: makeFourPageChapter(),
      readingDirection: "rtl",
      workName: "미정 작품",
    });

    expect(document.schemaVersion).toBe(2);
    expect(document.workName).toBe("미정 작품");
    expect(document.inputName).toBe(INPUT_NAME);
    expect(document.pages.map((page) => page.page)).toEqual([1, 2, 3, 4]);
    expect(document.pages[1]).toEqual({
      page: 2,
      blocks: [
        {
          block: 1,
          sourceText: "原文 p2-lower",
          translatedText: "번역 p2-lower",
        },
        {
          block: 2,
          sourceText: "原文 p2-right",
          translatedText: "번역 p2-right",
        },
        {
          block: 3,
          sourceText: "原文 p2-left",
          translatedText: "번역 p2-left",
        },
      ],
    });
    const ltr = buildTranslationJson({
      chapter: makeFourPageChapter(),
      readingDirection: "ltr",
      workName: "",
    });
    expect(ltr.pages[0].blocks.map((entry) => entry.sourceText)).toEqual([
      "原文 p1-lower",
      "原文 p1-left",
      "原文 p1-right",
    ]);
  });

  it("appends pages missing from pageOrder after the ordered pages", () => {
    const chapter = makeFourPageChapter();
    chapter.pageOrder = ["page-deleted", "page-p2"];
    const document = buildTranslationJson({
      chapter,
      readingDirection: "rtl",
      workName: "",
    });
    expect(document.pages[0].blocks[0].sourceText).toBe("原文 p2-lower");
    expect(document.pages).toHaveLength(4);
  });

  it("exports no internal ids, geometry, rendering or workflow state", () => {
    const document = buildTranslationJson({
      chapter: makeFourPageChapter(),
      readingDirection: "rtl",
      workName: "미정 작품",
    });
    expect(Object.keys(document)).toEqual([
      "schemaVersion",
      "workName",
      "inputName",
      "pages",
    ]);
    for (const page of document.pages) {
      expect(Object.keys(page)).toEqual(["page", "blocks"]);
      for (const entry of page.blocks)
        expect(Object.keys(entry)).toEqual([
          "block",
          "sourceText",
          "translatedText",
        ]);
    }
    const serialized = JSON.stringify(document);
    for (const excluded of [
      "pageId",
      "blockId",
      "workId",
      "chapterId",
      "page-p1",
      "bbox",
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

describe("resolveTranslationJsonContext", () => {
  it("uses the work title and the same reading direction as the editor", () => {
    const chapter = makeFourPageChapter();
    expect(
      resolveTranslationJsonContext(chapter, makeLibrary("ltr"), "rtl"),
    ).toEqual({ workName: "미정 작품", readingDirection: "ltr" });
    expect(
      resolveTranslationJsonContext(chapter, makeLibrary("auto"), "rtl")
        .readingDirection,
    ).toBe("rtl");
    expect(
      resolveTranslationJsonContext(
        { workId: "missing" },
        makeLibrary(),
        "ltr",
      ),
    ).toEqual({ workName: "", readingDirection: "ltr" });
  });
});

describe("resolveSettingsSourceReadingDirection", () => {
  it("infers the editor's default direction from the source language", () => {
    const settings = resolveDefaultAppSettings();
    settings.translation = { sourceLanguage: "ja", targetLanguage: "ko" };
    expect(resolveSettingsSourceReadingDirection(settings)).toBe("rtl");
    settings.translation = { sourceLanguage: "en", targetLanguage: "ko" };
    expect(resolveSettingsSourceReadingDirection(settings)).toBe("ltr");
  });
});

describe("createTranslationJsonExporter", () => {
  it("writes nothing when the option is off", async () => {
    const outputRoot = await makeRoot("output");
    const { dataRoot, exporter } = await makeExporter({
      enabled: false,
      outputRoot,
    });
    await exporter.sync("chapter-1");
    expect(await readdir(outputRoot)).toEqual([]);
    expect(await readdir(dataRoot)).toEqual([]);
  });

  it("writes only <Rover Output>/<inputName>/translation.json", async () => {
    const outputRoot = await makeRoot("output");
    const linkedRoot = await makeRoot("linked");
    const { dataRoot, exporter, reportError } = await makeExporter({
      outputRoot,
      statuses: [status("chapter-1", { rootPath: linkedRoot })],
    });
    await exporter.sync("chapter-1");

    expect(await readdir(outputRoot)).toEqual([INPUT_NAME]);
    expect((await readdir(join(outputRoot, INPUT_NAME))).sort()).toEqual([
      "translation.csv",
      "translation.json",
    ]);
    const document = buildTranslationJson({
      chapter: makeFourPageChapter(),
      readingDirection: "rtl",
      workName: "미정 작품",
    });
    expect(
      await readJson(join(outputRoot, INPUT_NAME, "translation.json")),
    ).toEqual(document);
    const csv = await readFile(
      join(outputRoot, INPUT_NAME, "translation.csv"),
      "utf8",
    );
    expect(parseCsv(csv)).toEqual(csvRowsOf(document));
    expect(await readdir(linkedRoot)).toEqual([]);
    expect(await readRoverExportFolders(dataRoot)).toEqual([
      { rootPath: outputRoot, chapterId: "chapter-1", folder: INPUT_NAME },
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("never writes into an existing folder or another chapter's folder", async () => {
    const outputRoot = await makeRoot("output");
    await mkdir(join(outputRoot, INPUT_NAME));
    await writeFile(join(outputRoot, INPUT_NAME, "translation.json"), "mine");
    const twin = { ...makeFourPageChapter(), id: "chapter-2" };
    const { exporter } = await makeExporter({
      outputRoot,
      chapters: () => [makeFourPageChapter(), twin],
    });
    await exporter.sync("chapter-1");
    await exporter.sync("chapter-2");
    await exporter.sync("chapter-1");

    expect(
      await readFile(join(outputRoot, INPUT_NAME, "translation.json"), "utf8"),
    ).toBe("mine");
    expect((await readdir(outputRoot)).sort()).toEqual(
      [INPUT_NAME, `${INPUT_NAME} (2)`, `${INPUT_NAME} (3)`].sort(),
    );
  });

  it("rewrites the latest text after an edit, even with overlapping syncs", async () => {
    const outputRoot = await makeRoot("output");
    let chapter = makeFourPageChapter();
    const { exporter } = await makeExporter({
      outputRoot,
      chapters: () => [chapter],
    });
    const first = exporter.sync("chapter-1");
    chapter = structuredClone(chapter);
    chapter.pages[1].blocks[2].translatedText = "수정된 번역";
    await Promise.all([first, exporter.sync("chapter-1")]);
    const saved = await readJson(
      join(outputRoot, INPUT_NAME, "translation.json"),
    );
    expect(saved.pages[0].blocks[0]).toEqual({
      block: 1,
      sourceText: "原文 p1-lower",
      translatedText: "수정된 번역",
    });
  });

  it("falls back to the chapter's linked destination without a Rover Output", async () => {
    const linkedRoot = await makeRoot("linked");
    const { exporter } = await makeExporter({
      outputRoot: null,
      statuses: [status("chapter-1", { rootPath: linkedRoot })],
    });
    await exporter.sync("chapter-1");
    expect((await readdir(linkedRoot)).sort()).toEqual([
      "translation.csv",
      "translation.json",
    ]);
  });

  it("reports once when no destination is available and writes nothing", async () => {
    const linkedRoot = await makeRoot("linked");
    for (const statuses of [
      [],
      [status("chapter-1", { rootPath: linkedRoot, state: "disabled" })],
      [status("chapter-1", { rootPath: join(linkedRoot, "removed") })],
      [
        status("chapter-1", { rootPath: linkedRoot }),
        status("chapter-2", { rootPath: linkedRoot }),
      ],
    ]) {
      const { exporter, reportError } = await makeExporter({
        outputRoot: null,
        statuses,
      });
      await exporter.sync("chapter-1");
      await exporter.sync("chapter-1");
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        "translation.json has no available destination",
        { chapterId: "chapter-1" },
      );
    }
    expect(await readdir(linkedRoot)).toEqual([]);
  });

  it("reports an unreadable Rover Output path instead of guessing a folder", async () => {
    const { exporter, reportError } = await makeExporter({
      outputRoot: join(await makeRoot("output"), "bad\0name"),
    });
    await exporter.sync("chapter-1");
    expect(reportError).toHaveBeenCalledWith(
      "Failed to write translation.json",
      expect.any(Error),
    );
  });

  it("reports failures without rejecting the save notification", async () => {
    const { exporter, reportError } = await makeExporter({
      outputRoot: await makeRoot("output"),
      chapters: () => {
        throw new Error("library read failed");
      },
    });
    await expect(exporter.sync("chapter-1")).resolves.toBeUndefined();
    expect(reportError).toHaveBeenCalledWith(
      "Failed to write translation.json",
      expect.any(Error),
    );
  });
});

describe("safeResultPathSegment", () => {
  it("keeps readable titles and makes unsafe or reserved names usable", () => {
    expect(safeResultPathSegment(` ${INPUT_NAME}. `, "화")).toBe(INPUT_NAME);
    expect(safeResultPathSegment('a<b>:"c/d\\e|f?g*', "화")).toBe(
      "a_b___c_d_e_f_g_",
    );
    expect(safeResultPathSegment("  ", "화")).toBe("화");
    expect(safeResultPathSegment("con", "화")).toBe("_con");
  });
});
