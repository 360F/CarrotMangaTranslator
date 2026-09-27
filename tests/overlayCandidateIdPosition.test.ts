import { describe, expect, it } from "vitest";
import type { MangaPage } from "../src/shared/libraryTypes";
import type { OverlayItem } from "../src/main/pipeline/types";
import { validateOverlayItemsAgainstReferences } from "../src/main/pipeline/overlayItemReferences";
import {
  applyOverlayItemsToExistingBlocks,
  buildKeepBlocksOcrResult,
} from "../src/main/pipeline/keepBlocksResult";
import { buildPreviousBlocksForPrompt } from "../src/main/pipeline/previousBlocksForPrompt";
import { makeBlock } from "./helpers/workspacePointerFixtures";

/**
 * A retried fixed-block request sends only the untranslated block(s) as
 * candidates while the model still sees the whole page. Gemma may ignore the
 * candidate ids and renumber the page from 1 (real Case 1: page 4, run
 * 849013e3). Coordinates below are normalized_1000, as at validation time.
 */
const PAGE_WIDTH = 1200;
const PAGE_HEIGHT = 1800;

function makePage(blocks: MangaPage["blocks"]): MangaPage {
  return {
    id: "page-4",
    name: "004.jpg",
    imagePath: "C:/page-4.jpg",
    dataUrl: "",
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    blocks,
    blockOrder: blocks.map((block) => block.id),
    analysisStatus: "completed",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

function item(
  id: number,
  bbox: OverlayItem["bbox"],
  jp: string,
  ko: string,
): OverlayItem {
  return {
    id,
    type: "nonsolid",
    textRole: "ordinary",
    bbox,
    jp,
    ko,
    direction: "vertical",
    confidence: 1,
  };
}

/** The top-right first bubble the model numbered 1 in the real run. */
const TOP_BUBBLE = item(
  1,
  { x: 875, y: 45, w: 100, h: 180 },
  "そうか、好きでも毎日\n5～7着止まりと",
  "그렇구나, 좋아해도 매일\n5~7벌 정도구나",
);

/** Runs the real validation and fixed-block assignment for one page. */
function translateFixedBlocks(page: MangaPage, items: OverlayItem[]) {
  // The workflow attaches each block's OCR text to its candidate.
  const hints = buildKeepBlocksOcrResult(
    page,
    page.blocks.map((block) => block.sourceText),
  ).hints;
  const validated = validateOverlayItemsAgainstReferences(
    items,
    page,
    hints as never,
    [],
    { sourceLanguage: "ja" },
  );
  const mapping = applyOverlayItemsToExistingBlocks({
    page,
    items: validated.items,
    previousBlocks: buildPreviousBlocksForPrompt(page, hints, {
      assignSequentialCandidateIds: true,
    }),
  });
  return { validated, blocks: mapping.blocks };
}

describe("fixed-block candidate id position check", () => {
  it("does not give the END candidate the renumbered top bubble (real Case 1)", () => {
    const end = makeBlock(false, {
      id: "page-4-block-20",
      bbox: { x: 42, y: 966, w: 52, h: 19 },
      sourceText: "END",
      translatedText: "",
    });
    const page = makePage([end]);

    const { validated, blocks } = translateFixedBlocks(page, [
      TOP_BUBBLE,
      item(19, { x: 42, y: 966, w: 52, h: 19 }, "END", "END"),
    ]);

    expect(blocks[0].translatedText).not.toContain("5~7벌");
    // "END" itself stays excluded by the unchanged fragment-noise policy.
    expect(blocks[0].translatedText).toBe("");
    expect(validated.reasons.fragment_noise).toBe(1);
    expect(validated.items.some((entry) => entry.id === 1)).toBe(false);
    expect(validated.omittedCandidateIds).toEqual([1]);
    // The released record keeps its text under a non-candidate id.
    expect(validated.items).toEqual([
      expect.objectContaining({ jp: TOP_BUBBLE.jp, id: 20 }),
    ]);
  });

  it("recovers the record at the candidate position through the existing remap", () => {
    const lower = makeBlock(false, {
      id: "page-4-block-20",
      bbox: { x: 100, y: 800, w: 150, h: 120 },
      sourceText: "まさか子供に実験なんて",
      translatedText: "",
    });
    const page = makePage([lower]);

    const { validated, blocks } = translateFixedBlocks(page, [
      TOP_BUBBLE,
      item(
        19,
        { x: 105, y: 805, w: 140, h: 110 },
        "まさか子供に実験なんて",
        "설마 아이에게 실험 같은 걸",
      ),
    ]);

    expect(blocks[0].translatedText).toBe("설마 아이에게 실험 같은 걸");
    expect(validated.remappedCount).toBe(1);
    expect(validated.items.find((entry) => entry.id === 1)?.jp).toBe(
      "まさか子供に実験なんて",
    );
  });

  it("keeps a matching id whose box is slightly offset (real Case 2)", () => {
    // page_042 candidate vs Gemma box: no overlap, centers ~40 apart.
    const vertical = makeBlock(false, {
      id: "page-42-block-1",
      bbox: { x: 948, y: 375, w: 18, h: 145 },
      sourceText: "Ona Ha All Najwa",
      translatedText: "",
    });
    const page = makePage([vertical]);

    const { validated, blocks } = translateFixedBlocks(page, [
      item(
        1,
        { x: 928, y: 351, w: 18, h: 124 },
        "PRESENTED BY HERO",
        "HERO 제공",
      ),
    ]);

    expect(validated.items).toEqual([
      expect.objectContaining({ id: 1, ko: "HERO 제공" }),
    ]);
    expect(blocks[0].translatedText).toBe("HERO 제공");
  });

  it("keeps every candidate when ids and positions agree", () => {
    const boxes = [
      { x: 820, y: 60, w: 120, h: 200 },
      { x: 520, y: 60, w: 120, h: 200 },
      { x: 120, y: 500, w: 120, h: 200 },
    ];
    const page = makePage(
      boxes.map((bbox, index) =>
        makeBlock(false, {
          id: `block-${index + 1}`,
          bbox,
          sourceText: `台詞${index + 1}`,
          translatedText: "",
        }),
      ),
    );

    const { validated, blocks } = translateFixedBlocks(
      page,
      boxes.map((bbox, index) =>
        item(
          index + 1,
          { ...bbox, x: bbox.x + 6, y: bbox.y - 4 },
          `台詞${index + 1}`,
          `대사 ${index + 1}`,
        ),
      ),
    );

    expect(validated.items.map((entry) => entry.id)).toEqual([1, 2, 3]);
    expect(validated.remappedCount).toBe(0);
    expect(blocks.map((block) => block.translatedText)).toEqual([
      "대사 1",
      "대사 2",
      "대사 3",
    ]);
  });
});
