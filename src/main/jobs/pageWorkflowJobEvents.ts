import type { JobEvent } from "../../shared/jobTypes";
import type { PageWorkflowResult } from "../../shared/pageWorkflowTypes";
import {
  PAGE_WORKFLOW_STAGE_LABELS,
  type PageWorkflowStage,
} from "../../shared/pageWorkflowStages";

type WorkflowProgressCounts = {
  /** page×stage work units, used only for the progress bar */
  total: number;
  /** real number of selected pages, used by page-count UI */
  pageTotal: number;
};

export function workflowStageProgressEvent(
  id: string,
  stage: PageWorkflowStage,
  pageName: string,
  counts: WorkflowProgressCounts & { current: number },
): JobEvent {
  return {
    id,
    kind: "gemma-analysis",
    status: "running",
    phase: "model_requesting",
    progressText: `${PAGE_WORKFLOW_STAGE_LABELS[stage]} · ${pageName}`,
    progressCurrent: counts.current,
    progressTotal: counts.total,
    pageTotal: counts.pageTotal,
  };
}

export function workflowCompletionEvent(
  id: string,
  result: PageWorkflowResult,
  counts: WorkflowProgressCounts,
): JobEvent {
  return {
    id,
    kind: "gemma-analysis",
    status: result.status === "partial" ? "failed" : result.status,
    phase: "done",
    progressText: result.issues[0]?.message ?? "페이지 작업 완료",
    progressCurrent: counts.total,
    progressTotal: counts.total,
    pageTotal: counts.pageTotal,
  };
}
