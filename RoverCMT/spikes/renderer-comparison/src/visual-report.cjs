"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

function createVisualReport(runDir, contract, runResult) {
  const reportDir = path.join(runDir, "visual-comparison");
  const diffDir = path.join(reportDir, "diffs");
  fs.mkdirSync(diffDir, { recursive: true });
  const diagnostics = [];
  for (const fixture of contract.fixtures) {
    const fixtureResult = runResult.fixtures.find(
      (value) => value.pageId === fixture.pageId,
    );
    const reference = PNG.sync.read(fs.readFileSync(fixture.referencePath));
    for (const candidate of runResult.candidates) {
      const output = fixtureResult?.candidates[candidate.id];
      if (!output?.success || !output.outputPath) continue;
      const candidatePath = path.join(runDir, output.outputPath);
      const actual = PNG.sync.read(fs.readFileSync(candidatePath));
      const compared = buildDiff(reference, actual);
      const outputName = `${path.parse(fixture.sourcePage).name}--${candidate.id}.png`;
      const outputPath = path.join(diffDir, outputName);
      fs.writeFileSync(outputPath, PNG.sync.write(compared.diff), {
        flag: "wx",
      });
      diagnostics.push({
        pageId: fixture.pageId,
        sourcePage: fixture.sourcePage,
        candidate: candidate.id,
        meanAbsoluteRgbChannelError: compared.meanAbsoluteRgbChannelError,
        changedPixelRatio: compared.changedPixelRatio,
        note: "Diagnostic only; anti-aliasing/rasterization differences are not pass/fail criteria.",
        diffPath: path.relative(runDir, outputPath).replaceAll(path.sep, "/"),
      });
    }
  }
  fs.writeFileSync(
    path.join(reportDir, "diagnostics.json"),
    `${JSON.stringify({ version: 1, diagnostics }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  fs.writeFileSync(
    path.join(reportDir, "index.html"),
    buildHtml(contract, runResult, diagnostics),
    { encoding: "utf8", flag: "wx" },
  );
  return {
    html: path
      .relative(runDir, path.join(reportDir, "index.html"))
      .replaceAll(path.sep, "/"),
    diagnostics: path
      .relative(runDir, path.join(reportDir, "diagnostics.json"))
      .replaceAll(path.sep, "/"),
    diffCount: diagnostics.length,
  };
}

function buildDiff(reference, actual) {
  if (reference.width !== actual.width || reference.height !== actual.height) {
    throw new Error("Cannot diff images with different dimensions");
  }
  const diff = new PNG({ width: reference.width, height: reference.height });
  let total = 0;
  let changed = 0;
  const pixels = reference.width * reference.height;
  for (let offset = 0; offset < reference.data.length; offset += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(
        reference.data[offset + channel] - actual.data[offset + channel],
      );
      total += delta;
      if (delta > 0) pixelChanged = true;
      diff.data[offset + channel] = Math.min(255, delta * 4);
    }
    diff.data[offset + 3] = 255;
    if (pixelChanged) changed += 1;
  }
  return {
    diff,
    meanAbsoluteRgbChannelError: total / (pixels * 3 * 255),
    changedPixelRatio: changed / pixels,
  };
}

function buildHtml(contract, runResult, diagnostics) {
  const candidateIds = runResult.candidates.map((candidate) => candidate.id);
  const rows = contract.fixtures
    .map((fixture) => {
      const result = runResult.fixtures.find(
        (value) => value.pageId === fixture.pageId,
      );
      const reference = relativeFromReport(
        runResult.runDirectory,
        fixture.referencePath,
      );
      const cells = [
        imageCell(
          `Electron reference-v${contract.manifest.version}`,
          reference,
          fixture.sourcePage,
        ),
        ...candidateIds.map((candidateId) => {
          const value = result?.candidates[candidateId];
          if (!value?.success)
            return `<section><h3>${escapeHtml(candidateId)}</h3><pre>${escapeHtml(value?.error?.message || "failed")}</pre></section>`;
          const diagnostic = diagnostics.find(
            (item) =>
              item.pageId === fixture.pageId && item.candidate === candidateId,
          );
          return `${imageCell(candidateId, `../${value.outputPath}`, fixture.sourcePage)}${
            diagnostic
              ? imageCell(
                  `${candidateId} 4x amplified absolute diff`,
                  diagnostic.diffPath.replace(/^visual-comparison\//, ""),
                  fixture.sourcePage,
                )
              : ""
          }`;
        }),
      ].join("");
      return `<article><h2>${escapeHtml(fixture.sourcePage)}</h2><p>${escapeHtml(fixture.features.join(", "))}</p><div class="grid">${cells}</div></article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RoverCMT renderer comparison</title><style>
body{margin:0;background:#15171a;color:#f4f5f7;font:14px system-ui,sans-serif}header,article{padding:18px 24px}article{border-top:1px solid #3a3f46}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;align-items:start}section{min-width:0;background:#20242a;padding:10px;border-radius:8px}h1,h2,h3{margin:.2em 0 .55em}img{display:block;width:100%;height:auto;background:#fff}p{color:#bbc2cc}code,pre{white-space:pre-wrap;color:#ffb4ab}@media(max-width:1100px){.grid{grid-template-columns:repeat(2,minmax(240px,1fr))}}
</style></head><body><header><h1>RoverCMT renderer comparison</h1><p>Human review artifact. Pixel diagnostics are aids only, never pass/fail or winner selection.</p></header>${rows}</body></html>\n`;
}

function imageCell(label, source, alt) {
  return `<section><h3>${escapeHtml(label)}</h3><a href="${escapeHtml(source)}"><img loading="lazy" src="${escapeHtml(source)}" alt="${escapeHtml(`${alt} ${label}`)}"></a></section>`;
}

function relativeFromReport(runDirectory, absolutePath) {
  const reportDir = path.join(runDirectory, "visual-comparison");
  return path.relative(reportDir, absolutePath).replaceAll(path.sep, "/");
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );
}

module.exports = { buildDiff, createVisualReport };
