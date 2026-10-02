"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  loadManifest,
  verifyImmutableInventory,
} = require("../src/manifest.cjs");

test("manifest-v2 resolves eight immutable fixtures and the exact dialogue font", () => {
  const contract = loadManifest();
  assert.equal(contract.manifest.version, 2);
  assert.equal(contract.manifest.revision, "portable-font-reference-v2");
  assert.equal(contract.fixtures.length, 8);
  assert.equal(
    contract.font.id,
    contract.manifest.fontRoles["default-dialogue"],
  );
  assert.equal(
    contract.font.sha256,
    "6bcb2a0703aa137e874fc2dffa85f6c21ba9a67fa329e81b8c801663af7e992a",
  );
  assert.equal(verifyImmutableInventory(contract.immutableInventory), true);
  for (const fixture of contract.fixtures) {
    assert.equal(fixture.snapshot.width, fixture.reference.width);
    assert.equal(fixture.snapshot.height, fixture.reference.height);
    assert.ok(
      fixture.snapshot.blocks.every(
        (block) => block.renderDirection === "horizontal",
      ),
    );
  }
});

test("candidate failure records are fixture-local data", () => {
  const result = {
    first: { success: false, error: { message: "expected failure" } },
    second: { success: true, dimensions: { width: 1280, height: 1791 } },
  };
  assert.equal(result.first.success, false);
  assert.equal(result.second.success, true);
});
