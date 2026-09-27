import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { AppSettings } from "../shared/settingsTypes";
import { getAppPaths, type AppPaths } from "./appPaths";
import {
  getRecentDialogDirectory,
  type RecentDialogPathKey,
} from "./recentDialogPaths";
import { getAppSettings } from "./settingsStore";

type DefaultDirectoryKind = "inputDirectory" | "outputDirectory";

export async function resolveImportDialogDefaultPath(
  paths: AppPaths,
  recentPathKey: RecentDialogPathKey,
): Promise<string | undefined> {
  return resolveImportDialogDefaultPathFromSettings(
    await getAppSettings(paths),
    paths.dataRoot,
    recentPathKey,
  );
}

export async function resolveImportDialogDefaultPathFromSettings(
  settings: AppSettings,
  dataRoot: string,
  recentPathKey: RecentDialogPathKey,
): Promise<string | undefined> {
  const configured = await resolveAvailableRoverDefaultDirectory(
    settings,
    "inputDirectory",
  );
  return configured ?? getRecentDialogDirectory(dataRoot, recentPathKey);
}

export async function resolveManagedOutputParent(
  paths: AppPaths = getAppPaths(),
): Promise<string | null> {
  return resolveAvailableRoverDefaultDirectory(
    await getAppSettings(paths),
    "outputDirectory",
  );
}

export async function resolveTranslationJsonExportEnabled(
  paths: AppPaths = getAppPaths(),
): Promise<boolean> {
  return (await getAppSettings(paths)).ui?.roverTranslationJsonExport === true;
}

export async function resolveAvailableRoverDefaultDirectory(
  settings: AppSettings,
  kind: DefaultDirectoryKind,
): Promise<string | null> {
  const configured = settings.ui?.roverDefaultDirectories;
  const candidate = configured?.enabled ? configured[kind]?.trim() : undefined;
  if (!candidate || !isAbsolute(candidate)) return null;
  try {
    const metadata = await stat(candidate);
    return metadata.isDirectory() ? resolve(candidate) : null;
  } catch (_error) {
    // error-policy-allow: unavailable user defaults intentionally fall back to existing behavior.
    return null;
  }
}
