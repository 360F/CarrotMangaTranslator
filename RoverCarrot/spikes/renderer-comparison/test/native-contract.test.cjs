"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { layoutNativeBlock } = require("../lib/shared-layout.cjs");

function measurementContext() {
  return {
    font: "normal 400 10px sans-serif",
    measureText(text) {
      const matched = /([0-9.]+)px/.exec(this.font);
      const size = matched ? Number(matched[1]) : 10;
      return {
        width: Array.from(String(text)).length * size * 0.5,
        actualBoundingBoxAscent: size * 0.75,
        actualBoundingBoxDescent: size * 0.2,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: size * 0.5,
      };
    },
  };
}

test("generic autofit preserves the production 256px upper bound", () => {
  const block = {
    id: "generic-contract-probe",
    bbox: { x: 0, y: 0, w: 1000, h: 1000 },
    bboxSpace: "normalized_1000",
    translatedText: "A",
    fontSizePx: 35,
    lineHeight: 1,
    renderDirection: "horizontal",
    autoFitText: true,
    textAlign: "center",
  };
  const layout = layoutNativeBlock(
    block,
    { width: 1000, height: 1000 },
    measurementContext(),
    "sans-serif",
  );
  assert.equal(layout.layoutPath, "generic-autofit");
  assert.equal(layout.fitBounds.searchMaxPx, 256);
  assert.equal(layout.fontSizePx, 256);
});

test("native contract source has no fixture-specific _0411 branch", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "shared-layout.ts"),
    "utf8",
  );
  assert.equal(source.includes("_0411"), false);
});
