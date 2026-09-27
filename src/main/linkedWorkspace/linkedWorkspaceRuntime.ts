import type { BrowserWindow } from "electron";
import type { ActiveJobStore } from "../jobs/activeJob";
import type { ImageDecodeFallback } from "../regionCrop";
import { listLibrary, openChapter } from "../library/libraryReadFacade";
import { updatePagesAfterInpainting } from "../library/libraryMutationFacade";
import { createPageExportRenderSession } from "../pageExport";
import { installLinkedWorkspaceSaveNotifier } from "./linkedWorkspaceNotifications";
import { LinkedWorkspaceSyncService } from "./linkedWorkspaceSyncService";
import {
  resolveRoverOutputRoot,
  resolveTranslationJsonExportEnabled,
} from "../roverDefaultDirectories";
import { getAppSettings } from "../settingsStore";
import { resolveSettingsSourceReadingDirection } from "../settings/translationOptions";
import {
  createTranslationJsonExporter,
  resolveTranslationJsonContext,
} from "./linkedWorkspaceTranslationJson";

export function createLinkedWorkspaceRuntime(options: {
  dataRoot: string;
  jobs: ActiveJobStore;
  decodeImage: ImageDecodeFallback;
  getMainWindow: () => BrowserWindow | null;
  reportError: (message: string, detail?: unknown) => void;
}) {
  const service = new LinkedWorkspaceSyncService({
    ...options,
    dependencies: {
      listLibrary,
      openChapter,
      updatePagesAfterInpainting,
      createPageExportRenderSession,
    },
  });
  const translationJson = createTranslationJsonExporter({
    dataRoot: options.dataRoot,
    isEnabled: () => resolveTranslationJsonExportEnabled(),
    resolveOutputRoot: () => resolveRoverOutputRoot(),
    getStatus: (chapterId) => service.getStatus(chapterId),
    listStatuses: () => service.listStatuses(),
    openChapter: (chapterId) => openChapter(chapterId),
    resolveContext: async (chapter) => {
      const [library, settings] = await Promise.all([
        listLibrary(),
        getAppSettings(),
      ]);
      return resolveTranslationJsonContext(
        chapter,
        library,
        resolveSettingsSourceReadingDirection(settings),
      );
    },
    reportError: options.reportError,
  });
  return {
    service,
    installSaveNotifier: () =>
      installLinkedWorkspaceSaveNotifier(
        createLinkedWorkspaceSaveNotifier(service, translationJson),
        options.reportError,
      ),
  };
}

/** The translation projection does not wait for the render queue. */
export function createLinkedWorkspaceSaveNotifier(
  service: Pick<LinkedWorkspaceSyncService, "notifyPagesSaved">,
  translationJson: ReturnType<typeof createTranslationJsonExporter>,
) {
  return async (chapterId: string, pageIds: readonly string[]) => {
    const exported = translationJson.sync(chapterId);
    await service.notifyPagesSaved(chapterId, pageIds);
    await exported;
  };
}
