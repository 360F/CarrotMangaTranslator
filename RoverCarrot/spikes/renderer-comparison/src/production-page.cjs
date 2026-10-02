"use strict";

/**
 * Contract-aligned (v3) renderer input shared by every renderer path.
 *
 * The Electron reference generator, the Playwright adapter, and the Skia
 * adapter all build their production page from the same frozen manifest-v3
 * page snapshot through this module. No path may read the source chapter.
 */

/** Block fields frozen into v3 snapshots because production layout reads them. */
const SOURCE_MATCH_CONTRACT_FIELDS = Object.freeze([
  "sourceText",
  "sourceDirection",
  "textRole",
  "fontRole",
  "fontFamily",
  "confidence",
  "sourceFontFacePx",
  "sourceFontSizeConfidence",
  "sourceFontSizeMethod",
  "sourceFontFaceFallbackPx",
]);

/** Single benchmark font record used by the Electron, Chromium, and Skia paths. */
const BENCHMARK_FONT_ID = "benchmark-noto-sans-cjk-kr-regular-2-004";
const BENCHMARK_FONT_CSS_FAMILY = "Rover Benchmark Noto Sans CJK KR";
const BENCHMARK_FONT_LABEL = "Noto Sans CJK KR Regular 2.004";

function benchmarkFontRecord(fontFilePath) {
  const fileName = fontFilePath.replace(/\\/g, "/").split("/").at(-1);
  return {
    id: BENCHMARK_FONT_ID,
    label: BENCHMARK_FONT_LABEL,
    family: BENCHMARK_FONT_CSS_FAMILY,
    fileName,
  };
}

function benchmarkFontPreferences() {
  return {
    favoriteIds: [],
    orderedIds: [],
    hiddenIds: [],
    defaultFontId: BENCHMARK_FONT_ID,
  };
}

function assertV3Snapshot(snapshot) {
  if (!snapshot || snapshot.version !== 3) {
    throw new Error("Expected a v3 contract-aligned page snapshot");
  }
  for (const block of snapshot.blocks) {
    for (const field of SOURCE_MATCH_CONTRACT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(block, field)) {
        throw new Error(
          `v3 block ${block.id} is missing frozen field ${field}`,
        );
      }
    }
  }
}

/** Production TranslationBlock shape from frozen data only (null = absent). */
function toProductionBlockV3(block) {
  return stripNulls(block);
}

/**
 * Production MangaPage for the page-export renderer. `imagePath` is the
 * manifest-bound render raster; nothing else is taken from outside the snapshot.
 */
function toProductionPageV3(snapshot, renderImagePath) {
  assertV3Snapshot(snapshot);
  return {
    id: snapshot.sourcePageId,
    name: snapshot.sourcePageName,
    width: snapshot.width,
    height: snapshot.height,
    imagePath: renderImagePath,
    blockOrder: [...snapshot.blockOrder],
    blocks: snapshot.blocks.map(toProductionBlockV3),
  };
}

function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null)
      .map(([key, item]) => [key, stripNulls(item)]),
  );
}

module.exports = {
  BENCHMARK_FONT_CSS_FAMILY,
  BENCHMARK_FONT_ID,
  SOURCE_MATCH_CONTRACT_FIELDS,
  assertV3Snapshot,
  benchmarkFontPreferences,
  benchmarkFontRecord,
  stripNulls,
  toProductionBlockV3,
  toProductionPageV3,
};
