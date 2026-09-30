"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PNG } = require("pngjs");
const { buildDiff } = require("../src/visual-report.cjs");

test("visual diff is diagnostic and dimension preserving", () => {
  const reference = new PNG({ width: 2, height: 1 });
  const actual = new PNG({ width: 2, height: 1 });
  reference.data.fill(255);
  actual.data.fill(255);
  actual.data[0] = 0;
  const result = buildDiff(reference, actual);
  assert.equal(result.diff.width, 2);
  assert.equal(result.diff.height, 1);
  assert.equal(result.changedPixelRatio, 0.5);
  assert.ok(result.meanAbsoluteRgbChannelError > 0);
});

test("visual diff rejects dimension mismatch", () => {
  assert.throws(
    () =>
      buildDiff(
        new PNG({ width: 1, height: 1 }),
        new PNG({ width: 2, height: 1 }),
      ),
    /different dimensions/,
  );
});
