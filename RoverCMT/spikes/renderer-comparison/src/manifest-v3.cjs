"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const {
  SOURCE_MATCH_CONTRACT_FIELDS,
  assertV3Snapshot,
} = require("./production-page.cjs");

const spikeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(spikeRoot, "../../..");

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

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
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

function loadManifestV3(manifestArgument = "fixtures/manifest-v3.json") {
  const selectedManifestPath =
    manifestArgument.includes("/") || manifestArgument.includes("\\")
      ? path.resolve(spikeRoot, manifestArgument)
      : path.join(spikeRoot, "fixtures", manifestArgument);
  const manifestRelative = relative(selectedManifestPath);
  const manifestPath = resolveRepoPath(manifestRelative);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest.version !== 3 ||
    manifest.revision !== "contract-aligned-renderer-v3"
  ) {
    throw new Error(
      `Unsupported v3 manifest contract: ${manifest.version}/${manifest.revision}`,
    );
  }
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 8) {
    throw new Error("Expected exactly 8 v3 comparison fixtures");
  }
  if (
    JSON.stringify(manifest.frozenBlockFields) !==
    JSON.stringify(SOURCE_MATCH_CONTRACT_FIELDS)
  ) {
    throw new Error(
      "manifest-v3 frozen block fields do not match the renderer contract",
    );
  }

  const inventory = new Map([[manifestRelative, sha256(manifestBytes)]]);
  const remember = (record, label, png = false) => {
    const value = png ? assertPng(record, label) : assertFile(record, label);
    inventory.set(record.path, value.sha256);
    return value;
  };

  const inputsFile = remember(manifest.inputs, "canonical inputs-v3");
  const inputs = JSON.parse(fs.readFileSync(inputsFile.path, "utf8"));
  if (
    inputs.version !== 3 ||
    inputs.revision !== "contract-aligned-inputs-v3"
  ) {
    throw new Error("Expected canonical inputs-v3");
  }
  if (!Array.isArray(inputs.fixtures) || inputs.fixtures.length !== 8) {
    throw new Error("Expected exactly 8 canonical inputs-v3 fixtures");
  }
  if (
    JSON.stringify(inputs.frozenBlockFields) !==
    JSON.stringify(SOURCE_MATCH_CONTRACT_FIELDS)
  ) {
    throw new Error(
      "inputs-v3 frozen block fields do not match the renderer contract",
    );
  }

  const roleId = manifest.fontRoles?.["default-dialogue"];
  const font = manifest.fontAssets?.find((asset) => asset.id === roleId);
  if (!font) throw new Error("default-dialogue font asset is missing");
  const fontFile = remember(font, "portable benchmark font");
  remember(font.license, "portable benchmark font license");
  remember(manifest.verification.render, "reference-v3 render verification");
  remember(manifest.verification.font, "reference-v3 font verification");
  remember(manifest.verification.layout, "reference-v3 layout evidence");

  const inputFixtures = new Map(
    inputs.fixtures.map((fixture) => [fixture.pageId, fixture]),
  );
  const fixtures = manifest.fixtures.map((fixture) => {
    const canonical = inputFixtures.get(fixture.pageId);
    if (
      !canonical ||
      JSON.stringify(canonical.pageSnapshot) !==
        JSON.stringify(fixture.pageSnapshot) ||
      JSON.stringify(canonical.renderImage) !==
        JSON.stringify(fixture.renderImage)
    ) {
      throw new Error(
        `${fixture.sourcePage} is not bound to the canonical inputs-v3 record`,
      );
    }
    const snapshotFile = remember(
      fixture.pageSnapshot,
      `${fixture.sourcePage} v3 snapshot`,
    );
    const imageFile = remember(
      fixture.renderImage,
      `${fixture.sourcePage} render image`,
    );
    const referenceFile = remember(
      fixture.reference,
      `${fixture.sourcePage} reference-v3`,
      true,
    );
    if (fixture.reference.status !== "rendered-from-frozen-v3-snapshot") {
      throw new Error(
        `${fixture.sourcePage} reference-v3 status is not complete`,
      );
    }
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
    assertV3Snapshot(snapshot);
    if (
      snapshot.sourcePageId !== fixture.pageId ||
      snapshot.width !== fixture.reference.width ||
      snapshot.height !== fixture.reference.height
    ) {
      throw new Error(`${fixture.sourcePage} v3 snapshot identity mismatch`);
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
    canonicalInputs: {
      path: manifest.inputs.path,
      sha256: manifest.inputs.sha256,
    },
    readsSourceChapter: false,
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
  if (changes.length)
    throw new Error(`Immutable v3 inputs changed: ${JSON.stringify(changes)}`);
  return true;
}

module.exports = {
  loadManifestV3,
  verifyImmutableInventory,
};
