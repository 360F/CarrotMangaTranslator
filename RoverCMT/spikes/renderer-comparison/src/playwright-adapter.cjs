"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { pathToFileURL } = require("node:url");

async function createPlaywrightAdapter(contract) {
  const started = performance.now();
  const { chromium } = require("playwright");
  const { createPageExportHtmlSource } = require(
    path.join(contract.repoRoot, "out", "main", "pageExportHtml.js"),
  );
  const fontId = "benchmark-noto-sans-cjk-kr-regular-2-004";
  const htmlSource = createPageExportHtmlSource({
    assetDirectories: () => [
      path.join(contract.repoRoot, "out", "page-export"),
    ],
    rendererStylesheet: () =>
      pathToFileURL(
        path.join(contract.repoRoot, "src", "renderer", "src", "styles.css"),
      ).toString(),
    fonts: {
      list: () => [
        {
          id: fontId,
          label: "Noto Sans CJK KR Regular 2.004",
          family: contract.font.family,
          fileName: path.basename(contract.font.filePath),
        },
      ],
      readPreferences: () => ({
        favoriteIds: [],
        orderedIds: [],
        hiddenIds: [],
        defaultFontId: fontId,
      }),
      resolveFilePath: (id) => (id === fontId ? contract.font.filePath : null),
    },
  });
  const server = await chromium.launchServer({
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--disable-gpu",
      "--force-device-scale-factor=1",
    ],
  });
  const browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const coldStartMs = performance.now() - started;
  const rootPid = server.process()?.pid ?? null;

  return {
    id: "playwright-chromium",
    coldStartMs,
    runtime: {
      package: "playwright",
      version: require("playwright/package.json").version,
      chromium: browser.version(),
      browserRootPid: rootPid,
      productionArtifact:
        "out/page-export/runtime.js and styles.css (benchmark-only)",
    },
    font: baseFontMetadata(contract),
    async render(fixture) {
      consoleErrors.length = 0;
      const beforeRss = process.memoryUsage().rss;
      const pageModel = {
        id: fixture.snapshot.sourcePageId,
        name: fixture.snapshot.sourcePageName,
        width: fixture.snapshot.width,
        height: fixture.snapshot.height,
        blocks: fixture.snapshot.blocks.map(toProductionBlock),
      };
      const imageSrc = toDataUrl(fixture.imagePath);
      const html = htmlSource.buildHtml(
        pageModel,
        imageSrc,
        { width: pageModel.width, height: pageModel.height },
        {
          resolutionMode: "original",
          sourceSize: { width: pageModel.width, height: pageModel.height },
        },
      );
      const htmlPath = path.join(contract.workDir, `${fixture.pageId}.html`);
      fs.writeFileSync(htmlPath, html, { encoding: "utf8", flag: "wx" });
      await page.setViewportSize({
        width: pageModel.width,
        height: pageModel.height,
      });
      const begin = performance.now();
      await page.goto(pathToFileURL(htmlPath).toString(), {
        waitUntil: "load",
      });
      await page.waitForFunction(
        () =>
          document.body.dataset.ready === "1" ||
          Boolean(document.body.dataset.error),
        undefined,
        { timeout: 30_000 },
      );
      const bodyState = await page.evaluate(() => ({
        ready: document.body.dataset.ready,
        error: document.body.dataset.error,
        width: document.body.dataset.outputWidth,
        height: document.body.dataset.outputHeight,
      }));
      if (bodyState.error || bodyState.ready !== "1") {
        throw new Error(
          bodyState.error ||
            "Production page-export runtime did not become ready",
        );
      }
      if (
        Number(bodyState.width) !== pageModel.width ||
        Number(bodyState.height) !== pageModel.height
      ) {
        throw new Error(
          `Playwright output dimensions do not match ${fixture.sourcePage}`,
        );
      }
      const fontEvidence = await inspectPlatformFonts(
        page,
        context,
        contract.font,
      );
      if (fontEvidence.fallbackDetected) {
        throw new Error(
          `Playwright Chromium used an unexpected font: ${JSON.stringify(fontEvidence)}`,
        );
      }
      const layoutEvidence = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll("[data-layout-evidence]"),
          (element) => JSON.parse(element.dataset.layoutEvidence),
        ),
      );
      const png = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: pageModel.width, height: pageModel.height },
        animations: "disabled",
      });
      const durationMs = performance.now() - begin;
      const browserTreeRssBytes = rootPid
        ? readProcessTreeRssBytes(rootPid)
        : null;
      return {
        png,
        durationMs,
        layoutEvidence,
        fontEvidence,
        consoleErrors: [...consoleErrors],
        memory: {
          driverProcessRssStartBytes: beforeRss,
          driverProcessRssAfterBytes: process.memoryUsage().rss,
          browserProcessTreeRssObservedAfterRenderBytes: browserTreeRssBytes,
        },
      };
    },
    async close() {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

async function inspectPlatformFonts(page, context, expected) {
  const session = await context.newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const documentNode = await session.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const queried = await session.send("DOM.querySelectorAll", {
      nodeId: documentNode.root.nodeId,
      selector:
        ".overlay-text-main .overlay-text-line > span, .overlay-text-main .overlay-text-content > span",
    });
    const fonts = new Map();
    for (const nodeId of queried.nodeIds) {
      const result = await session.send("CSS.getPlatformFontsForNode", {
        nodeId,
      });
      for (const font of result.fonts) {
        const key = `${font.familyName}|${font.postScriptName}|${font.isCustomFont}`;
        const current = fonts.get(key) || { ...font, glyphCount: 0 };
        current.glyphCount += font.glyphCount;
        fonts.set(key, current);
      }
    }
    const values = [...fonts.values()];
    const fallbackDetected =
      values.length === 0 ||
      values.some(
        (font) =>
          font.familyName !== expected.family ||
          font.postScriptName !== expected.postScriptName ||
          font.isCustomFont !== true,
      );
    return {
      requestedFamily: expected.family,
      requestedPostScriptName: expected.postScriptName,
      actualLoadedFont: values,
      inspectedNodes: queried.nodeIds.length,
      fallbackDetected,
      fallbackDetectionMethod: "Chromium CDP CSS.getPlatformFontsForNode",
      fallbackMayBeUndetected: false,
    };
  } finally {
    await session.detach().catch(() => {});
  }
}

function readProcessTreeRssBytes(rootPid) {
  if (process.platform !== "win32") return null;
  const script = [
    "$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize",
    `$ids = [System.Collections.Generic.HashSet[uint32]]::new(); [void]$ids.Add([uint32]${rootPid})`,
    "do { $before=$ids.Count; foreach($p in $all){ if($ids.Contains([uint32]$p.ParentProcessId)){[void]$ids.Add([uint32]$p.ProcessId)} } } while($ids.Count -gt $before)",
    "$sum=0; foreach($p in $all){if($ids.Contains([uint32]$p.ProcessId)){$sum += [int64]$p.WorkingSetSize}}; Write-Output $sum",
  ].join("; ");
  try {
    const output = childProcess.execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      {
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      },
    );
    const value = Number(output.trim());
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    void error;
    return null;
  }
}

function toDataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime =
    extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function toProductionBlock(block) {
  return {
    ...stripNulls(block),
    sourceText: "",
    confidence: 0,
    sourceDirection: block.renderDirection,
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

function baseFontMetadata(contract) {
  return {
    requestedAssetId: contract.font.id,
    requestedFamily: contract.font.family,
    requestedPostScriptName: contract.font.postScriptName,
    path: contract.font.path,
    absolutePath: contract.font.filePath,
    sha256: contract.font.sha256,
    format: contract.font.format,
  };
}

module.exports = { createPlaywrightAdapter };
