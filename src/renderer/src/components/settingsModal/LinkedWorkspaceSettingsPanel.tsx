import React from "react";
import { IconSearch } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { LibraryIndex } from "../../../../shared/libraryTypes";
import type { LinkedWorkspaceStatus } from "../../../../shared/linkedWorkspaceTypes";
import { LibrarySortMenu } from "../LibrarySortMenu";
import { filterLibraryIndex } from "../../lib/libraryFilter";
import { sortLibraryIndex, type LibrarySort } from "../../lib/librarySort";
import { useLinkedWorkspaceSettingsOperations } from "../../hooks/useLinkedWorkspaceSettingsOperations";
import { useLinkedWorkspaceStatuses } from "../../hooks/useLinkedWorkspaceStatuses";
import { LinkedWorkspaceChapterRow } from "./LinkedWorkspaceChapterRow";
import { LinkedWorkspaceFolderRoles } from "../LinkedWorkspaceFolderRoles";
import { settingsGateway } from "../../api/settingsGateway";
import { Button } from "../ui/Button";
import { CheckboxField } from "../ui/CheckboxField";
import { TextField } from "../ui/Field";

const ignoreBooleanChange = (_value: boolean): void => undefined;
const ignoreStringChange = (_value: string): void => undefined;

type LinkedWorkspaceSettingsPanelProps = {
  disabled?: boolean;
  enabled?: boolean;
  inputDirectory?: string;
  library: LibraryIndex;
  onEnabledChange?: (enabled: boolean) => void;
  onInputDirectoryChange?: (directory: string) => void;
  onOutputDirectoryChange?: (directory: string) => void;
  onTranslationJsonExportChange?: (enabled: boolean) => void;
  outputDirectory?: string;
  translationJsonExport?: boolean;
};

export function LinkedWorkspaceSettingsPanel({
  disabled = false,
  library,
  ...roverSettings
}: LinkedWorkspaceSettingsPanelProps): React.JSX.Element {
  const { i18n, t } = useTranslation("components");
  const [searchQuery, setSearchQuery] = React.useState("");
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const [sort, setSort] = React.useState<LibrarySort>({
    key: "updated",
    direction: "desc",
  });
  const chapterIds = React.useMemo(
    () => library.works.flatMap((work) => work.chapterOrder),
    [library.works],
  );
  const visibleLibrary = useVisibleLibrary(
    library,
    deferredSearchQuery,
    sort,
    i18n.resolvedLanguage ?? i18n.language,
  );
  const { loading, refresh, statuses } = useLinkedWorkspaceStatuses(chapterIds);
  const { busyChapterIds, errors, run } =
    useLinkedWorkspaceSettingsOperations(refresh);
  return (
    <div className="linked-workspace-settings" aria-busy={loading}>
      <RoverResultSettings disabled={disabled} {...roverSettings} />
      <LinkedWorkspaceFolderRoles />
      <div className="linked-workspace-settings-toolbar">
        <label
          className="library-search-shell linked-workspace-settings-search"
          aria-label={t("settings.results.searchLabel")}
        >
          <IconSearch className="library-search-icon" aria-hidden="true" />
          <input
            className="library-search-input"
            value={searchQuery}
            placeholder={t("settings.results.searchPlaceholder")}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </label>
        <LibrarySortMenu value={sort} onChange={setSort} />
      </div>
      <div className="linked-workspace-settings-list">
        <LinkedWorkspaceWorkList
          busyChapterIds={busyChapterIds}
          errors={errors}
          emptyMessageKey={
            deferredSearchQuery.trim()
              ? "settings.results.noSearchResults"
              : "settings.results.empty"
          }
          library={visibleLibrary}
          onRun={run}
          statuses={statuses}
        />
      </div>
    </div>
  );
}

function RoverResultSettings({
  disabled,
  enabled = false,
  inputDirectory = "",
  onEnabledChange = ignoreBooleanChange,
  onInputDirectoryChange = ignoreStringChange,
  onOutputDirectoryChange = ignoreStringChange,
  onTranslationJsonExportChange = ignoreBooleanChange,
  outputDirectory = "",
  translationJsonExport = false,
}: Omit<LinkedWorkspaceSettingsPanelProps, "library"> & {
  disabled: boolean;
}): React.JSX.Element {
  return (
    <>
      <DefaultDirectoriesSection
        {...{
          disabled,
          enabled,
          inputDirectory,
          outputDirectory,
          onEnabledChange,
          onInputDirectoryChange,
          onOutputDirectoryChange,
        }}
      />
      <TranslationJsonExportSection
        checked={translationJsonExport}
        disabled={disabled}
        onCheckedChange={onTranslationJsonExportChange}
      />
    </>
  );
}

function useVisibleLibrary(
  library: LibraryIndex,
  searchQuery: string,
  sort: LibrarySort,
  locale: string,
): LibraryIndex {
  return React.useMemo(
    () =>
      sortLibraryIndex(filterLibraryIndex(library, searchQuery), sort, locale),
    [library, locale, searchQuery, sort],
  );
}

function DefaultDirectoriesSection({
  disabled,
  enabled,
  inputDirectory,
  onEnabledChange,
  onInputDirectoryChange,
  onOutputDirectoryChange,
  outputDirectory,
}: {
  disabled: boolean;
  enabled: boolean;
  inputDirectory: string;
  onEnabledChange: (enabled: boolean) => void;
  onInputDirectoryChange: (directory: string) => void;
  onOutputDirectoryChange: (directory: string) => void;
  outputDirectory: string;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  const fieldsDisabled = disabled || !enabled;
  return (
    <section className="rover-default-directories">
      <CheckboxField
        variant="switch"
        checked={enabled}
        disabled={disabled}
        label={t("settings.results.defaultDirectories.enable")}
        onCheckedChange={onEnabledChange}
      />
      <p>{t("settings.results.defaultDirectories.description")}</p>
      <DefaultDirectoryField
        disabled={fieldsDisabled}
        label={t("settings.results.defaultDirectories.input")}
        value={inputDirectory}
        onChange={onInputDirectoryChange}
      />
      <DefaultDirectoryField
        disabled={fieldsDisabled}
        label={t("settings.results.defaultDirectories.output")}
        value={outputDirectory}
        onChange={onOutputDirectoryChange}
      />
    </section>
  );
}

function TranslationJsonExportSection({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (enabled: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <section className="rover-translation-json-export">
      <CheckboxField
        checked={checked}
        disabled={disabled}
        label={t("settings.results.translationJson.enable")}
        onCheckedChange={onCheckedChange}
      />
      <p>{t("settings.results.translationJson.description")}</p>
    </section>
  );
}

function DefaultDirectoryField({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (directory: string) => void;
  value: string;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <div className="rover-default-directory-row">
      <TextField
        label={label}
        disabled={disabled}
        value={value}
        placeholder={t("settings.results.defaultDirectories.placeholder")}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <Button
        disabled={disabled}
        size="sm"
        onClick={() => void chooseDefaultDirectory(value, onChange)}
      >
        {t("settings.results.defaultDirectories.browse")}
      </Button>
    </div>
  );
}

async function chooseDefaultDirectory(
  currentPath: string,
  onChange: (directory: string) => void,
): Promise<void> {
  const selected = await settingsGateway.pickDefaultDirectory(
    currentPath.trim() || undefined,
  );
  if (selected) onChange(selected);
}

function LinkedWorkspaceWorkList({
  busyChapterIds,
  emptyMessageKey,
  errors,
  library,
  onRun,
  statuses,
}: {
  busyChapterIds: ReadonlySet<string>;
  emptyMessageKey:
    | "settings.results.empty"
    | "settings.results.noSearchResults";
  errors: ReadonlyMap<string, string>;
  library: LibraryIndex;
  onRun: (
    chapterId: string,
    operation: () => Promise<unknown>,
  ) => Promise<void>;
  statuses: ReadonlyMap<string, LinkedWorkspaceStatus>;
}): React.JSX.Element {
  const { t } = useTranslation("components");
  if (library.works.length === 0) {
    return <p className="linked-workspace-empty">{t(emptyMessageKey)}</p>;
  }
  return (
    <>
      {library.works.map((work) => (
        <section className="linked-workspace-work" key={work.id}>
          <header className="linked-workspace-work-header">
            <strong>{work.title}</strong>
            <span>
              {t("settings.results.chapterCount", {
                count: work.chapters.length,
              })}
            </span>
          </header>
          <div className="linked-workspace-chapter-list">
            {work.chapterOrder.map((chapterId) => {
              const chapter = work.chapters.find(
                (candidate) => candidate.id === chapterId,
              );
              return chapter ? (
                <LinkedWorkspaceChapterRow
                  key={chapter.id}
                  busy={busyChapterIds.has(chapter.id)}
                  chapterId={chapter.id}
                  chapterTitle={chapter.title}
                  error={errors.get(chapter.id)}
                  onRun={onRun}
                  status={statuses.get(chapter.id) ?? null}
                  workId={work.id}
                />
              ) : null;
            })}
          </div>
        </section>
      ))}
    </>
  );
}
