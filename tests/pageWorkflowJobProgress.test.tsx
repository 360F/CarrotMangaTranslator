/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  workflowCompletionEvent,
  workflowStageProgressEvent,
} from "../src/main/jobs/pageWorkflowJobEvents";
import { JobEventSchema } from "../src/shared/ipcJobSchemas";
import { RunJobFeedback } from "../src/renderer/src/components/RunStatusFeedback";
import { resolveProgressSnapshot } from "../src/renderer/src/lib/jobProgress";

afterEach(cleanup);

// 42 selected pages × 7 workflow stages = 294 internal work units.
const counts = { total: 294, pageTotal: 42 };

describe("page workflow progress units", () => {
  it("keeps work-unit progress for the bar and the real page count apart", () => {
    const progress = JobEventSchema.parse(
      workflowStageProgressEvent("run", "ocr", "page_042.jpg", {
        ...counts,
        current: 81,
      }),
    );
    expect(progress).toMatchObject({
      progressCurrent: 81,
      progressTotal: 294,
      pageTotal: 42,
    });
    expect(resolveProgressSnapshot(progress)).toMatchObject({
      current: 81,
      total: 294,
    });
    const done = JobEventSchema.parse(
      workflowCompletionEvent(
        "run",
        { runId: "run", status: "partial", chapters: [], issues: [] },
        counts,
      ),
    );
    expect(done).toMatchObject({
      status: "failed",
      progressCurrent: 294,
      progressTotal: 294,
      pageTotal: 42,
    });
  });

  it("reports completed workflows by selected pages, not work units", () => {
    const done = JobEventSchema.parse(
      workflowCompletionEvent(
        "run",
        { runId: "run", status: "completed", chapters: [], issues: [] },
        counts,
      ),
    );
    render(
      <RunJobFeedback
        jobState={done}
        progressSnapshot={resolveProgressSnapshot(done)}
        showProgressBar
      />,
    );
    expect(screen.getByText(/42/)).toBeTruthy();
    expect(screen.queryByText(/294/)).toBeNull();
  });
});
