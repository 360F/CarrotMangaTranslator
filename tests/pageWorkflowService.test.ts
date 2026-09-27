import { describe, expect, it, vi } from "vitest";
import {
  executePageWorkflow,
  type PageWorkflowExecutionPort,
} from "../src/main/application/pageWorkflowService";
import { PageWorkflowPartialFailure } from "../src/main/application/pageWorkflowPartialFailure";
import { createPageWorkflowPlan } from "../src/shared/pageWorkflowTypes";
import { type PageWorkflowStage } from "../src/shared/pageWorkflowStages";
import {
  preflightPageWorkflow,
  workflowStageKey,
  workflowTargetBlocks,
  workflowRegionKey,
} from "../src/shared/pageWorkflowPolicy";
import { resolveBlockDisplayText } from "../src/shared/blockDisplayText";
import { makePage, makeChapter } from "./helpers/workspacePointerFixtures";
import type { MangaPage } from "../src/shared/libraryTypes";
import { withTranslationResourceHint } from "../src/main/pageWorkflow/pageWorkflowResourceHints";
import { resolveDefaultAppSettings } from "../src/main/appSettings";

function harness(
  stages: PageWorkflowStage[],
  execute?: PageWorkflowExecutionPort["execute"],
) {
  let chapter = makeChapter(makePage());
  const abort = new AbortController();
  const port: PageWorkflowExecutionPort = {
    readChapter: async () => structuredClone(chapter),
    acquirePage: vi.fn(async (_chapter, id) =>
      structuredClone(
        chapter.pages.find((p) => p.id === id) ?? chapter.pages[0],
      ),
    ),
    releasePage: vi.fn(),
    prepareStage: vi.fn(async () => {}),
    progress: vi.fn(),
    recordPageTiming: vi.fn(),
    isFatal: (error) => error instanceof TypeError,
    execute: vi.fn(execute ?? (async (_stage, _chapter, page) => page)),
    save: vi.fn(async (_chapter, before, after) => {
      expect(chapter.pages.find((p) => p.id === before.id)).toEqual(before);
      chapter = {
        ...chapter,
        pages: chapter.pages.map((p) =>
          p.id === before.id ? structuredClone(after) : p,
        ),
      };
    }),
  };
  const input = {
    runId: "run-1",
    plan: { ...createPageWorkflowPlan(["ocr"]), stages },
    selection: [{ chapterId: chapter.id, pageIds: [chapter.pages[0].id] }],
    signal: abort.signal,
  };
  return {
    port,
    input,
    abort,
    page: () => chapter.pages[0],
    addPage: (page: MangaPage) => {
      chapter.pages.push(page);
      input.selection[0].pageIds.push(page.id);
    },
    edit: (patch: Partial<MangaPage>) => {
      chapter.pages[0] = { ...chapter.pages[0], ...patch };
    },
  };
}

describe("Hayai page workflow commits", () => {
  it("overlaps experimental erase compute with serial translation and rebases its commit", async () => {
    let releaseTranslation!: () => void;
    const translationGate = new Promise<void>((resolve) => {
      releaseTranslation = resolve;
    });
    let eraseStarted!: () => void;
    const eraseStart = new Promise<void>((resolve) => {
      eraseStarted = resolve;
    });
    const h = harness(["translate", "erase"], async (stage, _chapter, page) => {
      if (stage === "erase") {
        eraseStarted();
        await translationGate;
        return { ...page, inpaintedImagePath: "early-clean.png" };
      }
      await eraseStart;
      releaseTranslation();
      return {
        ...page,
        blocks: page.blocks.map((block) => ({
          ...block,
          translatedText: "serial translation",
        })),
      };
    });
    h.input.plan = {
      ...createPageWorkflowPlan(["translate", "erase"]),
      experimentalParallelAcceleration: true,
    };

    const result = await executePageWorkflow(h.input, h.port);

    expect(result.status).toBe("completed");
    expect(h.page().blocks[0].translatedText).toBe("serial translation");
    expect(h.page().inpaintedImagePath).toBe("early-clean.png");
    expect(h.page().pageWorkflow?.steps.translate?.status).toBe("completed");
    expect(h.page().pageWorkflow?.steps.erase?.status).toBe("completed");
  });
  it("does not commit either lane after experimental cancellation", async () => {
    const h = harness(["translate", "erase"], async (stage, _chapter, page) => {
      if (stage === "erase") h.abort.abort();
      return stage === "erase"
        ? { ...page, inpaintedImagePath: "discarded.png" }
        : {
            ...page,
            blocks: page.blocks.map((block) => ({
              ...block,
              translatedText: "discarded translation",
            })),
          };
    });
    h.input.plan = {
      ...createPageWorkflowPlan(["translate", "erase"]),
      experimentalParallelAcceleration: true,
    };

    expect((await executePageWorkflow(h.input, h.port)).status).toBe(
      "cancelled",
    );
    expect(h.port.save).not.toHaveBeenCalled();
    expect(h.page().inpaintedImagePath).toBeUndefined();
  });
  it("records page wall-clock timing only after the final stage save", async () => {
    const h = harness(["ocr", "translate"]);
    const calls: string[] = [];
    h.port.save = vi.fn(async (_chapter, before, after) => {
      calls.push(
        `save:${after.pageWorkflow?.steps.translate ? "translate" : "ocr"}`,
      );
    });
    h.port.recordPageTiming = vi.fn((_chapter, page, totalMs, status) => {
      calls.push(`timing:${status}`);
      expect(page.id).toBe(h.page().id);
      expect(totalMs).toBeGreaterThanOrEqual(0);
    });

    await executePageWorkflow(h.input, h.port);

    expect(calls).toEqual(["save:ocr", "save:translate", "timing:completed"]);
    expect(h.port.recordPageTiming).toHaveBeenCalledTimes(1);
  });

  it("keeps processing other pages after a page-local failure", async () => {
    const h = harness(
      ["translate", "review"],
      async (stage, _chapter, page) => {
        if (stage === "translate" && page.id !== "second")
          throw new Error("Invalid page response");
        return page;
      },
    );
    h.addPage({ ...makePage(), id: "second" });
    const result = await executePageWorkflow(h.input, h.port);
    expect(result.status).toBe("partial");
    expect(
      vi
        .mocked(h.port.execute)
        .mock.calls.map(([stage, , page]) => [stage, page.id]),
    ).toEqual([
      ["translate", h.page().id],
      ["translate", "second"],
      ["review", "second"],
    ]);
    expect(h.port.releasePage).toHaveBeenCalledTimes(2);
  });
  it.each([
    { label: "serial", parallel: false },
    { label: "experimental parallel", parallel: true },
  ])(
    "keeps an OCR CHECK page terminally failed in a $label multi-page run",
    async ({ parallel }) => {
      const check = "OCR CHECK: 1개 블록의 원문 인식이 실패했습니다";
      const h = harness(
        ["ocr", "translate", "erase", "review"],
        async (stage, _chapter, page) => {
          if (stage === "ocr" && page.id !== "second")
            throw new PageWorkflowPartialFailure(check, {
              ...page,
              blocks: page.blocks.map((block) => ({
                ...block,
                sourceText: "",
              })),
            });
          if (stage === "erase")
            return { ...page, inpaintedImagePath: "clean.png" };
          return page;
        },
      );
      h.addPage({ ...makePage(), id: "second" });
      h.input.plan = {
        ...createPageWorkflowPlan(["ocr", "translate", "erase", "review"]),
        experimentalParallelAcceleration: parallel,
      };

      const result = await executePageWorkflow(h.input, h.port);

      expect(result.status).toBe("partial");
      expect(result.issues).toEqual([
        expect.objectContaining({ pageId: h.page().id, stage: "ocr" }),
      ]);
      const calls = vi
        .mocked(h.port.execute)
        .mock.calls.map(([stage, , page]) => `${stage}:${page.id}`);
      expect(calls).not.toContain(`translate:${h.page().id}`);
      expect(calls).toContain("translate:second");
      expect(calls).toContain("review:second");
      // Erasure is independent of OCR, yet the page stays failed at the end.
      expect(h.page().inpaintedImagePath).toBe("clean.png");
      expect(h.page()).toMatchObject({
        analysisStatus: "failed",
        lastError: check,
      });
      expect(h.page().pageWorkflow?.steps.ocr?.status).toBe("failed");
      const second = (await h.port.readChapter("")).pages[1];
      expect(second.analysisStatus).not.toBe("failed");
    },
  );
  it("marks a single-page OCR CHECK failure the same way", async () => {
    const h = harness(["ocr", "translate"], async (stage, _chapter, page) => {
      if (stage === "ocr")
        throw new PageWorkflowPartialFailure("OCR CHECK: 실패", page);
      return page;
    });
    const result = await executePageWorkflow(h.input, h.port);
    expect(result.status).toBe("partial");
    expect(h.page()).toMatchObject({
      analysisStatus: "failed",
      lastError: "OCR CHECK: 실패",
    });
    expect(
      vi.mocked(h.port.execute).mock.calls.map(([stage]) => stage),
    ).toEqual(["ocr"]);
  });
  it("continues independent erasure when translation fails and skips dependent text stages", async () => {
    const h = harness(
      ["translate", "typography", "erase", "layout"],
      async (stage, _chapter, page) => {
        if (stage === "translate") throw new Error("Invalid page response");
        return { ...page, inpaintedImagePath: "clean.png" };
      },
    );
    expect((await executePageWorkflow(h.input, h.port)).status).toBe("partial");
    expect(
      vi.mocked(h.port.execute).mock.calls.map(([stage]) => stage),
    ).toEqual(["translate", "erase"]);
    expect(h.page().inpaintedImagePath).toBe("clean.png");
  });

  it("preserves confirmed no-text detection across a new run", async () => {
    const h = harness(["detect"], async (_stage, _chapter, page) => ({
      ...page,
      blocks: [],
    }));
    await executePageWorkflow(h.input, h.port);
    const next = {
      ...h.input,
      runId: "run-2",
      plan: createPageWorkflowPlan(["ocr", "review"]),
    };
    await executePageWorkflow(next, h.port);
    const request = {
      plan: createPageWorkflowPlan(["translate"]),
      selection: h.input.selection,
    };
    const result = preflightPageWorkflow(request, [makeChapter(h.page())]);
    expect(result.issues).toEqual([]);
    expect(result.counts[0].empty).toBe(1);
    expect(
      preflightPageWorkflow(
        {
          ...request,
          plan: {
            ...createPageWorkflowPlan(["detect", "translate"]),
            overwrite: ["detect"],
          },
        },
        [makeChapter(h.page())],
      ).issues,
    ).not.toEqual([]);
    h.edit({ imagePath: "different-original.png" });
    expect(
      preflightPageWorkflow(request, [makeChapter(h.page())]).issues,
    ).not.toEqual([]);
  });
  it("rechecks only the stage whose configuration changed", async () => {
    const h = harness(["ocr", "translate", "erase"]);
    const first = {
      ...h.input,
      configurationKeys: {
        ocr: "ocr-1",
        translate: "model-1",
        erase: "erase-1",
      },
    };
    await executePageWorkflow(first, h.port);
    vi.mocked(h.port.execute).mockClear();
    await executePageWorkflow(
      {
        ...first,
        configurationKeys: { ...first.configurationKeys, translate: "model-2" },
      },
      h.port,
    );
    expect(
      vi.mocked(h.port.execute).mock.calls.map(([stage]) => stage),
    ).toEqual(["translate"]);
  });
  it("excludes completed receipt pages from stage preparation", async () => {
    const h = harness(["ocr"]);
    await executePageWorkflow(h.input, h.port);
    vi.mocked(h.port.prepareStage).mockClear();

    await executePageWorkflow(h.input, h.port);

    expect(h.port.prepareStage).toHaveBeenCalledWith(
      "ocr",
      expect.anything(),
      [],
    );
    expect(h.port.execute).toHaveBeenCalledTimes(1);
  });

  it("does not execute or save pages when stage preparation fails", async () => {
    const h = harness(["ocr"]);
    vi.mocked(h.port.prepareStage).mockRejectedValue(
      new Error("batch OCR failed"),
    );

    const result = await executePageWorkflow(h.input, h.port);

    expect(result.status).toBe("failed");
    expect(result.issues).toEqual([
      { chapterId: "", message: "batch OCR failed" },
    ]);
    expect(h.port.execute).not.toHaveBeenCalled();
    expect(h.port.save).not.toHaveBeenCalled();
  });
  it("executes fixed order and does not repeat edits after downstream changes and restart", async () => {
    const h = harness(
      ["format-rules", "ocr", "translate"],
      async (stage, _chapter, page) => ({
        ...page,
        blocks: page.blocks.map((b) =>
          stage === "format-rules"
            ? { ...b, fontSizePx: b.fontSizePx + 2 }
            : stage === "translate"
              ? { ...b, translatedText: "new" }
              : { ...b, sourceText: "corrected" },
        ),
      }),
    );
    const size = h.page().blocks[0].fontSizePx;
    expect((await executePageWorkflow(h.input, h.port)).status).toBe(
      "completed",
    );
    expect(
      vi.mocked(h.port.execute).mock.calls.map(([stage]) => stage),
    ).toEqual(["ocr", "translate", "format-rules"]);
    expect(h.page().blocks[0].fontSizePx).toBe(size + 2);
    await executePageWorkflow(
      { ...h.input, signal: new AbortController().signal },
      h.port,
    );
    expect(h.port.execute).toHaveBeenCalledTimes(3);
    expect(h.page().blocks[0].fontSizePx).toBe(size + 2);
  });
  it("a new run deliberately applies selected rules again", async () => {
    const h = harness(["format-rules"], async (_stage, _chapter, p) => ({
      ...p,
      blocks: p.blocks.map((b) => ({ ...b, fontSizePx: b.fontSizePx + 2 })),
    }));
    await executePageWorkflow(h.input, h.port);
    await executePageWorkflow({ ...h.input, runId: "run-2" }, h.port);
    expect(h.port.execute).toHaveBeenCalledTimes(2);
  });
  it("cancel before a commit preserves the last saved stage", async () => {
    const h = harness(["ocr", "translate"], async (stage, _chapter, p) => {
      if (stage === "translate") h.abort.abort();
      return {
        ...p,
        blocks: p.blocks.map((b) => ({ ...b, sourceText: stage })),
      };
    });
    const result = await executePageWorkflow(h.input, h.port);
    expect(result.status).toBe("cancelled");
    expect(h.page().blocks[0].sourceText).toBe("ocr");
    expect(h.page().pageWorkflow?.steps.translate).toBeUndefined();
    expect(h.port.releasePage).toHaveBeenCalledTimes(1);
  });
  it("stores partial erasure and retries only the failed stage", async () => {
    let failed = true;
    const h = harness(
      ["ocr", "erase", "review"],
      async (stage, _chapter, p) => {
        if (stage === "erase" && failed) {
          failed = false;
          throw new PageWorkflowPartialFailure("one region failed", {
            ...p,
            inpaintedImagePath: "partial.png",
          });
        }
        return p;
      },
    );
    expect((await executePageWorkflow(h.input, h.port)).status).toBe("partial");
    expect(h.page().inpaintedImagePath).toBe("partial.png");
    expect(h.page().pageWorkflow?.steps.review?.status).toBe("completed");
    await executePageWorkflow(h.input, h.port);
    expect(vi.mocked(h.port.execute).mock.calls.map(([s]) => s)).toEqual([
      "ocr",
      "erase",
      "review",
      "erase",
    ]);
  });
  it("does not save partial translations after cancellation", async () => {
    const h = harness(["translate"], async (_stage, _chapter, page) => {
      h.abort.abort();
      throw new PageWorkflowPartialFailure("missing", {
        ...page,
        blocks: page.blocks.map((block) => ({
          ...block,
          translatedText: "new",
        })),
      });
    });
    const before = structuredClone(h.page());
    expect((await executePageWorkflow(h.input, h.port)).status).toBe(
      "cancelled",
    );
    expect(h.port.save).not.toHaveBeenCalled();
    expect(h.page()).toEqual(before);
  });

  it("does not retry a failed transaction as a stale failure write", async () => {
    const h = harness(["ocr"]);
    h.port.save = vi.fn(async () => {
      throw new Error("revision conflict");
    });
    expect((await executePageWorkflow(h.input, h.port)).status).toBe("failed");
    expect(h.port.save).toHaveBeenCalledTimes(1);
    expect(h.page().pageWorkflow).toBeUndefined();
  });
  it("a translation edit leaves committed erasure valid", async () => {
    const h = harness(["erase"]);
    await executePageWorkflow(h.input, h.port);
    h.edit({
      blocks: h
        .page()
        .blocks.map((b) => ({ ...b, translatedText: "manual correction" })),
    });
    await executePageWorkflow(h.input, h.port);
    expect(h.port.execute).toHaveBeenCalledTimes(1);
  });
});

describe("page workflow input and preservation", () => {
  it("takes the experimental opt-in from the active translation API settings", () => {
    const settings = resolveDefaultAppSettings();
    settings.modelProvider = "openai-api";
    settings.api.experimentalParallelAcceleration = true;
    const request = {
      plan: createPageWorkflowPlan(["translate", "erase"]),
      selection: [{ chapterId: "chapter-1", pageIds: ["page-1"] }],
    };

    expect(
      withTranslationResourceHint(request, settings).plan
        .experimentalParallelAcceleration,
    ).toBe(true);
    settings.modelProvider = "gemma";
    expect(
      withTranslationResourceHint(
        {
          ...request,
          plan: { ...request.plan, experimentalParallelAcceleration: true },
        },
        settings,
      ).plan.experimentalParallelAcceleration,
    ).toBe(false);
  });
  it("runs an ineligible plan serially while the parallel setting stays on", async () => {
    const settings = resolveDefaultAppSettings();
    settings.modelProvider = "openai-api";
    settings.api.experimentalParallelAcceleration = true;
    const eligible = withTranslationResourceHint(
      {
        plan: createPageWorkflowPlan(["detect", "ocr", "translate", "erase"]),
        selection: [{ chapterId: "chapter-1", pageIds: ["page-1"] }],
      },
      settings,
    );
    expect(eligible.plan.experimentalParallelAcceleration).toBe(true);
    const ineligiblePlans = [
      createPageWorkflowPlan(["detect", "ocr", "translate"]),
      {
        ...createPageWorkflowPlan(["translate", "erase"]),
        stages: ["translate", "format-rules", "erase"] as PageWorkflowStage[],
        rules: { "format-rules": { kind: "scheme" as const, id: "format" } },
      },
    ];
    for (const plan of ineligiblePlans) {
      const resolved = withTranslationResourceHint(
        {
          plan,
          selection: [{ chapterId: "chapter-1", pageIds: ["page-1"] }],
        },
        settings,
      );
      expect(resolved.plan.experimentalParallelAcceleration).toBe(false);
    }
    expect(settings.api.experimentalParallelAcceleration).toBe(true);

    const stages: PageWorkflowStage[] = ["detect", "ocr", "translate"];
    const h = harness(stages, async (stage, _chapter, page) =>
      stage === "translate"
        ? {
            ...page,
            blocks: page.blocks.map((block) => ({
              ...block,
              translatedText: "serial translation",
            })),
          }
        : page,
    );
    h.input.plan = withTranslationResourceHint(
      { plan: { ...createPageWorkflowPlan(stages), stages }, selection: [] },
      settings,
    ).plan;
    const page = h.page();
    const chapter = makeChapter(page);
    expect(
      preflightPageWorkflow(
        {
          plan: h.input.plan,
          selection: [{ chapterId: chapter.id, pageIds: [page.id] }],
        },
        [chapter],
      ).issues,
    ).toEqual([]);

    const result = await executePageWorkflow(h.input, h.port);

    expect(result.status).toBe("completed");
    expect(h.page().blocks[0].translatedText).toBe("serial translation");
    expect(
      vi.mocked(h.port.execute).mock.calls.map(([stage]) => stage),
    ).toEqual(["detect", "ocr", "translate"]);
  });
  it("rejects experimental overlap when format rules can affect erase", () => {
    const page = makePage();
    const chapter = makeChapter(page);
    const plan = {
      ...createPageWorkflowPlan(["translate", "erase"]),
      stages: ["translate", "format-rules", "erase"] as PageWorkflowStage[],
      experimentalParallelAcceleration: true,
      rules: { "format-rules": { kind: "scheme" as const, id: "format" } },
    };
    const result = preflightPageWorkflow(
      {
        plan,
        selection: [{ chapterId: chapter.id, pageIds: [page.id] }],
      },
      [chapter],
    );
    expect(result.issues).toContainEqual({
      chapterId: "",
      message: "서식 규칙이 선택된 작업에서는 병렬 가속을 사용할 수 없습니다.",
    });
  });
  it("blocks translation without source but allows detection plus erasure", () => {
    const page = { ...makePage(), blocks: [] };
    const chapter = makeChapter(page);
    const selection = [{ chapterId: chapter.id, pageIds: [page.id] }];
    expect(
      preflightPageWorkflow(
        { plan: createPageWorkflowPlan(["detect", "erase"]), selection },
        [chapter],
      ).issues,
    ).toEqual([]);
    expect(
      preflightPageWorkflow(
        { plan: createPageWorkflowPlan(["detect", "translate"]), selection },
        [chapter],
      ).issues.length,
    ).toBeGreaterThan(0);
  });
  it("fills only empty fields and skips erased geometry", () => {
    const page = makePage();
    page.inpaintedImagePath = "cleaned.png";
    page.erasedWorkflowRegions = {
      [page.blocks[0].id]: workflowRegionKey(page, page.blocks[0]),
    };
    const plan = createPageWorkflowPlan(["ocr", "translate", "erase"]);
    expect(workflowTargetBlocks(page, "ocr", plan)).toEqual([]);
    expect(workflowTargetBlocks(page, "translate", plan)).toEqual([]);
    expect(workflowTargetBlocks(page, "erase", plan)).toEqual([]);
    expect(
      workflowTargetBlocks(page, "ocr", { ...plan, overwrite: ["ocr"] }),
    ).toHaveLength(1);
  });
  it("prepared blank blocks suppress fallback text; legacy blocks still display source", () => {
    const block = makePage({ blockPatch: { translatedText: "" } }).blocks[0];
    expect(resolveBlockDisplayText(block)).toBe("source");
    expect(
      resolveBlockDisplayText({
        ...block,
        textDisplayMode: "translation-only",
      }),
    ).toBe("");
    expect(
      resolveBlockDisplayText({
        ...block,
        textDisplayMode: "translation-only",
        translatedText: "done",
      }),
    ).toBe("done");
  });
  it("erasure signatures consume geometry and exclusion but not translated text", () => {
    const page = makePage();
    const key = workflowStageKey(page, "erase");
    page.blocks[0].translatedText = "new";
    expect(workflowStageKey(page, "erase")).toBe(key);
    page.blocks[0].inpaintExcluded = true;
    expect(workflowStageKey(page, "erase")).not.toBe(key);
  });
});
