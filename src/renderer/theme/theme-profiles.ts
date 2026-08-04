import { z } from 'zod';

import {
  CUSTOM_THEME_COLOR_TOKENS,
  type CustomThemeColorToken,
} from './custom-theme';
import type { ThemePreferencesStorage } from './theme-preferences';

/**
 * Versioned host-owned theme profiles.
 *
 * A profile is deliberately narrower than a stylesheet: it can only write
 * the existing semantic color tokens already exposed by the UI foundation.
 * Geometry, typography, layout, arbitrary CSS and HTML are not part of this
 * contract. Custom-theme overrides remain a separate persistence layer and
 * can be applied after a profile when they should win.
 */
export const THEME_PROFILE_VERSION = 2 as const;
export const THEME_PROFILE_PREF_KEY = 'serpent.theme-profile.v2';

export const THEME_PROFILE_IDS = [
  'vscode-dark',
  'serpent-dark',
  'serpent-light',
  'soft-light',
] as const;

export type ThemeProfileId = (typeof THEME_PROFILE_IDS)[number];
export type ThemeProfileMode = 'light' | 'dark';
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

export type ThemeProfilePreset = {
  readonly id: ThemeProfileId;
  readonly label: string;
  readonly mode: ThemeProfileMode;
  readonly tokens: ThemeProfileTokenMap;
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

const serpentDark = tokens({
  canvas: '#202124',
  pane: '#282a2d',
  raised: '#303238',
  raisedSubtle: '#363941',
  overlay: '#343740',
  scrim: '#08090dcc',
  hover: '#3a3d47',
  pressed: '#454957',
  selected: '#493c70',
  disabled: '#2a2c31',
  primary: '#f1f2f4',
  secondary: '#b4b7c0',
  tertiary: '#858995',
  contentDisabled: '#666a75',
  inverse: '#202124',
  onAccent: '#ffffff',
  accent: '#9b6cff',
  divider: '#3b3e46',
  subtle: '#464952',
  control: '#4b4e59',
  focus: '#b18aff',
  selection: '#5d4a8c',
  dangerBorder: '#ed6b75',
  action: '#8b5cf6',
  actionHover: '#9d70ff',
  actionPressed: '#7144d4',
  actionSoft: '#8b5cf633',
  actionHoverSurface: '#3a3d47',
  actionPressedSurface: '#454957',
  actionSelected: '#493c70',
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
  selected: '#dfe7ff',
  disabled: '#e7e9ed',
  primary: '#252936',
  secondary: '#5c6271',
  tertiary: '#858b99',
  contentDisabled: '#adb2bd',
  inverse: '#ffffff',
  onAccent: '#ffffff',
  accent: '#4c5fd5',
  divider: '#d9dce3',
  subtle: '#e4e7ed',
  control: '#c7cbd5',
  focus: '#586ee8',
  selection: '#cbd7ff',
  dangerBorder: '#d94b5b',
  action: '#5266dd',
  actionHover: '#4558c4',
  actionPressed: '#3949a7',
  actionSoft: '#5266dd1f',
  actionHoverSurface: '#eef0f4',
  actionPressedSurface: '#e1e4ea',
  actionSelected: '#dfe7ff',
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

const softLight = tokens({
  canvas: '#f6f7fb',
  pane: '#edf0f7',
  raised: '#ffffff',
  raisedSubtle: '#fbfcff',
  overlay: '#ffffff',
  scrim: '#34395a33',
  hover: '#f0f2fa',
  pressed: '#e5e8f3',
  selected: '#e6ddff',
  disabled: '#e8ebf2',
  primary: '#34364a',
  secondary: '#676b82',
  tertiary: '#9498ac',
  contentDisabled: '#b4b7c5',
  inverse: '#ffffff',
  onAccent: '#ffffff',
  accent: '#8839ef',
  divider: '#dfe2ed',
  subtle: '#e9ebf3',
  control: '#cdd1df',
  focus: '#9b65ef',
  selection: '#dcd0ff',
  dangerBorder: '#d95e78',
  action: '#8839ef',
  actionHover: '#7628d9',
  actionPressed: '#641eb9',
  actionSoft: '#8839ef1f',
  actionHoverSurface: '#f0f2fa',
  actionPressedSurface: '#e5e8f3',
  actionSelected: '#e6ddff',
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

export const THEME_PROFILE_PRESETS: Readonly<
  Record<ThemeProfileId, ThemeProfilePreset>
> = {
  'vscode-dark': {
    id: 'vscode-dark',
    label: 'VS Code Dark',
    mode: 'dark',
    tokens: vscodeDark,
  },
  'serpent-dark': {
    id: 'serpent-dark',
    label: 'Serpent Dark',
    mode: 'dark',
    tokens: serpentDark,
  },
  'serpent-light': {
    id: 'serpent-light',
    label: 'Serpent Light',
    mode: 'light',
    tokens: serpentLight,
  },
  'soft-light': {
    id: 'soft-light',
    label: 'Soft Light',
    mode: 'light',
    tokens: softLight,
  },
};

export const DEFAULT_THEME_PROFILE: ThemeProfile = {
  version: THEME_PROFILE_VERSION,
  preset: 'serpent-dark',
  overrides: {},
};

function defaultThemeProfile(): ThemeProfile {
  return {
    version: THEME_PROFILE_VERSION,
    preset: DEFAULT_THEME_PROFILE.preset,
    overrides: {},
  };
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

/** Parse untrusted persisted/input data, falling back to the default profile. */
export function parseThemeProfile(input: unknown): ThemeProfile {
  const parsed = themeProfileSchema.safeParse(input);
  return parsed.success ? parsed.data : defaultThemeProfile();
}

export function loadThemeProfile(
  storage?: ThemePreferencesStorage,
): ThemeProfile {
  try {
    const store = resolveStorage(storage);
    const raw = store.getItem(THEME_PROFILE_PREF_KEY);
    if (!raw) return defaultThemeProfile();
    return parseThemeProfile(JSON.parse(raw));
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

/** Resolve a persisted profile into the complete semantic color map. */
export function resolveThemeProfile(
  profile: ThemeProfile,
): ThemeProfilePreset & { readonly tokens: ThemeProfileTokenMap } {
  const parsed = themeProfileSchema.parse(profile);
  const preset = THEME_PROFILE_PRESETS[parsed.preset];
  return {
    ...preset,
    tokens: {
      ...preset.tokens,
      ...parsed.overrides,
    },
  };
}

/**
 * Apply a profile using only the existing semantic color token allowlist.
 * Clearing first prevents a previous profile's color from leaking into the
 * next one; unrelated inline properties are deliberately preserved.
 */
export function applyThemeProfile(profile: ThemeProfile): void {
  const parsed = themeProfileSchema.parse(profile);
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (!root) return;

  for (const token of CUSTOM_THEME_COLOR_TOKENS) {
    root.style.removeProperty(token);
  }

  const resolved = resolveThemeProfile(parsed);
  for (const [token, value] of Object.entries(resolved.tokens)) {
    root.style.setProperty(token, value);
  }
}
