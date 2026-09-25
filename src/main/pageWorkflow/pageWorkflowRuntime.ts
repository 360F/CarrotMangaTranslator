import { resolvePreviousChapterStoryPages } from "../previousChapterContext";
import type { ChapterSnapshot, MangaPage } from "../../shared/libraryTypes";
import type { PageWorkflowStage } from "../../shared/pageWorkflowStages";
import { buildBaseOptions, buildPageOptions } from "../pipeline/options";
import { detectWorkflowBlocks, readWorkflowSource } from "./pageWorkflowOcr";
import { translateWorkflowPage } from "./pageWorkflowTranslation";
import { createWorkflowTypography } from "./pageWorkflowTypography";
import { eraseWorkflowPage, layoutWorkflowPage } from "./pageWorkflowImages";
import { applyWorkflowRuleStage } from "./pageWorkflowRuleExecution";
import type { PageWorkflowRuntimeContext } from "./pageWorkflowRuntimeTypes";
import type { PageWorkflowContextCommit } from "../application/pageWorkflowContextCommit";
import { savePageWorkflowResult } from "../library";
import { measurePageProcessingStage } from "../pipeline/pageProcessingTiming";

export function createPageWorkflowRuntime(context: PageWorkflowRuntimeContext) {
  const typography = createWorkflowTypography(context);
  let pending: PageWorkflowContextCommit = {};
  let disposal: Promise<void> | undefined;
  context.dependencies.pageContext = {
    saveChapterStoryMemory: async (memory) => {
      pending.storyMemory = memory;
      return memory;
    },
    saveWorkStyleGuide: async (guide) => {
      pending.styleGuide = guide;
      return guide;
    },
  };
  return {
    restoreCompletedStage: async (
      stage: PageWorkflowStage,
      page: MangaPage,
    ) => {
      if (stage === "typography") await typography.apply(page);
    },
    save: async (chapterId: string, before: MangaPage, after: MangaPage) => {
      const commit =
        after.pageWorkflow?.steps.translate?.status === "completed"
          ? pending
          : {};
      await savePageWorkflowResult(chapterId, before, after, commit);
      pending = {};
    },
    prepareStage: async (
      stage: PageWorkflowStage,
      chapter: ChapterSnapshot,
      pageIds: string[],
    ) => {
      if (stage === "translate" && context.plan.cumulative)
        context.previousStoryPages =
          await resolvePreviousChapterStoryPages(chapter);
      if (stage === "typography") await typography.prepare(chapter, pageIds);
    },
    execute: async (
      stage: PageWorkflowStage,
      chapter: ChapterSnapshot,
      page: MangaPage,
    ): Promise<MangaPage> => {
      pending = {};
      if (stage === "detect" || stage === "ocr")
        return measureWorkflowStage(context, page.id, "ocr", () =>
          executeWorkflowRecognition(context, chapter, page, stage),
        );
      if (!page.blocks.length) return page;
      if (stage === "translate")
        return translateWorkflowPage(context, chapter, page);
      if (stage === "typography")
        return measureWorkflowStage(context, page.id, "typography", () =>
          typography.apply(page),
        );
      if (stage === "erase") return eraseWorkflowPage(context, page);
      if (stage === "layout")
        return measureWorkflowStage(context, page.id, "typography", () =>
          layoutWorkflowPage(context, page),
        );
      return applyWorkflowRuleStage(context, chapter, page, stage);
    },
    recordPageTiming: (
      chapter: ChapterSnapshot,
      page: MangaPage,
      totalMs: number,
      status: "completed" | "failed",
    ) => recordWorkflowPageTiming(context, chapter, page, totalMs, status),
    dispose: () =>
      (disposal ??= Promise.resolve().then(() =>
        context.dependencies.fontMatching.pageInference?.dispose?.(),
      )),
  };
}

function recordWorkflowPageTiming(
  context: PageWorkflowRuntimeContext,
  chapter: ChapterSnapshot,
  page: MangaPage,
  totalMs: number,
  status: "completed" | "failed",
): void {
  const stages = context.timing?.getStages(page.id) ?? {};
  context.dependencies.diagnostics.info("page-timing", {
    runId: context.runId,
    chapterId: chapter.id,
    pageId: page.id,
    pageIndex: chapter.pages.findIndex((entry) => entry.id === page.id),
    status,
    preparingMs: stages.preparing ?? 0,
    ocrMs: stages.ocr ?? 0,
    translationMs: stages.translation ?? 0,
    inpaintingMs: stages.inpainting ?? 0,
    typographyMs: stages.typography ?? 0,
    totalMs: Math.max(0, Math.round(totalMs)),
    ...resolveFluxTimingBackend(context),
  });
}

function resolveFluxTimingBackend(context: PageWorkflowRuntimeContext): {
  inpaintingBackend?: string;
} {
  if (
    !context.plan.stages.includes("erase") ||
    context.plan.erasureEngine === "codex" ||
    (context.settings.inpainting?.model ?? "flux-klein") !== "flux-klein"
  ) {
    return {};
  }
  return {
    inpaintingBackend:
      context.settings.inpainting?.fluxBackend ??
      (process.platform === "darwin" ? "metal-native" : "cuda-native"),
  };
}

function measureWorkflowStage<T>(
  context: PageWorkflowRuntimeContext,
  pageId: string,
  stage: "ocr" | "typography",
  run: () => Promise<T>,
): Promise<T> {
  return context.timing
    ? measurePageProcessingStage(context.timing, pageId, stage, run)
    : run();
}

async function executeWorkflowRecognition(
  context: PageWorkflowRuntimeContext,
  chapter: ChapterSnapshot,
  page: MangaPage,
  stage: "detect" | "ocr",
) {
  const paths = await context.runPaths(chapter.id);
  const base = buildBaseOptions(
    context.runId,
    paths.runDir,
    context.settings,
    context.paths,
  );
  const options = buildPageOptions(
    base,
    page,
    chapter.pages.findIndex((p) => p.id === page.id),
    1,
  );
  options.abortSignal = context.signal;
  return stage === "detect"
    ? detectWorkflowBlocks(page, options, context.plan)
    : readWorkflowSource(
        page,
        options,
        context.plan,
        context.dependencies.runtime,
      );
}
