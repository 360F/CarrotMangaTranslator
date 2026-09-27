import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDefaultAppSettings } from "../src/main/appSettings";
import { normalizeUiSettings } from "../src/main/settings/appSettingsUiNormalize";
import { UiSettingsSchema } from "../src/shared/ipcUiSettingsSchema";
import {
  resolveAvailableRoverDefaultDirectory,
  resolveImportDialogDefaultPathFromSettings,
} from "../src/main/roverDefaultDirectories";
import {
  recentDialogPathKeys,
  rememberRecentDialogDirectory,
} from "../src/main/recentDialogPaths";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Rover default directories", () => {
  it("keeps the existing recent-path behavior while the opt-in is off", async () => {
    const dataRoot = await makeTempDir("data");
    const recent = await makeTempDir("recent");
    const configured = await makeTempDir("configured");
    rememberRecentDialogDirectory(
      dataRoot,
      recentDialogPathKeys.imageImport,
      recent,
    );
    const settings = resolveDefaultAppSettings();
    settings.ui = {
      ...settings.ui,
      roverDefaultDirectories: {
        enabled: false,
        inputDirectory: configured,
        outputDirectory: configured,
      },
    };

    await expect(
      resolveImportDialogDefaultPathFromSettings(
        settings,
        dataRoot,
        recentDialogPathKeys.imageImport,
      ),
    ).resolves.toBe(recent);
    await expect(
      resolveAvailableRoverDefaultDirectory(settings, "outputDirectory"),
    ).resolves.toBeNull();
  });

  it("uses configured directories only when they are enabled and available", async () => {
    const dataRoot = await makeTempDir("data");
    const recent = await makeTempDir("recent");
    const configured = await makeTempDir("configured");
    rememberRecentDialogDirectory(
      dataRoot,
      recentDialogPathKeys.pdfImport,
      recent,
    );
    const settings = resolveDefaultAppSettings();
    settings.ui = {
      ...settings.ui,
      roverDefaultDirectories: {
        enabled: true,
        inputDirectory: configured,
        outputDirectory: configured,
      },
    };

    await expect(
      resolveImportDialogDefaultPathFromSettings(
        settings,
        dataRoot,
        recentDialogPathKeys.pdfImport,
      ),
    ).resolves.toBe(resolve(configured));
    await expect(
      resolveAvailableRoverDefaultDirectory(settings, "outputDirectory"),
    ).resolves.toBe(resolve(configured));
  });

  it("falls back to the recent path for missing, relative, or non-directory inputs", async () => {
    const dataRoot = await makeTempDir("data");
    const recent = await makeTempDir("recent");
    const filePath = join(await makeTempDir("file-parent"), "not-a-folder");
    await writeFile(filePath, "file");
    rememberRecentDialogDirectory(
      dataRoot,
      recentDialogPathKeys.archiveImport,
      recent,
    );
    const settings = resolveDefaultAppSettings();
    settings.ui = {
      ...settings.ui,
      roverDefaultDirectories: { enabled: true, inputDirectory: filePath },
    };

    await expect(
      resolveImportDialogDefaultPathFromSettings(
        settings,
        dataRoot,
        recentDialogPathKeys.archiveImport,
      ),
    ).resolves.toBe(recent);
    settings.ui.roverDefaultDirectories = {
      enabled: true,
      inputDirectory: join("relative", "folder"),
    };
    await expect(
      resolveImportDialogDefaultPathFromSettings(
        settings,
        dataRoot,
        recentDialogPathKeys.archiveImport,
      ),
    ).resolves.toBe(recent);
  });
});

describe("Rover translation JSON export setting", () => {
  it("is off by default and only an explicit true turns it on", () => {
    const defaults = resolveDefaultAppSettings();
    expect(defaults.ui?.roverTranslationJsonExport).toBe(false);
    expect(normalizeUiSettings({}, defaults).roverTranslationJsonExport).toBe(
      false,
    );
    expect(
      normalizeUiSettings({ roverTranslationJsonExport: "true" }, defaults)
        .roverTranslationJsonExport,
    ).toBe(false);
    expect(
      normalizeUiSettings({ roverTranslationJsonExport: true }, defaults)
        .roverTranslationJsonExport,
    ).toBe(true);
    expect(
      UiSettingsSchema.safeParse({ roverTranslationJsonExport: true }).success,
    ).toBe(true);
  });
});

async function makeTempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `mgt-rover-default-${label}-`));
  tempDirs.push(path);
  await mkdir(path, { recursive: true });
  return path;
}
