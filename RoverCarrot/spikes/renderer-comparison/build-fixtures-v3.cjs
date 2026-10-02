// @ts-check
"use strict";

/**
 * One-time freezer for the contract-aligned (v3) renderer fixtures.
 *
 * This is the ONLY v3 step that reads the source chapter. It copies the
 * manifest-v2 page snapshots and adds exactly the block fields that the
 * production layout path consumes (see src/production-page.cjs). Every later
 * v3 step (Electron reference, Skia, Playwright) reads only these outputs.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { SOURCE_MATCH_CONTRACT_FIELDS } = require("./src/production-page.cjs");

const spikeRoot = __dirname;
const repoRoot = path.resolve(spikeRoot, "../../..");
const manifestV2Path = path.join(spikeRoot, "fixtures", "manifest-v2.json");
const pagesV3Dir = path.join(spikeRoot, "fixtures", "pages-v3");
const inputsV3Path = path.join(spikeRoot, "fixtures", "inputs-v3.json");

function main() {
  if (fs.existsSync(pagesV3Dir) || fs.existsSync(inputsV3Path)) {
    throw new Error("Refusing to overwrite existing v3 fixture inputs");
  }
  const manifestV2Bytes = fs.readFileSync(manifestV2Path);
  const manifestV2 = JSON.parse(manifestV2Bytes.toString("utf8"));
  if (manifestV2.version !== 2) throw new Error("Expected manifest-v2");
  const chapterPath = repoPath(manifestV2.sourceChapter.chapter);
  assertHash(
    chapterPath,
    manifestV2.sourceChapter.chapterSha256,
    "source chapter",
  );
  const chapter = JSON.parse(fs.readFileSync(chapterPath, "utf8"));
  const pagesById = new Map(chapter.pages.map((page) => [page.id, page]));

  fs.mkdirSync(pagesV3Dir, { recursive: true });
  const fixtures = manifestV2.fixtures.map((fixture) => {
    const v2Path = repoPath(fixture.pageSnapshot.path);
    assertHash(
      v2Path,
      fixture.pageSnapshot.sha256,
      `${fixture.sourcePage} v2 snapshot`,
    );
    const v2 = JSON.parse(fs.readFileSync(v2Path, "utf8"));
    const page = pagesById.get(fixture.pageId);
    if (!page) throw new Error(`Chapter page missing: ${fixture.pageId}`);
    const chapterBlocks = new Map(
      page.blocks.map((block) => [block.id, block]),
    );
    const snapshot = {
      version: 3,
      derivedFromSnapshotSha256: fixture.pageSnapshot.sha256,
      sourcePageId: v2.sourcePageId,
      sourcePageName: v2.sourcePageName,
      width: v2.width,
      height: v2.height,
      blockOrder: v2.blockOrder,
      blocks: v2.blocks.map((block) => {
        const source = chapterBlocks.get(block.id);
        if (!source) throw new Error(`Chapter block missing: ${block.id}`);
        const frozen = { ...block };
        for (const field of SOURCE_MATCH_CONTRACT_FIELDS) {
          frozen[field] = source[field] === undefined ? null : source[field];
        }
        return frozen;
      }),
    };
    const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    const outputPath = path.join(pagesV3Dir, `${fixture.pageId}.json`);
    fs.writeFileSync(outputPath, bytes, { flag: "wx" });
    return {
      pageId: fixture.pageId,
      sourcePage: fixture.sourcePage,
      features: fixture.features,
      fontAssetIds: fixture.fontAssetIds,
      pageSnapshot: {
        path: relative(outputPath),
        bytes: bytes.length,
        sha256: sha256(bytes),
      },
      renderImage: fixture.renderImage,
    };
  });

  const inputs = {
    version: 3,
    revision: "contract-aligned-inputs-v3",
    derivedFrom: {
      path: relative(manifestV2Path),
      sha256: sha256(manifestV2Bytes),
    },
    frozenFromChapter: {
      path: manifestV2.sourceChapter.chapter,
      sha256: manifestV2.sourceChapter.chapterSha256,
      note: "Read once by build-fixtures-v3.cjs; renderers never read it.",
    },
    frozenBlockFields: [...SOURCE_MATCH_CONTRACT_FIELDS],
    fontAssets: manifestV2.fontAssets,
    fontRoles: manifestV2.fontRoles,
    fixtures,
  };
  fs.writeFileSync(inputsV3Path, `${JSON.stringify(inputs, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  console.log(`Froze ${fixtures.length} v3 page snapshots`);
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

function assertHash(filePath, expected, label) {
  const actual = sha256(fs.readFileSync(filePath));
  if (actual !== String(expected).toLowerCase()) {
    throw new Error(`${label} hash mismatch: ${actual}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

main();
