"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const {
  layoutNativeBlock,
  resolveNativePageSourceFontFaceFallbacks,
} = require("../lib/shared-layout.cjs");
const { toProductionPageV3 } = require("./production-page.cjs");

function packageVersion(packageRoot) {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  ).version;
}

function createMemoryProbe() {
  const start = process.memoryUsage().rss;
  let peak = start;
  return {
    sample() {
      peak = Math.max(peak, process.memoryUsage().rss);
    },
    finish() {
      this.sample();
      return { processRssStartBytes: start, processRssPeakObservedBytes: peak };
    },
  };
}

async function createSkiaAdapter(contract) {
  const started = performance.now();
  const skia = require("skia-canvas");
  const registered = skia.FontLibrary.use(contract.font.family, [
    contract.font.filePath,
  ]);
  if (!registered?.length || !skia.FontLibrary.has(contract.font.family)) {
    throw new Error(`Skia Canvas did not register ${contract.font.family}`);
  }
  const family = skia.FontLibrary.family(contract.font.family);
  const coldStartMs = performance.now() - started;
  return {
    id: "skia-canvas",
    coldStartMs,
    runtime: {
      package: "skia-canvas",
      version: packageVersion(
        path.resolve(path.dirname(require.resolve("skia-canvas")), ".."),
      ),
      engine: "Skia native binding",
      fontLibraryFamily: family,
      inputContract:
        contract.manifest.version === 3
          ? "canonical frozen inputs-v3 via toProductionPageV3"
          : "historical manifest-v2 snapshot",
      readsSourceChapter: false,
    },
    font: fontMetadata(contract, {
      actualLoadedFont: family,
      registrationSucceeded: true,
      fallbackDetected: false,
      fallbackDetectionMethod:
        "FontLibrary registration/family inspection plus manifest glyph coverage",
      fallbackMayBeUndetected: true,
    }),
    async render(fixture) {
      const probe = createMemoryProbe();
      const begin = performance.now();
      const canvas = new skia.Canvas(
        fixture.snapshot.width,
        fixture.snapshot.height,
      );
      const context = canvas.getContext("2d");
      const image = await skia.loadImage(fixture.imagePath);
      context.drawImage(
        image,
        0,
        0,
        fixture.snapshot.width,
        fixture.snapshot.height,
      );
      const layouts = renderBlocks(
        context,
        fixture,
        contract.font.family,
        probe,
        contract.manifest.version === 3,
      );
      const png = await canvas.toBuffer("png");
      probe.sample();
      return {
        png,
        durationMs: performance.now() - begin,
        memory: probe.finish(),
        layoutEvidence: layouts,
      };
    },
    async close() {},
  };
}

async function createNodeCanvasAdapter(contract) {
  const started = performance.now();
  const canvasApi = require("canvas");
  canvasApi.registerFont(contract.font.filePath, {
    family: contract.font.family,
    weight: "normal",
    style: "normal",
  });
  const smokeCanvas = canvasApi.createCanvas(8, 8);
  const smoke = smokeCanvas.getContext("2d");
  smoke.font = `12px "${contract.font.family}"`;
  if (!(smoke.measureText("?").width > 0)) {
    throw new Error(`node-canvas could not measure the registered font`);
  }
  const fontLoadFailure =
    process.platform === "win32" && contract.font.format === "OTF"
      ? "node-canvas/Pango emitted an exact-face load failure for the pinned OTF/CFF on Windows and fell back to Sans"
      : null;
  const coldStartMs = performance.now() - started;
  return {
    id: "node-canvas",
    coldStartMs,
    runtime: {
      package: "canvas",
      version: canvasApi.version,
      cairo: canvasApi.cairoVersion,
      pango: canvasApi.pangoVersion,
      freetype: canvasApi.freetypeVersion,
      fontconfig: "used by Pango/Cairo; version not exposed by package",
    },
    font: fontMetadata(contract, {
      actualLoadedFont: fontLoadFailure
        ? null
        : {
            family: contract.font.family,
            postScriptName: contract.font.postScriptName,
          },
      fallbackFaceReported: fontLoadFailure ? "Sans" : null,
      registrationSucceeded: !fontLoadFailure,
      fallbackDetected: Boolean(fontLoadFailure),
      fallbackDetectionMethod:
        "registerFont plus Pango exact-face load diagnostic during measurement smoke",
      fallbackMayBeUndetected: !fontLoadFailure,
      error: fontLoadFailure,
    }),
    async render(fixture) {
      if (fontLoadFailure) throw new Error(fontLoadFailure);
      const probe = createMemoryProbe();
      const begin = performance.now();
      const canvas = canvasApi.createCanvas(
        fixture.snapshot.width,
        fixture.snapshot.height,
      );
      const context = canvas.getContext("2d");
      const image = await canvasApi.loadImage(fixture.imagePath);
      context.drawImage(
        image,
        0,
        0,
        fixture.snapshot.width,
        fixture.snapshot.height,
      );
      const layouts = renderBlocks(
        context,
        fixture,
        contract.font.family,
        probe,
        contract.manifest.version === 3,
      );
      const png = canvas.toBuffer("image/png");
      probe.sample();
      return {
        png,
        durationMs: performance.now() - begin,
        memory: probe.finish(),
        layoutEvidence: layouts,
      };
    },
    async close() {},
  };
}

function renderBlocks(context, fixture, fontFamily, probe, isV3) {
  const page = isV3
    ? toProductionPageV3(fixture.snapshot, fixture.imagePath)
    : { blocks: fixture.snapshot.blocks };
  const pageSize = {
    width: fixture.snapshot.width,
    height: fixture.snapshot.height,
  };
  const fallbacks = isV3
    ? resolveNativePageSourceFontFaceFallbacks(page.blocks, pageSize)
    : new Map();
  const layouts = [];
  for (const block of page.blocks) {
    if (block.renderDirection !== "horizontal") {
      throw new Error(
        `Unsupported fixture direction ${block.renderDirection} in ${block.id}`,
      );
    }
    const layout = layoutNativeBlock(
      block,
      pageSize,
      context,
      `"${fontFamily}"`,
      fallbacks.get(block.id),
    );
    layouts.push({
      blockId: layout.blockId,
      lines: String(block.translatedText ?? "").trim()
        ? layout.lines.map((line) => line.text)
        : null,
      fontSizePx: layout.fontSizePx,
      innerWidth: layout.rect.width,
      innerHeight: layout.rect.height,
      overflow: layout.overflow,
      usedBubbleSlots: layout.usedBubbleSlots,
      layoutPath: layout.layoutPath,
      fitBounds: layout.fitBounds,
      sourceMatch: layout.sourceMatch,
      bubbleSlotUsage: {
        used: layout.usedBubbleSlots,
        lineSlots: layout.lines.map((line) => ({
          availableWidth: line.availableWidth,
          left: line.left,
          top: line.top,
        })),
      },
    });
    drawLayout(context, block, layout, fontFamily);
    probe.sample();
  }
  return layouts;
}

function drawLayout(context, block, layout, fontFamily) {
  context.save();
  context.globalAlpha = normalizeOpacity(block.textOpacity);
  context.fillStyle = block.textColor || "#111111";
  context.strokeStyle = block.outlineColor || "#ffffff";
  context.lineJoin = "round";
  context.miterLimit = 2;
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.font = `${block.italic ? "italic" : "normal"} ${block.bold ? "700" : "400"} ${layout.fontSizePx}px "${fontFamily}"`;
  const outline = resolveOutlineWidth(block, layout.fontSizePx);
  context.lineWidth = outline * 2;
  for (const line of layout.lines) {
    const x = resolveLineX(block.textAlign, line);
    const metrics = context.measureText(line.text);
    const ascent = finiteOr(
      metrics.actualBoundingBoxAscent,
      layout.fontSizePx * 0.8,
    );
    const descent = finiteOr(
      metrics.actualBoundingBoxDescent,
      layout.fontSizePx * 0.2,
    );
    const baseline =
      line.top + (line.lineHeight - ascent - descent) / 2 + ascent;
    if (outline > 0) context.strokeText(line.text, x, baseline);
    context.fillText(line.text, x, baseline);
  }
  context.restore();
}

function resolveLineX(textAlign, line) {
  if (textAlign === "left") return line.left;
  if (textAlign === "right")
    return line.left + line.availableWidth - line.width;
  return line.left + (line.availableWidth - line.width) / 2;
}

function resolveOutlineWidth(block, fontSizePx) {
  if (Number.isFinite(block.outlineWidthPx)) {
    return Math.min(64, Math.max(0, block.outlineWidthPx));
  }
  const scale = Number.isFinite(block.outlineWidthScale)
    ? Math.max(0, block.outlineWidthScale)
    : 1;
  return (
    (Math.round(Math.min(4, Math.max(0.35, fontSizePx * 0.055)) * 10) / 10) *
    scale
  );
}

function normalizeOpacity(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function fontMetadata(contract, extra) {
  return {
    requestedAssetId: contract.font.id,
    requestedFamily: contract.font.family,
    requestedPostScriptName: contract.font.postScriptName,
    path: contract.font.path,
    absolutePath: contract.font.filePath,
    sha256: contract.font.sha256,
    format: contract.font.format,
    ...extra,
  };
}

module.exports = { createNodeCanvasAdapter, createSkiaAdapter };
