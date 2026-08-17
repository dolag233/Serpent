import { z } from 'zod';

import {
  CUSTOM_THEME_COLOR_TOKENS,
  type CustomThemeColorToken,
} from './custom-theme';
import type { ResolvedTheme } from './theme-preferences';
import type { ThemePreferencesStorage } from './theme-preferences';

/**
 * Versioned host-owned theme profiles.
 *
 * A profile is deliberately narrower than a stylesheet: it can only write
 * the existing semantic color tokens already exposed by the UI foundation.
 * Geometry, typography, layout, arbitrary CSS and HTML are not part of this
 * contract. Custom-theme overrides remain a separate persistence layer and
 * are applied after a profile when they should win.
 *
 * v3 makes light/dark orthogonal to the profile: every theme ships two tone
 * variants (`tokens.dark` / `tokens.light`) and the resolved light/dark mode
 * — from the explicit preference or the system — picks the variant. Picking
 * a profile no longer switches the global light/dark preference.
 */
export const THEME_PROFILE_VERSION = 3 as const;
export const THEME_PROFILE_PREF_KEY = 'serpent.theme-profile.v3';
/** v2 persisted key: four fixed presets (vscode-dark/serpent-dark/serpent-light/soft-light). */
export const THEME_PROFILE_LEGACY_KEY = 'serpent.theme-profile.v2';

export const THEME_PROFILE_IDS = ['serpent', 'vscode', 'soft'] as const;

export type ThemeProfileId = (typeof THEME_PROFILE_IDS)[number];
export type ThemeProfileColorToken = CustomThemeColorToken;

const themeProfileIdSchema = z.enum(
  [...THEME_PROFILE_IDS] as [ThemeProfileId, ...ThemeProfileId[]],
);

const themeProfileColorValueSchema = z
  .string()
  .trim()
  .max(11)
  .regex(
    /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6,8}|transparent)$/iu,
    'Theme values must be bounded hex colors or transparent.',
  );

const themeProfileOverridesShape = Object.fromEntries(
  CUSTOM_THEME_COLOR_TOKENS.map((token) => [
    token,
    themeProfileColorValueSchema.optional(),
  ]),
);

/** Strictly rejects arbitrary CSS variables and non-color values. */
export const themeProfileOverridesSchema = z.strictObject(
  themeProfileOverridesShape,
);

/** Persisted selection plus optional semantic color overrides. */
export const themeProfileSchema = z.strictObject({
  version: z.literal(THEME_PROFILE_VERSION),
  preset: themeProfileIdSchema,
  overrides: themeProfileOverridesSchema.default({}),
});

export type ThemeProfileOverrides = z.infer<
  typeof themeProfileOverridesSchema
>;
export type ThemeProfile = z.infer<typeof themeProfileSchema>;

export type ThemeProfileTokenMap = Readonly<
  Record<ThemeProfileColorToken, string>
>;

/** A theme with its light and dark tone variants. */
export type ThemeProfilePreset = {
  readonly id: ThemeProfileId;
  readonly label: string;
  readonly tokens: {
    readonly dark: ThemeProfileTokenMap;
    readonly light: ThemeProfileTokenMap;
  };
};

type Palette = {
  canvas: string;
  pane: string;
  raised: string;
  raisedSubtle: string;
  overlay: string;
  scrim: string;
  hover: string;
  pressed: string;
  selected: string;
  disabled: string;
  primary: string;
  secondary: string;
  tertiary: string;
  contentDisabled: string;
  inverse: string;
  onAccent: string;
  accent: string;
  divider: string;
  subtle: string;
  control: string;
  focus: string;
  selection: string;
  dangerBorder: string;
  action: string;
  actionHover: string;
  actionPressed: string;
  actionSoft: string;
  actionHoverSurface: string;
  actionPressedSurface: string;
  actionSelected: string;
  actionDisabled: string;
  actionDanger: string;
  dangerHover: string;
  info: string;
  infoSurface: string;
  infoContent: string;
  success: string;
  successSurface: string;
  successContent: string;
  warning: string;
  warningSurface: string;
  warningContent: string;
  danger: string;
  dangerSurface: string;
  dangerContent: string;
};

function tokens(palette: Palette): ThemeProfileTokenMap {
  return {
    '--ui-surface-canvas': palette.canvas,
    '--ui-surface-pane': palette.pane,
    '--ui-surface-raised': palette.raised,
    '--ui-surface-raised-subtle': palette.raisedSubtle,
    '--ui-surface-overlay': palette.overlay,
    '--ui-surface-scrim': palette.scrim,
    '--ui-surface-hover': palette.hover,
    '--ui-surface-pressed': palette.pressed,
    '--ui-surface-selected': palette.selected,
    '--ui-surface-disabled': palette.disabled,
    '--ui-content-primary': palette.primary,
    '--ui-content-secondary': palette.secondary,
    '--ui-content-tertiary': palette.tertiary,
    '--ui-content-disabled': palette.contentDisabled,
    '--ui-content-inverse': palette.inverse,
    '--ui-content-on-accent': palette.onAccent,
    '--ui-content-accent': palette.accent,
    '--ui-border-divider': palette.divider,
    '--ui-border-subtle': palette.subtle,
    '--ui-border-control': palette.control,
    '--ui-border-focus': palette.focus,
    '--ui-border-selection': palette.selection,
    '--ui-border-danger': palette.dangerBorder,
    '--ui-action-accent': palette.action,
    '--ui-action-accent-hover': palette.actionHover,
    '--ui-action-accent-pressed': palette.actionPressed,
    '--ui-action-accent-soft': palette.actionSoft,
    '--ui-action-hover': palette.actionHoverSurface,
    '--ui-action-pressed': palette.actionPressedSurface,
    '--ui-action-selected': palette.actionSelected,
    '--ui-action-disabled': palette.actionDisabled,
    '--ui-action-danger': palette.actionDanger,
    '--ui-action-danger-hover': palette.dangerHover,
    '--ui-status-info': palette.info,
    '--ui-status-info-surface': palette.infoSurface,
    '--ui-status-info-content': palette.infoContent,
    '--ui-status-success': palette.success,
    '--ui-status-success-surface': palette.successSurface,
    '--ui-status-success-content': palette.successContent,
    '--ui-status-warning': palette.warning,
    '--ui-status-warning-surface': palette.warningSurface,
    '--ui-status-warning-content': palette.warningContent,
    '--ui-status-danger': palette.danger,
    '--ui-status-danger-surface': palette.dangerSurface,
    '--ui-status-danger-content': palette.dangerContent,
  };
}

const serpentDark = tokens({
  canvas: '#202124',
  pane: '#282a2d',
  raised: '#303238',
  raisedSubtle: '#363941',
  overlay: '#343740',
  scrim: '#08090dcc',
  hover: '#3a3d47',
  pressed: '#454957',
  selected: '#2f4468',
  disabled: '#2a2c31',
  primary: '#f1f2f4',
  secondary: '#b4b7c0',
  tertiary: '#858995',
  contentDisabled: '#666a75',
  inverse: '#202124',
  onAccent: '#ffffff',
  accent: '#8ab0ff',
  divider: '#3b3e46',
  subtle: '#464952',
  control: '#4b4e59',
  focus: '#9db8ff',
  selection: '#2d4a78',
  dangerBorder: '#ed6b75',
  action: '#3b82f6',
  actionHover: '#5b93f8',
  actionPressed: '#2b6fe0',
  actionSoft: '#3b82f633',
  actionHoverSurface: '#3a3d47',
  actionPressedSurface: '#454957',
  actionSelected: '#2f4468',
  actionDisabled: '#555862',
  actionDanger: '#e05763',
  dangerHover: '#c84652',
  info: '#70a7ff',
  infoSurface: '#283e66',
  infoContent: '#dce9ff',
  success: '#74d69a',
  successSurface: '#244a38',
  successContent: '#d3f7e1',
  warning: '#e7bd68',
  warningSurface: '#5b4824',
  warningContent: '#fff0c7',
  danger: '#ed6b75',
  dangerSurface: '#5c2b32',
  dangerContent: '#ffe0e3',
});

const serpentLight = tokens({
  canvas: '#f4f5f7',
  pane: '#e9ebef',
  raised: '#ffffff',
  raisedSubtle: '#fafbfc',
  overlay: '#ffffff',
  scrim: '#2021243d',
  hover: '#eef0f4',
  pressed: '#e1e4ea',
  selected: '#dbe6ff',
  disabled: '#e7e9ed',
  primary: '#252936',
  secondary: '#5c6271',
  tertiary: '#858b99',
  contentDisabled: '#adb2bd',
  inverse: '#ffffff',
  onAccent: '#ffffff',
  accent: '#5b7cf0',
  divider: '#d9dce3',
  subtle: '#e4e7ed',
  control: '#c7cbd5',
  focus: '#5b82f0',
  selection: '#c7d6ff',
  dangerBorder: '#d94b5b',
  action: '#2563eb',
  actionHover: '#3b76f0',
  actionPressed: '#1d4ed8',
  actionSoft: '#2563eb1f',
  actionHoverSurface: '#eef0f4',
  actionPressedSurface: '#e1e4ea',
  actionSelected: '#dbe6ff',
  actionDisabled: '#c4c8d0',
  actionDanger: '#d94b5b',
  dangerHover: '#bf3948',
  info: '#3c73d9',
  infoSurface: '#e2edff',
  infoContent: '#254a8f',
  success: '#2c9a62',
  successSurface: '#e3f6eb',
  successContent: '#226744',
  warning: '#b57b18',
  warningSurface: '#fff3d6',
  warningContent: '#79530d',
  danger: '#d94b5b',
  dangerSurface: '#ffe6e9',
  dangerContent: '#8d2b38',
});

const vscodeDark = tokens({
  canvas: '#1e1e1e',
  pane: '#181818',
  raised: '#252526',
  raisedSubtle: '#2d2d2d',
  overlay: '#2b2b2b',
  scrim: '#00000099',
  hover: '#2a2d2e',
  pressed: '#37373d',
  selected: '#094771',
  disabled: '#242424',
  primary: '#cccccc',
  secondary: '#9d9d9d',
  tertiary: '#6f6f6f',
  contentDisabled: '#5f5f5f',
  inverse: '#1e1e1e',
  onAccent: '#ffffff',
  accent: '#3794ff',
  divider: '#2b2b2b',
  subtle: '#333333',
  control: '#3c3c3c',
  focus: '#007fd4',
  selection: '#264f78',
  dangerBorder: '#f14c4c',
  action: '#0078d4',
  actionHover: '#1177bb',
  actionPressed: '#005a9e',
  actionSoft: '#0078d433',
  actionHoverSurface: '#2a2d2e',
  actionPressedSurface: '#37373d',
  actionSelected: '#094771',
  actionDisabled: '#3a3a3a',
  actionDanger: '#f14c4c',
  dangerHover: '#c72e2e',
  info: '#3794ff',
  infoSurface: '#264f78',
  infoContent: '#d6eaff',
  success: '#89d185',
  successSurface: '#1e4f24',
  successContent: '#c7f0c4',
  warning: '#cca700',
  warningSurface: '#5a4d00',
  warningContent: '#fff3b0',
  danger: '#f14c4c',
  dangerSurface: '#5a1d1d',
  dangerContent: '#ffd7d7',
});

const vscodeLight = tokens({
  canvas: '#ffffff',
  pane: '#f3f3f3',
  raised: '#fafafa',
  raisedSubtle: '#f5f5f5',
  overlay: '#ffffff',
  scrim: '#00000030',
  hover: '#f0f0f0',
  pressed: '#e4e4e4',
  selected: '#cce8ff',
  disabled: '#f5f5f5',
  primary: '#1f1f1f',
  secondary: '#616161',
  tertiary: '#8a8a8a',
  contentDisabled: '#a8a8a8',
  inverse: '#ffffff',
  onAccent: '#ffffff',
  accent: '#3794ff',
  divider: '#e0e0e0',
  subtle: '#e8e8e8',
  control: '#c8c8c8',
  focus: '#007fd4',
  selection: '#cce8ff',
  dangerBorder: '#d24545',
  action: '#0078d4',
  actionHover: '#1a86d8',
  actionPressed: '#005a9e',
  actionSoft: '#0078d433',
  actionHoverSurface: '#f0f0f0',
  actionPressedSurface: '#e4e4e4',
  actionSelected: '#cce8ff',
  actionDisabled: '#d4d4d4',
  actionDanger: '#d24545',
  dangerHover: '#b13a3a',
  info: '#3794ff',
  infoSurface: '#e8f1ff',
  infoContent: '#1a5fa8',
  success: '#388a34',
  successSurface: '#e8f5e8',
  successContent: '#2a6527',
  warning: '#9e7b00',
  warningSurface: '#fdf4d8',
  warningContent: '#6b5300',
  danger: '#d24545',
  dangerSurface: '#fdeaea',
  dangerContent: '#8f2d2d',
});

const softLight = tokens({
  canvas: '#f6f7fb',
  pane: '#edf0f7',
  raised: '#ffffff',
  raisedSubtle: '#fbfcff',
  overlay: '#ffffff',
  scrim: '#34395a33',
  hover: '#f0f2fa',
  pressed: '#e5e8f3',
  selected: '#dfe9ff',
  disabled: '#e8ebf2',
  primary: '#34364a',
  secondary: '#676b82',
  tertiary: '#9498ac',
  contentDisabled: '#b4b7c5',
  inverse: '#ffffff',
  onAccent: '#ffffff',
  accent: '#6a9be8',
  divider: '#dfe2ed',
  subtle: '#e9ebf3',
  control: '#cdd1df',
  focus: '#7ea3e8',
  selection: '#d4e3ff',
  dangerBorder: '#d95e78',
  action: '#4f8bd9',
  actionHover: '#5e9be6',
  actionPressed: '#3f70c0',
  actionSoft: '#4f8bd91f',
  actionHoverSurface: '#f0f2fa',
  actionPressedSurface: '#e5e8f3',
  actionSelected: '#dfe9ff',
  actionDisabled: '#c6c9d6',
  actionDanger: '#d95e78',
  dangerHover: '#bf4862',
  info: '#5776cf',
  infoSurface: '#e8efff',
  infoContent: '#38539b',
  success: '#47a878',
  successSurface: '#e6f7ee',
  successContent: '#2e7652',
  warning: '#c18c35',
  warningSurface: '#fff3df',
  warningContent: '#87621f',
  danger: '#d95e78',
  dangerSurface: '#ffebef',
  dangerContent: '#913b50',
});

const softDark = tokens({
  canvas: '#23242b',
  pane: '#2a2c35',
  raised: '#333543',
  raisedSubtle: '#383a49',
  overlay: '#343650',
  scrim: '#080910cc',
  hover: '#3c3e4d',
  pressed: '#454859',
  selected: '#34405f',
  disabled: '#2b2d35',
  primary: '#eef0f8',
  secondary: '#a9adc0',
  tertiary: '#7d8198',
  contentDisabled: '#5f637a',
  inverse: '#23242b',
  onAccent: '#ffffff',
  accent: '#8fb0f0',
  divider: '#3c3e4c',
  subtle: '#464857',
  control: '#4a4d5e',
  focus: '#7ea3e8',
  selection: '#3a4a6e',
  dangerBorder: '#e07a8f',
  action: '#5b8def',
  actionHover: '#6f9cf2',
  actionPressed: '#4772cf',
  actionSoft: '#5b8def33',
  actionHoverSurface: '#3c3e4d',
  actionPressedSurface: '#454859',
  actionSelected: '#34405f',
  actionDisabled: '#555767',
  actionDanger: '#e07a8f',
  dangerHover: '#c65e73',
  info: '#7ea3e8',
  infoSurface: '#2a3a5e',
  infoContent: '#d4e3ff',
  success: '#7cc4a0',
  successSurface: '#244838',
  successContent: '#cef2dd',
  warning: '#d9b36a',
  warningSurface: '#55482a',
  warningContent: '#f8e7be',
  danger: '#e07a8f',
  dangerSurface: '#553040',
  dangerContent: '#ffd9e0',
});

export const THEME_PROFILE_PRESETS: Readonly<
  Record<ThemeProfileId, ThemeProfilePreset>
> = {
  serpent: {
    id: 'serpent',
    label: 'Serpent',
    tokens: { dark: serpentDark, light: serpentLight },
  },
  vscode: {
    id: 'vscode',
    label: 'VS Code',
    tokens: { dark: vscodeDark, light: vscodeLight },
  },
  soft: {
    id: 'soft',
    label: 'Soft',
    tokens: { dark: softDark, light: softLight },
  },
};

export const DEFAULT_THEME_PROFILE: ThemeProfile = {
  version: THEME_PROFILE_VERSION,
  preset: 'serpent',
  overrides: {},
};

function defaultThemeProfile(): ThemeProfile {
  return {
    version: THEME_PROFILE_VERSION,
    preset: DEFAULT_THEME_PROFILE.preset,
    overrides: {},
  };
}

/**
 * Migrate a v2 profile (fixed light/dark presets) to v3 (theme × mode):
 * the preset maps onto its theme, the mode is dropped — the global
 * light/dark preference now picks the tone variant.
 */
function migrateLegacyProfile(input: unknown): ThemeProfile {
  const record = (typeof input === 'object' && input !== null)
    ? (input as Record<string, unknown>)
    : {};
  const legacyPreset = record.preset;
  const preset =
    legacyPreset === 'vscode-dark' || legacyPreset === 'vscode-light'
      ? 'vscode'
      : legacyPreset === 'soft-light' || legacyPreset === 'soft-dark'
        ? 'soft'
        : 'serpent';
  // Validate the carried-over overrides: a persisted v2 record could contain
  // keys the strict schema rejects (a v2 load already fell back to default
  // without deleting the raw record). Unvalidated keys would make the
  // migrated v3 record throw during resolveThemeProfile.
  const overrides = themeProfileOverridesSchema.safeParse(record.overrides ?? {})
    .success
    ? (record.overrides as ThemeProfileOverrides)
    : {};
  return { version: THEME_PROFILE_VERSION, preset, overrides };
}

function resolveStorage(
  storage?: ThemePreferencesStorage,
): ThemePreferencesStorage {
  if (storage) return storage;
  const localStorage = (globalThis as { localStorage?: ThemePreferencesStorage })
    .localStorage;
  if (!localStorage) {
    throw new Error(
      'ThemeProfile: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return localStorage;
}

/** True for a genuine v2 (or v1) profile record, as opposed to a corrupt v3 one. */
function isLegacyProfileRecord(input: unknown): boolean {
  const record = (typeof input === 'object' && input !== null)
    ? (input as Record<string, unknown>)
    : {};
  if (record.version === 2) return true;
  if (record.version !== undefined) return false;
  const preset = record.preset;
  return (
    preset === 'vscode-dark' ||
    preset === 'vscode-light' ||
    preset === 'serpent-dark' ||
    preset === 'serpent-light' ||
    preset === 'soft-light' ||
    preset === 'soft-dark'
  );
}

/** Parse untrusted persisted/input data, falling back to the default profile. */
export function parseThemeProfile(input: unknown): ThemeProfile {
  const parsed = themeProfileSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  // Genuine v1/v2 records fail the v3 schema; migrate instead of discarding.
  // Corrupt current-version records fall back to the default.
  if (isLegacyProfileRecord(input)) return migrateLegacyProfile(input);
  return defaultThemeProfile();
}

export function loadThemeProfile(
  storage?: ThemePreferencesStorage,
): ThemeProfile {
  try {
    const store = resolveStorage(storage);
    const raw = store.getItem(THEME_PROFILE_PREF_KEY);
    if (raw) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
      const schemaResult = themeProfileSchema.safeParse(parsed);
      if (schemaResult.success) return schemaResult.data;
      // A corrupt current-version record falls through to the legacy key —
      // an unmigrated v2 profile should not be stranded by a broken v3 one.
    }

    const legacyRaw = store.getItem(THEME_PROFILE_LEGACY_KEY);
    if (legacyRaw) {
      const migrated = migrateLegacyProfile(JSON.parse(legacyRaw));
      try {
        store.setItem(THEME_PROFILE_PREF_KEY, JSON.stringify(migrated));
        store.removeItem(THEME_PROFILE_LEGACY_KEY);
      } catch {
        // Migration copy is best-effort; the in-memory value is still valid.
      }
      return migrated;
    }

    return defaultThemeProfile();
  } catch {
    return defaultThemeProfile();
  }
}

export function saveThemeProfile(
  profile: ThemeProfile,
  storage?: ThemePreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const parsed = themeProfileSchema.parse(profile);
  store.setItem(THEME_PROFILE_PREF_KEY, JSON.stringify(parsed));
}

/**
 * Resolve a persisted profile into the complete semantic color map for the
 * resolved light/dark mode. The mode is an input, not part of the profile:
 * each theme owns both tone variants.
 */
export function resolveThemeProfile(
  profile: ThemeProfile,
  resolved: ResolvedTheme,
): { readonly id: ThemeProfileId; readonly label: string; readonly tokens: ThemeProfileTokenMap } {
  const parsed = themeProfileSchema.parse(profile);
  const preset = THEME_PROFILE_PRESETS[parsed.preset];
  const overrides = Object.fromEntries(
    Object.entries(parsed.overrides).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ) as Partial<Record<ThemeProfileColorToken, string>>;
  return {
    id: preset.id,
    label: preset.label,
    tokens: {
      ...preset.tokens[resolved],
      ...overrides,
    },
  };
}

/**
 * Apply a profile using only the existing semantic color token allowlist.
 * Clearing first prevents a previous profile's color from leaking into the
 * next one; unrelated inline properties are deliberately preserved.
 */
export function applyThemeProfile(
  profile: ThemeProfile,
  resolved: ResolvedTheme,
): void {
  const parsed = themeProfileSchema.parse(profile);
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (!root) return;

  for (const token of CUSTOM_THEME_COLOR_TOKENS) {
    root.style.removeProperty(token);
  }

  const resolvedProfile = resolveThemeProfile(parsed, resolved);
  for (const [token, value] of Object.entries(resolvedProfile.tokens)) {
    root.style.setProperty(token, value);
  }
}
