import type { CanvasPreferences } from "./canvas-preferences";
import type { IconName } from "./Icons";
import type { LocalePreference } from "./i18n";
import type { ThemePreference } from "./theme";

/**
 * Declarative copy/keys for REQ-PREF-001 / Serpent-97l / Serpent-9es / Serpent-i07.
 * Caption fields and corner badges are separate checkbox groups so the settings
 * panel does not dump unrelated toggles into one pile.
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
    | "toolbar.showModifiedDate"
    | "toolbar.showBadgeType"
    | "toolbar.showBadgeDuration"
    | "toolbar.showBadgeSource"
    | "toolbar.showBadgeExtension";
};

export type AppSettingsCategoryId =
  | "general"
  | "appearance"
  | "browse"
  | "ai"
  | "safety";

/**
 * Stable settings information architecture. It deliberately lists only
 * user-facing preferences with a durable, comprehensible effect; transient
 * workspace state and internal runtime diagnostics do not belong here.
 */
export type AppSettingsCategory = {
  readonly id: AppSettingsCategoryId;
  readonly icon: IconName;
  readonly labelKey:
    | "settings.categoryGeneral"
    | "settings.categoryAppearance"
    | "settings.categoryBrowse"
    | "settings.categoryAi"
    | "settings.categorySafety";
  readonly descriptionKey:
    | "settings.categoryGeneralDescription"
    | "settings.categoryAppearanceDescription"
    | "settings.categoryBrowseDescription"
    | "settings.categoryAiDescription"
    | "settings.categorySafetyDescription";
};

export const APP_SETTINGS_CATEGORIES: readonly AppSettingsCategory[] = [
  {
    id: "general",
    icon: "settings",
    labelKey: "settings.categoryGeneral",
    descriptionKey: "settings.categoryGeneralDescription",
  },
  {
    id: "appearance",
    icon: "sliders",
    labelKey: "settings.categoryAppearance",
    descriptionKey: "settings.categoryAppearanceDescription",
  },
  {
    id: "browse",
    icon: "grid",
    labelKey: "settings.categoryBrowse",
    descriptionKey: "settings.categoryBrowseDescription",
  },
  {
    id: "ai",
    icon: "activity",
    labelKey: "settings.categoryAi",
    descriptionKey: "settings.categoryAiDescription",
  },
  {
    id: "safety",
    icon: "warning",
    labelKey: "settings.categorySafety",
    descriptionKey: "settings.categorySafetyDescription",
  },
];

export function isAppSettingsCategoryId(
  value: string,
): value is AppSettingsCategoryId {
  return APP_SETTINGS_CATEGORIES.some((category) => category.id === value);
}

/** Shared hint for caption fields under the card (name / size / date). */
export const APP_SETTINGS_CARD_FIELDS_HINT_KEY = "settings.cardFieldsHint" as const;

/** Shared hint for corner badges on the preview. */
export const APP_SETTINGS_CARD_BADGES_HINT_KEY = "settings.cardBadgesHint" as const;

export const APP_SETTINGS_THEME_OPTIONS: readonly AppSettingsThemeOption[] = [
  { value: "system", labelKey: "shell.themeSystem" },
  { value: "light", labelKey: "shell.themeLight" },
  { value: "dark", labelKey: "shell.themeDark" },
];

export const APP_SETTINGS_LOCALE_OPTIONS: readonly AppSettingsLocaleOption[] = [
  { value: "system", labelKey: "shell.languageSystem" },
  { value: "zh-CN", labelKey: "shell.languageZh" },
  { value: "en", labelKey: "shell.languageEn" },
];

export const APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS: readonly AppSettingsCanvasFieldOption[] =
  [
    { field: "name", labelKey: "toolbar.showFileName" },
    { field: "size", labelKey: "toolbar.showFileSize" },
    { field: "date", labelKey: "toolbar.showModifiedDate" },
  ];

export const APP_SETTINGS_CANVAS_BADGE_FIELD_OPTIONS: readonly AppSettingsCanvasFieldOption[] =
  [
    { field: "badgeDuration", labelKey: "toolbar.showBadgeDuration" },
    { field: "badgeExtension", labelKey: "toolbar.showBadgeExtension" },
    { field: "badgeType", labelKey: "toolbar.showBadgeType" },
    { field: "badgeSource", labelKey: "toolbar.showBadgeSource" },
  ];

/** @deprecated Prefer caption + badge option lists (Serpent-i07). */
export const APP_SETTINGS_CANVAS_FIELD_OPTIONS: readonly AppSettingsCanvasFieldOption[] =
  [
    ...APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS,
    ...APP_SETTINGS_CANVAS_BADGE_FIELD_OPTIONS,
  ];

/**
 * Caption field toggles must be label-only; explanatory copy lives on the
 * group heading (Serpent-9es).
 */
export function canvasFieldOptionsUseSharedHint(
  options: readonly AppSettingsCanvasFieldOption[] = APP_SETTINGS_CANVAS_CAPTION_FIELD_OPTIONS,
  sharedHintKey: string = APP_SETTINGS_CARD_FIELDS_HINT_KEY,
): boolean {
  if (
    sharedHintKey !== APP_SETTINGS_CARD_FIELDS_HINT_KEY &&
    sharedHintKey !== APP_SETTINGS_CARD_BADGES_HINT_KEY
  ) {
    return false;
  }
  if (options.length === 0) return false;
  return options.every(
    (option) =>
      option.labelKey.startsWith("toolbar.show") &&
      !("descriptionKey" in option),
  );
}
