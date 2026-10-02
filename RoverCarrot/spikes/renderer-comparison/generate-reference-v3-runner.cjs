// @ts-check
"use strict";

/**
 * Runs the Electron reference generator and removes its isolated profile only
 * after Electron has exited. Chromium keeps profile files locked until then on
 * Windows, so cleanup cannot reliably happen inside the Electron process.
 */

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const spikeRoot = __dirname;
const repoRoot = path.resolve(spikeRoot, "../../..");
const generatorPath = path.join(spikeRoot, "generate-reference-v3.cjs");
const userDataDir = path.join(spikeRoot, ".reference-v3-electron-user-data");
const electronPath = require("electron");

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const result = childProcess.spawnSync(electronPath, [generatorPath], {
  cwd: repoRoot,
  env: environment,
  stdio: "inherit",
  windowsHide: true,
});

let cleanupError = null;
try {
  fs.rmSync(userDataDir, { recursive: true, force: true });
} catch (error) {
  cleanupError = error;
}

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `Electron reference-v3 generator exited with ${result.status}`,
  );
}
if (cleanupError) throw cleanupError;

console.log("Removed isolated reference-v3 Electron profile");
