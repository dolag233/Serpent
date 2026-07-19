import type { CanvasPreferences } from "./canvas-preferences";
import type { LocalePreference } from "./i18n";
import type { ThemePreference } from "./theme";

/**
 * Declarative copy/keys for REQ-PREF-001 / Serpent-97l / Serpent-9es.
 * Section-level hints explain where each preference takes effect. Canvas card
 * field toggles share one group hint (`settings.cardFieldsHint`) — no
 * per-field near-duplicate paragraphs.
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
};

/** Shared explanatory copy for the card-fields checkbox group (Serpent-9es). */
export const APP_SETTINGS_CARD_FIELDS_HINT_KEY = "settings.cardFieldsHint" as const;

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
    { field: "name", labelKey: "toolbar.showFileName" },
    { field: "size", labelKey: "toolbar.showFileSize" },
    { field: "date", labelKey: "toolbar.showModifiedDate" },
  ];

/**
 * Card field toggles must be label-only; explanatory copy lives on the group
 * heading via `APP_SETTINGS_CARD_FIELDS_HINT_KEY` (Serpent-9es).
 */
export function canvasFieldOptionsUseSharedHint(
  options: readonly AppSettingsCanvasFieldOption[] = APP_SETTINGS_CANVAS_FIELD_OPTIONS,
  sharedHintKey: string = APP_SETTINGS_CARD_FIELDS_HINT_KEY,
): boolean {
  if (sharedHintKey !== APP_SETTINGS_CARD_FIELDS_HINT_KEY) return false;
  if (options.length === 0) return false;
  return options.every(
    (option) =>
      option.labelKey.startsWith("toolbar.show") &&
      !("descriptionKey" in option),
  );
}
