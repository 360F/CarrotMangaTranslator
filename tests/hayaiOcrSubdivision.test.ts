import { describe, expect, it } from "vitest";
import {
  hayaiResizeScale,
  planHayaiOcrSubdivision,
} from "../src/main/textDetection/hayaiOcrSubdivision";

const GRID = 200;
const PAGE = 1000; // 5 px per mask cell

function columnMask(
  columns: Array<[number, number]>,
  top: number,
  bottom: number,
) {
  const mask = new Uint8Array(GRID * GRID);
  for (const [start, end] of columns)
    for (let y = top; y < bottom; y += 1)
      for (let x = start; x < end; x += 1) mask[y * GRID + x] = 1;
  return mask;
}

function plan(
  bbox: [number, number, number, number],
  columns: Array<[number, number]>,
  top = 20,
  bottom = 160,
) {
  return planHayaiOcrSubdivision({
    bbox,
    masks: [columnMask(columns, top, bottom)],
    maskWidth: GRID,
    maskHeight: GRID,
    pageWidth: PAGE,
    pageHeight: PAGE,
  });
}

const denseColumns = Array.from(
  { length: 16 },
  (_unused, index) => [10 + index * 7, 15 + index * 7] as [number, number],
);

describe("Hayai OCR subdivision planning", () => {
  it("mirrors the naflex patch budget for the crop size", () => {
    expect(hayaiResizeScale([0, 0, 100, 100])).toBeCloseTo(2.56, 2);
    expect(hayaiResizeScale([368, 20, 969, 702])).toBeCloseTo(0.4, 2);
  });

  it("reads dense vertical columns as right-to-left groups before OCR", () => {
    const result = plan([45, 95, 680, 805], denseColumns);
    expect(result?.mode).toBe("preemptive");
    expect(result?.bboxes).toHaveLength(8);
    const lefts = result?.bboxes.map((box) => box[0]) ?? [];
    expect(lefts).toEqual([...lefts].sort((a, b) => b - a));
    for (const [x1, y1, x2, y2] of result?.bboxes ?? []) {
      expect(x1).toBeGreaterThanOrEqual(45);
      expect(y1).toBeGreaterThanOrEqual(95);
      expect(x2).toBeLessThanOrEqual(680);
      expect(y2).toBeLessThanOrEqual(805);
    }
  });

  it("keeps readable columns on the whole-region path with a retry plan", () => {
    const result = plan(
      [45, 95, 305, 805],
      [
        [10, 20],
        [24, 34],
        [38, 48],
        [52, 60],
      ],
    );
    expect(result?.mode).toBe("retry");
    expect(result?.bboxes).toHaveLength(4);
  });

  it("does not split horizontal-shaped regions or a single column", () => {
    expect(plan([45, 95, 680, 300], denseColumns, 20, 58)).toBeUndefined();
    expect(plan([45, 95, 120, 805], [[10, 20]])).toBeUndefined();
  });
});
