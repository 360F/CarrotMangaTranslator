"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");

const spikeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(spikeRoot, "../../..");
const manifestPath = path.join(spikeRoot, "fixtures", "manifest-v2.json");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function resolveRepoPath(relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath)) {
    throw new Error(`Expected repository-relative path: ${relativePath}`);
  }
  const resolved = path.resolve(repoRoot, relativePath);
  const child = path.relative(repoRoot, resolved);
  if (!child || child.startsWith("..") || path.isAbsolute(child)) {
    throw new Error(`Path escapes repository: ${relativePath}`);
  }
  return resolved;
}

function assertFile(record, label) {
  const filePath = resolveRepoPath(record.path);
  if (!fs.existsSync(filePath))
    throw new Error(`Missing ${label}: ${filePath}`);
  const bytes = fs.readFileSync(filePath);
  const actual = sha256(bytes);
  if (actual !== String(record.sha256).toLowerCase()) {
    throw new Error(
      `${label} hash mismatch: expected ${record.sha256}, got ${actual}`,
    );
  }
  if (record.bytes !== undefined && bytes.length !== record.bytes) {
    throw new Error(
      `${label} byte-size mismatch: expected ${record.bytes}, got ${bytes.length}`,
    );
  }
  return { path: filePath, bytes: bytes.length, sha256: actual };
}

function assertPng(record, label) {
  const verified = assertFile(record, label);
  const decoded = PNG.sync.read(fs.readFileSync(verified.path));
  if (decoded.width !== record.width || decoded.height !== record.height) {
    throw new Error(
      `${label} dimensions mismatch: expected ${record.width}x${record.height}, got ${decoded.width}x${decoded.height}`,
    );
  }
  return { ...verified, width: decoded.width, height: decoded.height };
}

function loadManifest() {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest.version !== 2 ||
    manifest.revision !== "portable-font-reference-v2"
  ) {
    throw new Error(
      `Unsupported manifest contract: ${manifest.version}/${manifest.revision}`,
    );
  }
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 8) {
    throw new Error("Expected exactly 8 comparison fixtures");
  }
  const roleId = manifest.fontRoles?.["default-dialogue"];
  const font = manifest.fontAssets?.find((asset) => asset.id === roleId);
  if (!font) throw new Error("default-dialogue font asset is missing");

  const inventory = new Map();
  const remember = (record, label, png = false) => {
    const value = png ? assertPng(record, label) : assertFile(record, label);
    inventory.set(record.path, value.sha256);
    return value;
  };
  remember(manifest.derivedFrom, "derived manifest v1");
  remember(
    {
      path: manifest.sourceChapter.chapter,
      sha256: manifest.sourceChapter.chapterSha256,
    },
    "source chapter",
  );
  const fontFile = remember(font, "portable benchmark font");
  remember(font.license, "portable benchmark font license");
  remember(manifest.verification.render, "reference render verification");
  remember(manifest.verification.font, "reference font verification");

  const fixtures = manifest.fixtures.map((fixture) => {
    const snapshotFile = remember(
      fixture.pageSnapshot,
      `${fixture.sourcePage} snapshot`,
    );
    const imageFile = remember(
      fixture.renderImage,
      `${fixture.sourcePage} render image`,
    );
    const referenceFile = remember(
      fixture.reference,
      `${fixture.sourcePage} reference`,
      true,
    );
    if (
      fixture.renderImage.width !== fixture.reference.width ||
      fixture.renderImage.height !== fixture.reference.height
    ) {
      throw new Error(
        `${fixture.sourcePage} input/reference dimensions differ`,
      );
    }
    if (!fixture.fontAssetIds?.includes(font.id)) {
      throw new Error(
        `${fixture.sourcePage} does not bind the default-dialogue font`,
      );
    }
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile.path, "utf8"));
    if (
      snapshot.sourcePageId !== fixture.pageId ||
      snapshot.width !== fixture.reference.width ||
      snapshot.height !== fixture.reference.height
    ) {
      throw new Error(`${fixture.sourcePage} snapshot identity mismatch`);
    }
    return {
      ...fixture,
      snapshot,
      snapshotPath: snapshotFile.path,
      imagePath: imageFile.path,
      referencePath: referenceFile.path,
    };
  });

  return {
    manifest,
    manifestPath,
    manifestSha256: sha256(manifestBytes),
    repoRoot,
    spikeRoot,
    font: { ...font, filePath: fontFile.path },
    fixtures,
    immutableInventory: Object.fromEntries([...inventory.entries()].sort()),
  };
}

function verifyImmutableInventory(inventory) {
  const changes = [];
  for (const [relativePath, expected] of Object.entries(inventory)) {
    const filePath = resolveRepoPath(relativePath);
    const actual = fs.existsSync(filePath)
      ? sha256(fs.readFileSync(filePath))
      : null;
    if (actual !== expected)
      changes.push({ path: relativePath, expected, actual });
  }
  if (changes.length > 0) {
    throw new Error(
      `Immutable fixture/reference assets changed: ${JSON.stringify(changes)}`,
    );
  }
  return true;
}

module.exports = {
  assertPng,
  loadManifest,
  manifestPath,
  repoRoot,
  resolveRepoPath,
  sha256,
  spikeRoot,
  verifyImmutableInventory,
};
