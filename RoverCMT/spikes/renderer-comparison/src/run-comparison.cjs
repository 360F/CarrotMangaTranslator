"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PNG } = require("pngjs");
const {
  loadManifest,
  sha256,
  verifyImmutableInventory: verifyImmutableInventoryV2,
} = require("./manifest.cjs");
const {
  loadManifestV3,
  verifyImmutableInventory: verifyImmutableInventoryV3,
} = require("./manifest-v3.cjs");
const {
  createNodeCanvasAdapter,
  createSkiaAdapter,
} = require("./native-adapters.cjs");
const { createPlaywrightAdapter } = require("./playwright-adapter.cjs");
const { createVisualReport } = require("./visual-report.cjs");

let contract;
let verifyImmutableInventory;

const factories = [
  ["skia-canvas", createSkiaAdapter],
  ["node-canvas", createNodeCanvasAdapter],
  ["playwright-chromium", createPlaywrightAdapter],
];

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const isV3 = Boolean(options.manifest);
  contract = isV3 ? loadManifestV3(options.manifest) : loadManifest();
  verifyImmutableInventory = isV3
    ? verifyImmutableInventoryV3
    : verifyImmutableInventoryV2;
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(
    contract.spikeRoot,
    ".playwright-browsers",
  );
  const fixtures = options.fixture
    ? contract.fixtures.filter(
        (fixture) => fixture.sourcePage === options.fixture,
      )
    : contract.fixtures;
  if (fixtures.length === 0)
    throw new Error(`Unknown fixture: ${options.fixture}`);
  const selectedIds =
    options.candidates ?? (options.candidate ? [options.candidate] : null);
  const selectedFactories = selectedIds
    ? factories.filter(([id]) => selectedIds.includes(id))
    : factories;
  if (
    selectedFactories.length === 0 ||
    (selectedIds && selectedFactories.length !== new Set(selectedIds).size)
  ) {
    throw new Error(`Unknown candidate selection: ${selectedIds?.join(",")}`);
  }

  const outputRoot = path.join(contract.spikeRoot, "outputs");
  const runName =
    options.output ||
    `run-${new Date().toISOString().replaceAll(":", "-").replace(".", "-")}`;
  const runDirectory = path.resolve(outputRoot, runName);
  const child = path.relative(outputRoot, runDirectory);
  if (!child || child.startsWith("..") || path.isAbsolute(child)) {
    throw new Error(`Output must be a new child of ${outputRoot}`);
  }
  if (fs.existsSync(runDirectory))
    throw new Error(`Refusing to overwrite ${runDirectory}`);
  const workDir = path.join(runDirectory, ".work");
  fs.mkdirSync(workDir, { recursive: true });

  const runResult = {
    schemaVersion: 1,
    purpose:
      "Renderer Comparison Spike; no renderer winner or production architecture decision",
    startedAt: new Date().toISOString(),
    completedAt: null,
    runDirectory,
    manifest: {
      path: path
        .relative(contract.repoRoot, contract.manifestPath)
        .replaceAll(path.sep, "/"),
      sha256: contract.manifestSha256,
      version: contract.manifest.version,
      revision: contract.manifest.revision,
    },
    environment: environmentMetadata(),
    measurement: {
      clock: "performance.now monotonic milliseconds",
      coldStart:
        "dynamic package load, native font registration or browser launch/connect",
      firstPage: "first fixture render after candidate initialization",
      warmPages:
        "remaining fixture renders in the same candidate process/session",
      multiPageTotal:
        "sum of per-page render durations; excludes visual diff/report generation",
      nativeMemory:
        "current Node process RSS sampled before/after blocks; synchronous peaks between samples may be missed",
      playwrightMemory:
        "driver RSS before/after plus browser process-tree RSS observed after each render on Windows; not a sampled true peak",
      timeoutMs: options.timeoutMs,
    },
    immutableInputsVerifiedBefore: true,
    immutableInputsVerifiedAfter: false,
    candidates: [],
    fixtures: fixtures.map((fixture) => ({
      pageId: fixture.pageId,
      sourcePage: fixture.sourcePage,
      width: fixture.reference.width,
      height: fixture.reference.height,
      features: fixture.features,
      reference: fixture.reference,
      candidates: {},
    })),
    contractAlignment: isV3
      ? {
          canonicalInputs: contract.canonicalInputs,
          candidatesReadSourceChapter: contract.readsSourceChapter,
        }
      : null,
    visualComparison: null,
  };

  try {
    for (const [candidateId, factory] of selectedFactories) {
      await executeCandidate(
        candidateId,
        factory,
        fixtures,
        runDirectory,
        workDir,
        runResult,
        options.timeoutMs,
      );
    }
    verifyImmutableInventory(contract.immutableInventory);
    runResult.immutableInputsVerifiedAfter = true;
    runResult.completedAt = new Date().toISOString();
    runResult.visualComparison = createVisualReport(
      runDirectory,
      { ...contract, fixtures },
      runResult,
    );
    fs.writeFileSync(
      path.join(runDirectory, "run.json"),
      `${JSON.stringify(runResult, null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  console.log(`Renderer comparison completed: ${runDirectory}`);
  console.log(
    `Human review: ${path.join(runDirectory, runResult.visualComparison.html)}`,
  );
}

async function executeCandidate(
  candidateId,
  factory,
  fixtures,
  runDirectory,
  workDir,
  runResult,
  timeoutMs,
) {
  const candidateDirectory = path.join(runDirectory, "candidates", candidateId);
  fs.mkdirSync(candidateDirectory, { recursive: true });
  const candidateSummary = {
    id: candidateId,
    initialized: false,
    coldStartMs: null,
    runtime: null,
    font: null,
    firstPageRenderMs: null,
    warmPageRenderMs: [],
    warmPageMeanMs: null,
    multiPageTotalMs: 0,
    successes: 0,
    failures: 0,
    initializationError: null,
  };
  runResult.candidates.push(candidateSummary);
  let adapter;
  try {
    adapter = await factory({ ...contract, workDir });
    candidateSummary.initialized = true;
    candidateSummary.coldStartMs = adapter.coldStartMs;
    candidateSummary.runtime = adapter.runtime;
    candidateSummary.font = adapter.font;
  } catch (error) {
    candidateSummary.initializationError = serializeError(error);
    candidateSummary.failures = fixtures.length;
    for (const fixture of fixtures) {
      runResult.fixtures.find(
        (item) => item.pageId === fixture.pageId,
      ).candidates[candidateId] = {
        success: false,
        error: serializeError(error),
      };
    }
    return;
  }

  const metadata = [];
  try {
    for (const [index, fixture] of fixtures.entries()) {
      const destination = path.join(
        candidateDirectory,
        `${path.parse(fixture.sourcePage).name}.png`,
      );
      const fixtureEntry = runResult.fixtures.find(
        (item) => item.pageId === fixture.pageId,
      );
      try {
        const rendered = await withTimeout(
          adapter.render(fixture),
          timeoutMs,
          `${candidateId}/${fixture.sourcePage}`,
        );
        const decoded = PNG.sync.read(rendered.png);
        if (
          decoded.width !== fixture.reference.width ||
          decoded.height !== fixture.reference.height
        ) {
          throw new Error(
            `Expected ${fixture.reference.width}x${fixture.reference.height}, got ${decoded.width}x${decoded.height}`,
          );
        }
        fs.writeFileSync(destination, rendered.png, { flag: "wx" });
        const result = {
          success: true,
          outputPath: path
            .relative(runDirectory, destination)
            .replaceAll(path.sep, "/"),
          dimensions: { width: decoded.width, height: decoded.height },
          bytes: rendered.png.length,
          sha256: sha256(rendered.png),
          durationMs: rendered.durationMs,
          memory: rendered.memory,
          font: rendered.fontEvidence
            ? { ...adapter.font, ...rendered.fontEvidence }
            : adapter.font,
          layoutEvidence: rendered.layoutEvidence,
          consoleErrors: rendered.consoleErrors || [],
        };
        fixtureEntry.candidates[candidateId] = result;
        metadata.push({
          pageId: fixture.pageId,
          sourcePage: fixture.sourcePage,
          ...result,
        });
        candidateSummary.successes += 1;
        candidateSummary.multiPageTotalMs += rendered.durationMs;
        if (index === 0)
          candidateSummary.firstPageRenderMs = rendered.durationMs;
        else candidateSummary.warmPageRenderMs.push(rendered.durationMs);
        console.log(
          `${candidateId} ${fixture.sourcePage}: ${rendered.durationMs.toFixed(1)} ms`,
        );
      } catch (error) {
        const result = { success: false, error: serializeError(error) };
        fixtureEntry.candidates[candidateId] = result;
        metadata.push({
          pageId: fixture.pageId,
          sourcePage: fixture.sourcePage,
          ...result,
        });
        candidateSummary.failures += 1;
        console.error(
          `${candidateId} ${fixture.sourcePage}: ${result.error.message}`,
        );
      }
    }
  } finally {
    await adapter.close().catch((error) => {
      candidateSummary.closeError = serializeError(error);
    });
  }
  candidateSummary.warmPageMeanMs = mean(candidateSummary.warmPageRenderMs);
  fs.writeFileSync(
    path.join(candidateDirectory, "metadata.json"),
    `${JSON.stringify(
      {
        candidate: candidateSummary,
        fixtures: metadata,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

function parseArguments(args) {
  const result = {
    output: null,
    fixture: null,
    candidate: null,
    candidates: null,
    manifest: null,
    timeoutMs: 60_000,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--output") result.output = args[++index];
    else if (value === "--fixture") result.fixture = args[++index];
    else if (value === "--candidate") result.candidate = args[++index];
    else if (value === "--candidates") {
      result.candidates = String(args[++index] ?? "")
        .split(",")
        .map((candidate) => candidate.trim())
        .filter(Boolean);
    } else if (value === "--manifest") result.manifest = args[++index];
    else if (value === "--timeout-ms") result.timeoutMs = Number(args[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (result.candidate && result.candidates)
    throw new Error("Use only one of --candidate or --candidates");
  if (result.candidates && result.candidates.length === 0)
    throw new Error("Invalid --candidates");
  if (!Number.isFinite(result.timeoutMs) || result.timeoutMs <= 0)
    throw new Error("Invalid --timeout-ms");
  return result;
}

function environmentMetadata() {
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    node: process.versions.node,
    cpu: os.cpus()[0]?.model || null,
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    gitCommit: gitValue(["rev-parse", "HEAD"]),
    gitDirtyAtStart: Boolean(gitValue(["status", "--porcelain"])),
  };
}

function gitValue(args) {
  try {
    return childProcess
      .execFileSync("git", args, {
        cwd: contract.repoRoot,
        encoding: "utf8",
        windowsHide: true,
      })
      .trim();
  } catch (error) {
    void error;
    return null;
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function serializeError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}
