import type { CanvasPreferences } from "./canvas-preferences";
import type { LocalePreference } from "./i18n";
import type { ThemePreference } from "./theme";

/**
 * Declarative copy/keys for REQ-PREF-001 / Serpent-97l.
 * Each preference surfaces a short explanation of what it controls and where
 * the effect appears (app chrome vs canvas cards).
 */

export type AppSettingsThemeOption = {
  readonly value: ThemePreference;
  readonly labelKey: "shell.themeDark" | "shell.themeLight" | "shell.themeSystem";
};

export type AppSettingsLocaleOption = {
  readonly value: LocalePreference;
  readonly labelKey: "shell.languageSystem" | "shell.languageZh" | "shell.languageEn";
};

export type AppSettingsCanvasFieldOption = {
  readonly field: keyof CanvasPreferences["fields"];
  readonly labelKey:
    | "toolbar.showFileName"
    | "toolbar.showFileSize"
    | "toolbar.showModifiedDate";
  readonly descriptionKey:
    | "settings.showFileNameHint"
    | "settings.showFileSizeHint"
    | "settings.showModifiedDateHint";
};

export const APP_SETTINGS_THEME_OPTIONS: readonly AppSettingsThemeOption[] = [
  { value: "dark", labelKey: "shell.themeDark" },
  { value: "light", labelKey: "shell.themeLight" },
  { value: "system", labelKey: "shell.themeSystem" },
];

export const APP_SETTINGS_LOCALE_OPTIONS: readonly AppSettingsLocaleOption[] = [
  { value: "system", labelKey: "shell.languageSystem" },
  { value: "zh-CN", labelKey: "shell.languageZh" },
  { value: "en", labelKey: "shell.languageEn" },
];

export const APP_SETTINGS_CANVAS_FIELD_OPTIONS: readonly AppSettingsCanvasFieldOption[] =
  [
    {
      field: "name",
      labelKey: "toolbar.showFileName",
      descriptionKey: "settings.showFileNameHint",
    },
    {
      field: "size",
      labelKey: "toolbar.showFileSize",
      descriptionKey: "settings.showFileSizeHint",
    },
    {
      field: "date",
      labelKey: "toolbar.showModifiedDate",
      descriptionKey: "settings.showModifiedDateHint",
    },
  ];

/** Every canvas field toggle must ship with explanatory copy (Serpent-97l). */
export function canvasFieldOptionsHaveHints(
  options: readonly AppSettingsCanvasFieldOption[] = APP_SETTINGS_CANVAS_FIELD_OPTIONS,
): boolean {
  return options.every(
    (option) =>
      option.descriptionKey.startsWith("settings.") &&
      option.descriptionKey.endsWith("Hint"),
  );
}
