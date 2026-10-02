// @ts-check
const { app, nativeImage } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const spikeRoot = __dirname;
const repoRoot = path.resolve(spikeRoot, "../../..");
const manifestPath = path.join(spikeRoot, "fixtures", "manifest.json");
const fontRelativePath = "RoverCarrot/spikes/renderer-comparison/assets/fonts/noto-sans-cjk-kr-2.004/NotoSansCJKkr-Regular.otf";
const fontPath = path.join(repoRoot, fontRelativePath);
const referenceDir = path.join(spikeRoot, "reference-v2-noto-sans-cjk-kr-2.004");
const workDir = path.join(referenceDir, ".work");
const fontId = "benchmark-noto-sans-cjk-kr-regular-2-004";
const fontFamily = "Rover Benchmark Noto Sans CJK KR";
const fontHash = "6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.setPath("userData", path.join(spikeRoot, ".reference-v2-electron-user-data"));

void app.whenReady().then(run).then(() => app.exit(0), (error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  app.exit(1);
});

async function run() {
  if (fs.existsSync(referenceDir)) throw new Error(`Refusing to overwrite ${referenceDir}`);
  fs.mkdirSync(workDir, { recursive: true });
  assertHash(fontPath, fontHash, "portable font");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const chapterPath = path.join(repoRoot, manifest.generatedFrom.chapter);
  assertHash(chapterPath, manifest.generatedFrom.chapterSha256, "source chapter");
  const chapter = JSON.parse(fs.readFileSync(chapterPath, "utf8"));
  const fixturesByImage = new Map();
  for (const fixture of manifest.fixtures) {
    const snapshotPath = path.join(repoRoot, fixture.pageSnapshot.path);
    const imagePath = path.join(repoRoot, fixture.renderImage.path);
    assertHash(snapshotPath, fixture.pageSnapshot.sha256, `${fixture.sourcePage} snapshot`);
    assertHash(imagePath, fixture.renderImage.sha256, `${fixture.sourcePage} image`);
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const page = chapter.pages.find((candidate) => candidate.id === fixture.pageId);
    if (!page || page.name !== fixture.sourcePage || page.width !== snapshot.width || page.height !== snapshot.height) throw new Error(`Page identity mismatch: ${fixture.sourcePage}`);
    if (JSON.stringify(page.blocks.map((block) => block.id)) !== JSON.stringify(snapshot.blockOrder)) throw new Error(`Block order mismatch: ${fixture.sourcePage}`);
    fixturesByImage.set(path.resolve(imagePath), fixture);
  }
  const { createPageExportRenderSession } = require(path.join(repoRoot, "out", "main", "pageExport.js"));
  const { createPageExportHtmlSource } = require(path.join(repoRoot, "out", "main", "pageExportHtml.js"));
  const htmlSource = createPageExportHtmlSource({
    assetDirectories: () => [path.join(repoRoot, "out", "page-export")],
    rendererStylesheet: () => pathToFileURL(path.join(repoRoot, "src", "renderer", "src", "styles.css")).toString(),
    fonts: {
      list: () => [{ id: fontId, label: "Noto Sans CJK KR Regular 2.004", family: fontFamily, fileName: path.basename(fontPath) }],
      readPreferences: () => ({ favoriteIds: [], orderedIds: [], hiddenIds: [], defaultFontId: fontId }),
      resolveFilePath: (id) => id === fontId ? fontPath : null,
    },
  });
  const session = await createPageExportRenderSession({
    dataRoot: workDir,
    decodeFallback: async () => null,
    htmlSource,
    probeImageSize: async (imagePath) => {
      const fixture = fixturesByImage.get(path.resolve(imagePath));
      if (!fixture) throw new Error(`Unexpected image probe: ${imagePath}`);
      return { width: fixture.renderImage.width, height: fixture.renderImage.height };
    },
    resolveImageUrl: (imagePath) => {
      const fixture = fixturesByImage.get(path.resolve(imagePath));
      if (!fixture) throw new Error(`Unexpected image request: ${imagePath}`);
      return toDataUrl(imagePath);
    },
  });
  const outputs = [];
  try {
    for (const fixture of manifest.fixtures) {
      console.log(`Rendering ${fixture.sourcePage}`);
      const page = chapter.pages.find((candidate) => candidate.id === fixture.pageId);
      const png = await session.renderPage(page);
      const decoded = nativeImage.createFromBuffer(png);
      if (decoded.isEmpty()) throw new Error(`PNG decode failed: ${page.name}`);
      const size = decoded.getSize();
      if (size.width !== page.width || size.height !== page.height) throw new Error(`Dimension mismatch: ${page.name}`);
      const outputName = `${path.parse(page.name).name}.png`;
      const outputPath = path.join(referenceDir, outputName);
      await fsp.writeFile(outputPath, png, { flag: "wx" });
      outputs.push({ pageId: page.id, sourcePage: page.name, snapshotSha256: fixture.pageSnapshot.sha256, renderImageSha256: fixture.renderImage.sha256, output: { path: path.relative(repoRoot, outputPath).replaceAll(path.sep, "/"), format: "PNG", width: size.width, height: size.height, bytes: png.length, sha256: sha256(png) } });
    }
  } finally {
    session.close();
  }
  const result = { version: 1, revision: "portable-font-reference-v2", derivedFrom: "RoverCarrot/spikes/renderer-comparison/fixtures/manifest.json", runtime: { electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch }, font: { id: fontId, family: "Noto Sans CJK KR", cssFamily: fontFamily, postScriptName: "NotoSansCJKkr-Regular", path: fontRelativePath, format: "OTF", sha256: fontHash }, outputs };
  await fsp.writeFile(path.join(referenceDir, "render-verification.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fsp.rm(workDir, { recursive: true, force: true });
  await fsp.rm(path.join(spikeRoot, ".reference-v2-electron-user-data"), { recursive: true, force: true });
  console.log(`Created ${outputs.length} PNG references`);
}

function toDataUrl(filePath) { const ext=path.extname(filePath).toLowerCase();const mime=ext===".jpg"||ext===".jpeg"?"image/jpeg":ext===".webp"?"image/webp":"image/png";return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`; }
function assertHash(filePath, expected, label) { if (!fs.existsSync(filePath)) throw new Error(`Missing ${label}: ${filePath}`); const actual=sha256(fs.readFileSync(filePath));if(actual!==String(expected).toLowerCase())throw new Error(`${label} hash mismatch: ${actual}`); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
