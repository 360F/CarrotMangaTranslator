import type React from "react";
import type { SettingsFormValues } from "./settingsModalFormValues";
import type { SettingsFormSetters } from "./useSettingsFormState";

type RoverDefaultDirectorySetters = Pick<
  SettingsFormSetters,
  | "setRoverDefaultDirectoriesEnabled"
  | "setRoverInputDirectory"
  | "setRoverOutputDirectory"
  | "setRoverTranslationJsonExport"
>;

export function createRoverDefaultDirectoryFormSetters(
  setValues: React.Dispatch<React.SetStateAction<SettingsFormValues>>,
): RoverDefaultDirectorySetters {
  const set =
    <K extends keyof SettingsFormValues>(key: K) =>
    (next: React.SetStateAction<SettingsFormValues[K]>): void =>
      setValues((current) => ({
        ...current,
        [key]:
          typeof next === "function"
            ? (next as (value: SettingsFormValues[K]) => SettingsFormValues[K])(
                current[key],
              )
            : next,
      }));
  return {
    setRoverDefaultDirectoriesEnabled: set("roverDefaultDirectoriesEnabled"),
    setRoverInputDirectory: set("roverInputDirectory"),
    setRoverOutputDirectory: set("roverOutputDirectory"),
    setRoverTranslationJsonExport: set("roverTranslationJsonExport"),
  };
}
