import { afterEach, describe, expect, it, vi } from "vitest";
import {
  joinCropOcrTexts,
  readKeepBlockCropText,
  withFailedKeepBlockReads,
} from "../src/main/pipeline/keepBlocksOcr";
import {
  basePipelineOptions,
  cleanupPipelineTempDirs,
  loadPipeline,
  makePage,
} from "./helpers/wholePagePipelineHarness";
import { successTranslationResult } from "./helpers/wholePageTranslationResults";

afterEach(cleanupPipelineTempDirs);

const hint = (ocrText: string, x1: number, ocrHealth?: object) => ({
  id: x1 / 50 + 1,
  label: "text",
  ocrText,
  x1,
  y1: 0,
  x2: x1 + 20,
  y2: 100,
  ...(ocrHealth ? { ocrHealth } : {}),
});

describe("Hayai OCR failure outside the page workflow", () => {
  it("fails only that page before any translation request", async () => {
    const failed = makePage("page-failed", "019.png");
    const healthy = makePage("page-healthy", "020.png");
    const requestTranslation = vi
      .fn()
      .mockResolvedValue(successTranslationResult());
    const pipeline = await loadPipeline({
      requestTranslation,
      ocrHintsByImagePath: new Map([
        [
          failed.imagePath,
          {
            hints: [
              hint("本文", 0),
              hint("ペラ".repeat(64), 50, {
                status: "failed",
                reason: "generation-budget-exhausted",
                strategy: "none",
              }),
            ],
            diagnostics: [],
            noTextDetected: false,
          },
        ],
        [
          healthy.imagePath,
          {
            hints: [hint("本文", 0, { status: "recovered" })],
            diagnostics: [],
            noTextDetected: false,
          },
        ],
      ]),
    });

    const result = await pipeline.runWholePagePipeline(
      basePipelineOptions([failed, healthy], []),
    );

    const byId = new Map(result.pages.map((page) => [page.id, page]));
    expect(byId.get(failed.id)?.analysisStatus).toBe("failed");
    expect(byId.get(failed.id)?.lastError).toContain("OCR CHECK");
    expect(requestTranslation).toHaveBeenCalled();
    for (const [, options] of requestTranslation.mock.calls)
      expect(options.imagePath).toBe(healthy.imagePath);
  });

  it("never turns a failed keep-block crop read into source text", () => {
    expect(
      readKeepBlockCropText(
        [hint("本文", 0), hint("ペラ".repeat(64), 50, { status: "failed" })],
        "ja",
      ),
    ).toBeNull();
    expect(
      readKeepBlockCropText(
        [hint("左", 0), hint("右", 50, { status: "recovered" })],
        "ja",
      ),
    ).toBe(joinCropOcrTexts([hint("左", 0), hint("右", 50)], "ja"));
  });

  it("marks only the failed kept block so the page gate stops it", () => {
    const result = {
      hints: [hint("本文", 0), hint("", 50)],
      diagnostics: [],
      noTextDetected: false,
    };
    expect(withFailedKeepBlockReads(result, undefined)).toBe(result);
    expect(withFailedKeepBlockReads(result, new Set()).hints).toBe(
      result.hints,
    );
    expect(
      withFailedKeepBlockReads(result, new Set([1])).hints.map(
        (item) => (item as { ocrHealth?: unknown }).ocrHealth,
      ),
    ).toEqual([undefined, { status: "failed" }]);
  });
});
