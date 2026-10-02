// @ts-check
"use strict";

/**
 * Contract-aligned Electron reference (v3).
 *
 * Reads ONLY fixtures/inputs-v3.json and the files it binds (v3 snapshots,
 * render rasters, portable font). The production MangaPage is rebuilt from the
 * frozen snapshot with src/production-page.cjs, the same function the
 * Playwright and Skia paths use. The source chapter is never opened here.
 *
 * Outputs (refuses to overwrite):
 *   reference-v3-contract-aligned/<page>.png
 *   reference-v3-contract-aligned/layout-evidence.json
 *   reference-v3-contract-aligned/font-verification.json
 *   reference-v3-contract-aligned/render-verification.json
 *   fixtures/manifest-v3.json
 */

const { app, BrowserWindow, nativeImage } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  BENCHMARK_FONT_CSS_FAMILY,
  BENCHMARK_FONT_ID,
  benchmarkFontPreferences,
  benchmarkFontRecord,
  toProductionPageV3,
} = require("./src/production-page.cjs");

const spikeRoot = __dirname;
const repoRoot = path.resolve(spikeRoot, "../../..");
const inputsPath = path.join(spikeRoot, "fixtures", "inputs-v3.json");
const manifestV3Path = path.join(spikeRoot, "fixtures", "manifest-v3.json");
const referenceDir = path.join(spikeRoot, "reference-v3-contract-aligned");
const workDir = path.join(referenceDir, ".work");
const userDataDir = path.join(spikeRoot, ".reference-v3-electron-user-data");
const FONT_SELECTOR =
  ".overlay-text-main .overlay-text-line > span, .overlay-text-main .overlay-text-content > span";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.setPath("userData", userDataDir);
// The production render session owns the only BrowserWindow while references
// are captured. Closing it must not start Electron's default application quit,
// because font verification deliberately opens a second isolated window next.
app.on("window-all-closed", () => {});

void app
  .whenReady()
  .then(run)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      app.exit(1);
    },
  );

async function run() {
  if (fs.existsSync(referenceDir) || fs.existsSync(manifestV3Path)) {
    throw new Error("Refusing to overwrite reference-v3 or manifest-v3");
  }
  const inputsBytes = fs.readFileSync(inputsPath);
  const inputs = JSON.parse(inputsBytes.toString("utf8"));
  if (inputs.version !== 3) throw new Error("Expected inputs-v3");
  const fontAsset = inputs.fontAssets.find(
    (asset) => asset.id === inputs.fontRoles["default-dialogue"],
  );
  if (!fontAsset) throw new Error("default-dialogue font asset missing");
  const fontPath = repoPath(fontAsset.path);
  assertHash(fontPath, fontAsset.sha256, "portable font");

  const fixtures = inputs.fixtures.map((fixture) => {
    const snapshotPath = repoPath(fixture.pageSnapshot.path);
    const imagePath = repoPath(fixture.renderImage.path);
    assertHash(
      snapshotPath,
      fixture.pageSnapshot.sha256,
      `${fixture.sourcePage} v3 snapshot`,
    );
    assertHash(
      imagePath,
      fixture.renderImage.sha256,
      `${fixture.sourcePage} image`,
    );
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    return {
      ...fixture,
      imagePath,
      page: toProductionPageV3(snapshot, imagePath),
    };
  });
  const fixturesByImage = new Map(
    fixtures.map((fixture) => [path.resolve(fixture.imagePath), fixture]),
  );

  fs.mkdirSync(workDir, { recursive: true });
  const { createPageExportRenderSession } = require(
    path.join(repoRoot, "out", "main", "pageExport.js"),
  );
  const { createPageExportHtmlSource } = require(
    path.join(repoRoot, "out", "main", "pageExportHtml.js"),
  );
  const fontRecord = benchmarkFontRecord(fontPath);
  const htmlSource = createPageExportHtmlSource({
    assetDirectories: () => [path.join(repoRoot, "out", "page-export")],
    rendererStylesheet: () =>
      pathToFileURL(
        path.join(repoRoot, "src", "renderer", "src", "styles.css"),
      ).toString(),
    fonts: {
      list: () => [fontRecord],
      readPreferences: benchmarkFontPreferences,
      resolveFilePath: (id) => (id === BENCHMARK_FONT_ID ? fontPath : null),
    },
  });
  const session = await createPageExportRenderSession({
    dataRoot: workDir,
    decodeFallback: async () => null,
    htmlSource,
    probeImageSize: async (imagePath) => {
      const fixture = fixturesByImage.get(path.resolve(imagePath));
      if (!fixture) throw new Error(`Unexpected image probe: ${imagePath}`);
      return {
        width: fixture.renderImage.width,
        height: fixture.renderImage.height,
      };
    },
    resolveImageUrl: (imagePath) => {
      const fixture = fixturesByImage.get(path.resolve(imagePath));
      if (!fixture) throw new Error(`Unexpected image request: ${imagePath}`);
      return toDataUrl(imagePath);
    },
  });

  const outputs = [];
  const layoutEvidence = [];
  try {
    for (const fixture of fixtures) {
      console.log(`Rendering ${fixture.sourcePage}`);
      const png = await session.renderPage(fixture.page);
      const evidence = session.inspectLastLayout
        ? await session.inspectLastLayout()
        : null;
      const decoded = nativeImage.createFromBuffer(png);
      if (decoded.isEmpty())
        throw new Error(`PNG decode failed: ${fixture.sourcePage}`);
      const size = decoded.getSize();
      if (
        size.width !== fixture.page.width ||
        size.height !== fixture.page.height
      ) {
        throw new Error(`Dimension mismatch: ${fixture.sourcePage}`);
      }
      const outputPath = path.join(
        referenceDir,
        `${path.parse(fixture.sourcePage).name}.png`,
      );
      await fsp.writeFile(outputPath, png, { flag: "wx" });
      outputs.push({
        pageId: fixture.pageId,
        sourcePage: fixture.sourcePage,
        snapshotSha256: fixture.pageSnapshot.sha256,
        renderImageSha256: fixture.renderImage.sha256,
        output: {
          path: relative(outputPath),
          format: "PNG",
          width: size.width,
          height: size.height,
          bytes: png.length,
          sha256: sha256(png),
        },
      });
      layoutEvidence.push({
        pageId: fixture.pageId,
        sourcePage: fixture.sourcePage,
        blocks: evidence,
      });
    }
  } finally {
    session.close();
  }

  const fontVerification = await verifyFonts(fixtures, htmlSource);

  const runtime = {
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    hardwareAcceleration: "disabled",
    deviceScaleFactor: 1,
  };
  const layoutPath = path.join(referenceDir, "layout-evidence.json");
  const fontPathOut = path.join(referenceDir, "font-verification.json");
  const renderPathOut = path.join(referenceDir, "render-verification.json");
  await writeJson(layoutPath, { version: 3, runtime, pages: layoutEvidence });
  await writeJson(fontPathOut, { version: 3, runtime, ...fontVerification });
  await writeJson(renderPathOut, {
    version: 3,
    revision: "contract-aligned-reference-v3",
    inputs: { path: relative(inputsPath), sha256: sha256(inputsBytes) },
    readsSourceChapter: false,
    runtime,
    font: {
      id: BENCHMARK_FONT_ID,
      cssFamily: BENCHMARK_FONT_CSS_FAMILY,
      family: fontAsset.family,
      postScriptName: fontAsset.postScriptName,
      path: fontAsset.path,
      sha256: fontAsset.sha256,
    },
    outputs,
  });

  const manifest = {
    version: 3,
    revision: "contract-aligned-renderer-v3",
    purpose:
      "Contract-aligned renderer comparison input. Reference and candidates consume the same frozen v3 page snapshots.",
    inputs: { path: relative(inputsPath), sha256: sha256(inputsBytes) },
    derivedFrom: inputs.derivedFrom,
    frozenFromChapter: inputs.frozenFromChapter,
    frozenBlockFields: inputs.frozenBlockFields,
    fontAssets: inputs.fontAssets,
    fontRoles: inputs.fontRoles,
    benchmarkFont: {
      id: BENCHMARK_FONT_ID,
      cssFamily: BENCHMARK_FONT_CSS_FAMILY,
    },
    referenceRuntime: runtime,
    verification: {
      render: fileRecord(renderPathOut),
      font: fileRecord(fontPathOut),
      layout: fileRecord(layoutPath),
    },
    fixtures: fixtures.map((fixture) => {
      const output = outputs.find(
        (item) => item.pageId === fixture.pageId,
      ).output;
      return {
        pageId: fixture.pageId,
        sourcePage: fixture.sourcePage,
        features: fixture.features,
        fontAssetIds: fixture.fontAssetIds,
        pageSnapshot: fixture.pageSnapshot,
        renderImage: fixture.renderImage,
        reference: {
          status: "rendered-from-frozen-v3-snapshot",
          ...output,
        },
      };
    }),
  };
  await writeJson(manifestV3Path, manifest);
  await fsp.rm(workDir, { recursive: true, force: true });
  console.log(`Created ${outputs.length} v3 references and manifest-v3`);
}

/** Loads the identical production page-export document and asks Chromium which faces it used. */
async function verifyFonts(fixtures, htmlSource) {
  const pages = [];
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  win.webContents.on(
    "did-fail-load",
    (_event, code, description, url, isMainFrame) => {
      console.error(
        `font-check load failure ${code} ${description} main=${isMainFrame} ${url.slice(0, 160)}`,
      );
    },
  );
  try {
    for (const fixture of fixtures) {
      const html = htmlSource.buildHtml(
        {
          id: fixture.page.id,
          name: fixture.page.name,
          width: fixture.page.width,
          height: fixture.page.height,
          blocks: fixture.page.blocks,
        },
        toDataUrl(fixture.imagePath),
        { width: fixture.page.width, height: fixture.page.height },
        {
          resolutionMode: "original",
          sourceSize: {
            width: fixture.page.width,
            height: fixture.page.height,
          },
        },
      );
      const htmlPath = path.join(workDir, `${fixture.pageId}.html`);
      fs.writeFileSync(htmlPath, html, { encoding: "utf8", flag: "wx" });
      await win.loadURL(pathToFileURL(htmlPath).toString());
      await waitForReady(win);
      const debuggerApi = win.webContents.debugger;
      debuggerApi.attach("1.3");
      try {
        await debuggerApi.sendCommand("DOM.enable");
        await debuggerApi.sendCommand("CSS.enable");
        const { root } = await debuggerApi.sendCommand("DOM.getDocument", {
          depth: -1,
          pierce: true,
        });
        const { nodeIds } = await debuggerApi.sendCommand(
          "DOM.querySelectorAll",
          {
            nodeId: root.nodeId,
            selector: FONT_SELECTOR,
          },
        );
        const fonts = new Map();
        for (const nodeId of nodeIds) {
          const result = await debuggerApi.sendCommand(
            "CSS.getPlatformFontsForNode",
            { nodeId },
          );
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
              font.familyName !== "Noto Sans CJK KR" ||
              font.postScriptName !== "NotoSansCJKkr-Regular" ||
              font.isCustomFont !== true,
          );
        if (fallbackDetected) {
          throw new Error(
            `Unexpected reference font: ${fixture.sourcePage} ${JSON.stringify(values)}`,
          );
        }
        pages.push({
          pageId: fixture.pageId,
          sourcePage: fixture.sourcePage,
          inspectedNodes: nodeIds.length,
          fonts: values,
        });
      } finally {
        debuggerApi.detach();
      }
    }
  } finally {
    win.destroy();
  }
  return {
    method:
      "Electron hidden window loading the identical production page-export HTML; CDP CSS.getPlatformFontsForNode on every leaf text span",
    unexpectedFallbacks: 0,
    pages,
  };
}

async function waitForReady(win) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const state = await win.webContents.executeJavaScript(
      "({ ready: document.body && document.body.dataset.ready, error: document.body && document.body.dataset.error })",
    );
    if (state.error) throw new Error(state.error);
    if (state.ready === "1") return;
    if (Date.now() > deadline)
      throw new Error("Page-export document did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function fileRecord(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    path: relative(filePath),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function repoPath(relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  const child = path.relative(repoRoot, resolved);
  if (!child || child.startsWith("..") || path.isAbsolute(child)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  return resolved;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function toDataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime =
    extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

function assertHash(filePath, expected, label) {
  if (!fs.existsSync(filePath))
    throw new Error(`Missing ${label}: ${filePath}`);
  const actual = sha256(fs.readFileSync(filePath));
  if (actual !== String(expected).toLowerCase())
    throw new Error(`${label} hash mismatch: ${actual}`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
