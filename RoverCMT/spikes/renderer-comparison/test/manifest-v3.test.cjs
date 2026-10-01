"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadManifestV3 } = require("../src/manifest-v3.cjs");
const {
  SOURCE_MATCH_CONTRACT_FIELDS,
  toProductionPageV3,
} = require("../src/production-page.cjs");

const spikeRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(spikeRoot, "../../..");
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

test("manifest-v3 binds eight complete references and required source-match fields", () => {
  const contract = loadManifestV3("fixtures/manifest-v3.json");
  assert.equal(contract.fixtures.length, 8);
  assert.equal(contract.readsSourceChapter, false);
  assert.equal(contract.font.version, "2.004");
  assert.equal(
    contract.font.sha256,
    "6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a",
  );
  for (const fixture of contract.fixtures) {
    assert.equal(fixture.reference.status, "rendered-from-frozen-v3-snapshot");
    for (const block of fixture.snapshot.blocks) {
      for (const field of SOURCE_MATCH_CONTRACT_FIELDS) {
        assert.equal(Object.hasOwn(block, field), true, `${block.id}/${field}`);
      }
    }
  }
});

test("v3 loading never reads the original chapter hidden state", () => {
  const inputs = JSON.parse(
    fs.readFileSync(path.join(spikeRoot, "fixtures", "inputs-v3.json"), "utf8"),
  );
  const chapterPath = path.resolve(repoRoot, inputs.frozenFromChapter.path);
  const reads = [];
  const originalRead = fs.readFileSync;
  fs.readFileSync = function observedRead(filePath, ...args) {
    reads.push(path.resolve(String(filePath)));
    return originalRead.call(this, filePath, ...args);
  };
  try {
    loadManifestV3("fixtures/manifest-v3.json");
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.equal(reads.includes(chapterPath), false);
});

test("v3 remains bound to the untouched v2 manifest and portable font", () => {
  const inputs = JSON.parse(
    fs.readFileSync(path.join(spikeRoot, "fixtures", "inputs-v3.json"), "utf8"),
  );
  const v2Bytes = fs.readFileSync(
    path.resolve(repoRoot, inputs.derivedFrom.path),
  );
  assert.equal(sha256(v2Bytes), inputs.derivedFrom.sha256);
  const v2 = JSON.parse(v2Bytes.toString("utf8"));
  const v3 = loadManifestV3("fixtures/manifest-v3.json").manifest;
  assert.deepEqual(v3.fontAssets, v2.fontAssets);
  assert.deepEqual(v3.fontRoles, v2.fontRoles);
});

test("canonical page conversion uses only frozen v3 values", () => {
  const fixture = loadManifestV3("fixtures/manifest-v3.json").fixtures[0];
  const page = toProductionPageV3(fixture.snapshot, fixture.imagePath);
  assert.equal(page.id, fixture.pageId);
  assert.equal(page.imagePath, fixture.imagePath);
  assert.equal(page.blocks.length, fixture.snapshot.blocks.length);
  assert.equal(
    page.blocks[0].sourceText,
    fixture.snapshot.blocks[0].sourceText,
  );
});
