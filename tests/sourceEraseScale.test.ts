import { describe, expect, it } from "vitest";
import {
  resolveSourceEraseScalePx,
  sourceFaceToNominalEquivalentPx,
} from "../src/main/pageWorkflow/sourceEraseScale";

describe("source erase scale", () => {
  it("converts a measured glyph face to a conservative nominal equivalent", () => {
    expect(sourceFaceToNominalEquivalentPx(16)).toBeCloseTo(21.2);
    expect(
      resolveSourceEraseScalePx({
        trustedFacePx: 40,
        legacyFontSizePx: 20,
      }),
    ).toEqual({ source: "measured", value: 26 });
  });

  it("uses source-only fallbacks in order and keeps the legacy clamp", () => {
    expect(
      resolveSourceEraseScalePx({
        pagePeerFacePx: 18,
        ocrGeometryFacePx: 22,
        sourceBboxFacePx: 30,
        legacyFontSizePx: 24,
      }),
    ).toEqual({ source: "page-peer", value: 24 });
    expect(
      resolveSourceEraseScalePx({
        ocrGeometryFacePx: 4,
        sourceBboxFacePx: 40,
        legacyFontSizePx: 24,
      }),
    ).toEqual({ source: "ocr-geometry", value: 18 });
    expect(resolveSourceEraseScalePx({ legacyFontSizePx: 32 })).toEqual({
      source: "legacy",
      value: 32,
    });
  });
});
