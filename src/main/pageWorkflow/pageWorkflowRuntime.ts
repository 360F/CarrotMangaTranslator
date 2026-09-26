import { resolvePreviousChapterStoryPages } from "../previousChapterContext";
import { performance } from "node:perf_hooks";
import type { ChapterSnapshot, MangaPage } from "../../shared/libraryTypes";
import type { PageWorkflowStage } from "../../shared/pageWorkflowStages";
import { buildBaseOptions, buildPageOptions } from "../pipeline/options";
import {
  applyWorkflowOcrResult,
  detectWorkflowBlocks,
  prepareWorkflowOcrInput,
  type PreparedWorkflowOcrInput,
} from "./pageWorkflowOcr";
import { translateWorkflowPage } from "./pageWorkflowTranslation";
import { createWorkflowTypography } from "./pageWorkflowTypography";
import { eraseWorkflowPage, layoutWorkflowPage } from "./pageWorkflowImages";
import { applyWorkflowRuleStage } from "./pageWorkflowRuleExecution";
import type { PageWorkflowRuntimeContext } from "./pageWorkflowRuntimeTypes";
import type { PageWorkflowContextCommit } from "../application/pageWorkflowContextCommit";
import { savePageWorkflowResult } from "../library";
import { measurePageProcessingStage } from "../pipeline/pageProcessingTiming";
import type { OcrBboxResult } from "../pipeline/types";
import {
  prepareSourceErasePage,
  type PreparedSourceErasePage,
} from "./sourceEraseScale";

export function createPageWorkflowRuntime(context: PageWorkflowRuntimeContext) {
  const typography = createWorkflowTypography(context);
  let pending: PageWorkflowContextCommit = {};
  let preparedOcr = new Map<string, PreparedWorkflowOcrPage>();
  let preparedSourceErase = new Map<string, PreparedSourceErasePage>();
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
    restoreCompletedStage: (stage: PageWorkflowStage, page: MangaPage) =>
      restoreCompletedStage(typography, stage, page),
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
      preparedOcr = await prepareWorkflowStage(
        context,
        typography,
        preparedOcr,
        stage,
        chapter,
        pageIds,
      );
      preparedSourceErase = await prepareSourceErasePages(
        context,
        preparedSourceErase,
        stage,
        chapter,
        pageIds,
      );
    },
    execute: (
      stage: PageWorkflowStage,
      chapter: ChapterSnapshot,
      page: MangaPage,
    ) => {
      if (shouldResetPending(context, stage)) pending = {};
      return executeWorkflowStage(
        context,
        typography,
        preparedOcr,
        stage,
        chapter,
        stage === "erase"
          ? (preparedSourceErase.get(page.id)?.page ?? page)
          : page,
      );
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

function shouldResetPending(
  context: PageWorkflowRuntimeContext,
  stage: PageWorkflowStage,
): boolean {
  return (
    !context.plan.experimentalParallelAcceleration || stage === "translate"
  );
}

async function restoreCompletedStage(
  typography: ReturnType<typeof createWorkflowTypography>,
  stage: PageWorkflowStage,
  page: MangaPage,
): Promise<void> {
  if (stage === "typography") await typography.apply(page);
}

async function prepareSourceErasePages(
  context: PageWorkflowRuntimeContext,
  current: Map<string, PreparedSourceErasePage>,
  stage: PageWorkflowStage,
  chapter: ChapterSnapshot,
  pageIds: string[],
): Promise<Map<string, PreparedSourceErasePage>> {
  if (stage !== "erase" || !context.plan.experimentalParallelAcceleration)
    return current;
  const prepared = new Map<string, PreparedSourceErasePage>();
  for (const pageId of pageIds) {
    context.signal.throwIfAborted();
    const page = chapter.pages.find((candidate) => candidate.id === pageId);
    if (page)
      prepared.set(pageId, await prepareSourceErasePage(page, context.signal));
  }
  return prepared;
}

async function executeWorkflowStage(
  context: PageWorkflowRuntimeContext,
  typography: ReturnType<typeof createWorkflowTypography>,
  preparedOcr: Map<string, PreparedWorkflowOcrPage>,
  stage: PageWorkflowStage,
  chapter: ChapterSnapshot,
  page: MangaPage,
): Promise<MangaPage> {
  if (stage === "detect")
    return measureWorkflowStage(context, page.id, "ocr", () =>
      executeWorkflowDetection(context, chapter, page),
    );
  if (stage === "ocr") {
    if (preparedOcr.has(page.id)) {
      const entry = preparedOcr.get(page.id);
      return entry
        ? applyWorkflowOcrResult(page, entry.prepared, entry.result)
        : page;
    }
    throw new Error("HayaiOCR batch result was not prepared for this page.");
  }
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
}
async function prepareWorkflowStage(
  context: PageWorkflowRuntimeContext,
  typography: ReturnType<typeof createWorkflowTypography>,
  preparedOcr: Map<string, PreparedWorkflowOcrPage>,
  stage: PageWorkflowStage,
  chapter: ChapterSnapshot,
  pageIds: string[],
): Promise<Map<string, PreparedWorkflowOcrPage>> {
  if (stage === "ocr")
    return prepareWorkflowOcrBatch(context, chapter, pageIds);
  if (stage === "translate" && context.plan.cumulative)
    context.previousStoryPages =
      await resolvePreviousChapterStoryPages(chapter);
  if (stage === "typography") await typography.prepare(chapter, pageIds);
  return preparedOcr;
}
type PreparedWorkflowOcrPage = {
  prepared: PreparedWorkflowOcrInput;
  result: OcrBboxResult;
} | null;

async function prepareWorkflowOcrBatch(
  context: PageWorkflowRuntimeContext,
  chapter: ChapterSnapshot,
  pageIds: string[],
): Promise<Map<string, PreparedWorkflowOcrPage>> {
  const entries = new Map<string, PreparedWorkflowOcrPage>();
  if (!pageIds.length) return entries;
  const paths = await context.runPaths(chapter.id);
  const base = buildBaseOptions(
    context.runId,
    paths.runDir,
    context.settings,
    context.paths,
  );
  const prepared: PreparedWorkflowOcrInput[] = [];
  for (const pageId of pageIds) {
    context.signal.throwIfAborted();
    const pageIndex = chapter.pages.findIndex((page) => page.id === pageId);
    if (pageIndex < 0) throw new Error("The OCR target page is missing.");
    const page = chapter.pages[pageIndex];
    const options = buildPageOptions(base, page, pageIndex, 1);
    options.abortSignal = context.signal;
    const input = await prepareWorkflowOcrInput(page, options, context.plan);
    entries.set(pageId, null);
    if (input) prepared.push(input);
  }
  if (!prepared.length) return entries;
  const collect = context.dependencies.runtime.collectPreparedHayaiHintsBatch;
  if (!collect)
    throw new Error("HayaiOCR fixed-region batch recognition is unavailable.");
  const startedAt = performance.now();
  let results: OcrBboxResult[];
  try {
    results = await collect(prepared.map((entry) => entry.options));
  } finally {
    const elapsedPerPage = (performance.now() - startedAt) / prepared.length;
    for (const entry of prepared)
      context.timing?.add(entry.pageId, "ocr", elapsedPerPage);
    await context.timing?.checkpoint();
  }
  if (results.length !== prepared.length)
    throw new Error("HayaiOCR batch returned an unexpected result count.");
  prepared.forEach((entry, index) => {
    const result = results[index];
    if (!result) throw new Error("HayaiOCR batch omitted a page result.");
    entries.set(entry.pageId, { prepared: entry, result });
  });
  return entries;
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

async function executeWorkflowDetection(
  context: PageWorkflowRuntimeContext,
  chapter: ChapterSnapshot,
  page: MangaPage,
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
    chapter.pages.findIndex((candidate) => candidate.id === page.id),
    1,
  );
  options.abortSignal = context.signal;
  return detectWorkflowBlocks(page, options, context.plan);
}
