import type { ChapterSnapshot, MangaPage } from "../../shared/libraryTypes";
import type { PageWorkflowIssue } from "../../shared/pageWorkflowTypes";
import {
  PAGE_WORKFLOW_STAGES,
  type PageWorkflowStage,
} from "../../shared/pageWorkflowStages";
import {
  completeWorkflowReceipt,
  failWorkflowReceipt,
  workflowReceipt,
  workflowStageComplete,
} from "./pageWorkflowReceipts";
import { PageWorkflowPartialFailure } from "./pageWorkflowPartialFailure";
import type {
  PageWorkflowExecution,
  PageWorkflowExecutionPort,
} from "./pageWorkflowService";

type ExecuteStage = (
  input: PageWorkflowExecution,
  port: PageWorkflowExecutionPort,
  chapterId: string,
  acquired: string[],
  stage: PageWorkflowStage,
  pageStartedAt: Map<string, number>,
  finalStage: boolean,
  previousIssues: PageWorkflowIssue[],
) => Promise<PageWorkflowIssue[]>;

type Args = Readonly<{
  input: PageWorkflowExecution;
  port: PageWorkflowExecutionPort;
  chapterId: string;
  acquired: string[];
  stages: PageWorkflowStage[];
  pageStartedAt: Map<string, number>;
  eligiblePageIds: (
    chapter: ChapterSnapshot,
    acquired: string[],
    issues: PageWorkflowIssue[],
    stage: PageWorkflowStage,
  ) => string[];
  executePages: (
    input: PageWorkflowExecution,
    port: PageWorkflowExecutionPort,
    chapter: ChapterSnapshot,
    pageIds: string[],
    stage: PageWorkflowStage,
    pageStartedAt: Map<string, number>,
    finalStage: boolean,
  ) => Promise<PageWorkflowIssue[]>;
  executeStage: ExecuteStage;
  resolvePageStart: (starts: Map<string, number>, pageId: string) => number;
  recordCompletedPageTiming: (
    port: PageWorkflowExecutionPort,
    chapter: ChapterSnapshot,
    page: MangaPage,
    startedAt: number,
    finalStage: boolean,
  ) => void;
  recordPageTiming: (
    port: PageWorkflowExecutionPort,
    chapter: ChapterSnapshot,
    page: MangaPage,
    startedAt: number,
    status: "failed",
  ) => void;
}>;

type DeferredEraseResult = Readonly<{
  before: MangaPage;
  after?: MangaPage;
  error?: unknown;
}>;

export async function executeExperimentalParallelChapter(
  args: Args,
): Promise<PageWorkflowIssue[]> {
  const issues: PageWorkflowIssue[] = [];
  const translateIndex = PAGE_WORKFLOW_STAGES.indexOf("translate");
  await executeStageGroup(
    args,
    issues,
    (stage) => PAGE_WORKFLOW_STAGES.indexOf(stage) < translateIndex,
  );
  await executeParallelLanes(args, issues);
  await executeStageGroup(
    args,
    issues,
    (stage) =>
      PAGE_WORKFLOW_STAGES.indexOf(stage) > translateIndex && stage !== "erase",
  );
  return issues;
}

async function executeStageGroup(
  args: Args,
  issues: PageWorkflowIssue[],
  includes: (stage: PageWorkflowStage) => boolean,
): Promise<void> {
  for (const stage of args.stages.filter(includes)) {
    issues.push(
      ...(await args.executeStage(
        args.input,
        args.port,
        args.chapterId,
        args.acquired,
        stage,
        args.pageStartedAt,
        stage === args.stages.at(-1),
        issues,
      )),
    );
  }
}

async function executeParallelLanes(
  args: Args,
  issues: PageWorkflowIssue[],
): Promise<void> {
  args.input.signal.throwIfAborted();
  const chapter = await args.port.readChapter(args.chapterId);
  const translationPageIds = args.eligiblePageIds(
    chapter,
    args.acquired,
    issues,
    "translate",
  );
  const erasePageIds = args.eligiblePageIds(
    chapter,
    args.acquired,
    issues,
    "erase",
  );
  await args.port.prepareStage("translate", chapter, translationPageIds);
  await args.port.prepareStage("erase", chapter, erasePageIds);
  const eraseTask = computeDeferredErasePages(args, chapter, erasePageIds);
  const translationTask = args.executePages(
    args.input,
    args.port,
    chapter,
    translationPageIds,
    "translate",
    args.pageStartedAt,
    false,
  );
  const [translation, deferredErase] = await Promise.allSettled([
    translationTask,
    eraseTask,
  ]);
  if (translation.status === "rejected") throw translation.reason;
  if (deferredErase.status === "rejected") throw deferredErase.reason;
  issues.push(...translation.value);
  args.input.signal.throwIfAborted();
  issues.push(
    ...(await commitDeferredErasePages(
      args,
      chapter,
      deferredErase.value,
      args.stages.at(-1) === "erase",
    )),
  );
}

async function computeDeferredErasePages(
  args: Args,
  chapter: ChapterSnapshot,
  pageIds: string[],
): Promise<DeferredEraseResult[]> {
  const results: DeferredEraseResult[] = [];
  for (const pageId of pageIds) {
    args.input.signal.throwIfAborted();
    const before = chapter.pages.find((page) => page.id === pageId);
    if (!before) continue;
    args.resolvePageStart(args.pageStartedAt, pageId);
    if (isEraseComplete(args.input, before)) {
      await args.port.restoreCompletedStage?.("erase", before);
      continue;
    }
    try {
      args.port.progress("erase", before);
      const after = await args.port.execute("erase", chapter, before);
      args.input.signal.throwIfAborted();
      results.push({ before, after });
    } catch (error) {
      if (args.input.signal.aborted || args.port.isFatal(error)) throw error;
      results.push({ before, error });
    }
  }
  return results;
}

function isEraseComplete(
  input: PageWorkflowExecution,
  page: MangaPage,
): boolean {
  return workflowStageComplete(
    workflowReceipt(input, page),
    page,
    "erase",
    input.configurationKeys?.erase,
  );
}

async function commitDeferredErasePages(
  args: Args,
  chapter: ChapterSnapshot,
  results: DeferredEraseResult[],
  finalStage: boolean,
): Promise<PageWorkflowIssue[]> {
  const issues: PageWorkflowIssue[] = [];
  for (const result of results) {
    args.input.signal.throwIfAborted();
    const currentChapter = await args.port.readChapter(chapter.id);
    const current = currentChapter.pages.find(
      (page) => page.id === result.before.id,
    );
    if (!current) throw new Error("The deferred erase page is missing.");
    const startedAt = args.resolvePageStart(args.pageStartedAt, current.id);
    const issue = result.error
      ? await commitEraseFailure(args, chapter, current, result, startedAt)
      : await commitEraseSuccess(
          args,
          chapter,
          current,
          result,
          startedAt,
          finalStage,
        );
    if (issue) issues.push(issue);
  }
  return issues;
}

async function commitEraseFailure(
  args: Args,
  chapter: ChapterSnapshot,
  current: MangaPage,
  result: DeferredEraseResult,
  startedAt: number,
): Promise<PageWorkflowIssue> {
  const message =
    result.error instanceof Error ? result.error.message : String(result.error);
  const partial =
    result.error instanceof PageWorkflowPartialFailure
      ? mergeEarlyEraseResult(current, result.error.page)
      : current;
  await args.port.save(
    chapter.id,
    current,
    failWorkflowReceipt(
      workflowReceipt(args.input, current),
      current,
      partial,
      "erase",
      message,
    ),
  );
  args.recordPageTiming(args.port, chapter, partial, startedAt, "failed");
  return { chapterId: chapter.id, pageId: current.id, stage: "erase", message };
}

async function commitEraseSuccess(
  args: Args,
  chapter: ChapterSnapshot,
  current: MangaPage,
  result: DeferredEraseResult,
  startedAt: number,
  finalStage: boolean,
): Promise<void> {
  const merged = mergeEarlyEraseResult(current, result.after ?? current);
  await args.port.save(
    chapter.id,
    current,
    completeWorkflowReceipt(
      workflowReceipt(args.input, current),
      current,
      merged,
      "erase",
      args.input.configurationKeys?.erase,
    ),
  );
  args.recordCompletedPageTiming(
    args.port,
    chapter,
    merged,
    startedAt,
    finalStage,
  );
}

function mergeEarlyEraseResult(
  current: MangaPage,
  erased: MangaPage,
): MangaPage {
  return {
    ...current,
    inpaintedImagePath: erased.inpaintedImagePath,
    inpaintMaskPath: erased.inpaintMaskPath,
    maskProvenance: erased.maskProvenance,
    erasedWorkflowRegions: erased.erasedWorkflowRegions,
  };
}
