import { z } from 'zod';

import type { ThemePreferencesStorage } from './theme-preferences';

/**
 * User theme contract v1.
 *
 * This is intentionally a color-only surface. Layout, geometry, typography,
 * elevation, and stacking tokens are not user-overridable through this API.
 */
export const CUSTOM_THEME_VERSION = 1 as const;
export const CUSTOM_THEME_PREF_KEY = 'serpent.custom-theme.v1';

export const CUSTOM_THEME_COLOR_TOKENS = [
  '--ui-surface-canvas',
  '--ui-surface-pane',
  '--ui-surface-raised',
  '--ui-surface-raised-subtle',
  '--ui-surface-overlay',
  '--ui-surface-scrim',
  '--ui-surface-hover',
  '--ui-surface-pressed',
  '--ui-surface-selected',
  '--ui-surface-disabled',
  '--ui-content-primary',
  '--ui-content-secondary',
  '--ui-content-tertiary',
  '--ui-content-disabled',
  '--ui-content-inverse',
  '--ui-content-on-accent',
  '--ui-content-accent',
  '--ui-border-divider',
  '--ui-border-subtle',
  '--ui-border-control',
  '--ui-border-focus',
  '--ui-border-selection',
  '--ui-border-danger',
  '--ui-action-accent',
  '--ui-action-accent-hover',
  '--ui-action-accent-pressed',
  '--ui-action-accent-soft',
  '--ui-action-hover',
  '--ui-action-pressed',
  '--ui-action-selected',
  '--ui-action-disabled',
  '--ui-action-danger',
  '--ui-action-danger-hover',
  '--ui-status-info',
  '--ui-status-info-surface',
  '--ui-status-info-content',
  '--ui-status-success',
  '--ui-status-success-surface',
  '--ui-status-success-content',
  '--ui-status-warning',
  '--ui-status-warning-surface',
  '--ui-status-warning-content',
  '--ui-status-danger',
  '--ui-status-danger-surface',
  '--ui-status-danger-content',
] as const;

export type CustomThemeColorToken = (typeof CUSTOM_THEME_COLOR_TOKENS)[number];
export type CustomThemeMode = 'light' | 'dark';

const customThemeColorValueSchema = z
  .string()
  .trim()
  .max(11)
  .regex(
    /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6,8}|transparent)$/iu,
    'Theme values must be bounded hex colors or transparent.',
  );

const customThemeOverridesShape = Object.fromEntries(
  CUSTOM_THEME_COLOR_TOKENS.map((token) => [
    token,
    customThemeColorValueSchema.optional(),
  ]),
);

/** Strictly rejects unknown CSS variable names, including non-color tokens. */
export const customThemeOverridesSchema = z.strictObject(
  customThemeOverridesShape,
);

/** Versioned persisted user theme. Each mode is a partial color-token map. */
export const customThemeSchema = z.strictObject({
  version: z.literal(CUSTOM_THEME_VERSION),
  light: customThemeOverridesSchema.default({}),
  dark: customThemeOverridesSchema.default({}),
});

export type CustomThemeOverrides = z.infer<typeof customThemeOverridesSchema>;
export type CustomTheme = z.infer<typeof customThemeSchema>;

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  version: CUSTOM_THEME_VERSION,
  light: {},
  dark: {},
};

function defaultCustomTheme(): CustomTheme {
  return {
    version: CUSTOM_THEME_VERSION,
    light: {},
    dark: {},
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
      'CustomTheme: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return localStorage;
}

export function loadCustomTheme(
  storage?: ThemePreferencesStorage,
): CustomTheme {
  const store = resolveStorage(storage);
  const raw = store.getItem(CUSTOM_THEME_PREF_KEY);
  if (!raw) return defaultCustomTheme();

  try {
    const parsed = customThemeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultCustomTheme();
  } catch {
    return defaultCustomTheme();
  }
}

export function saveCustomTheme(
  theme: CustomTheme,
  storage?: ThemePreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const parsed = customThemeSchema.parse(theme);
  store.setItem(CUSTOM_THEME_PREF_KEY, JSON.stringify(parsed));
}

function clearAppliedCustomTheme(root: HTMLElement): void {
  for (const token of CUSTOM_THEME_COLOR_TOKENS) {
    root.style.removeProperty(token);
  }
}

/**
 * Apply only the selected mode's overrides. Every managed token is removed
 * first, so switching modes cannot leave stale values behind.
 */
export function applyCustomTheme(
  theme: CustomTheme,
  mode: CustomThemeMode,
): void {
  const parsed = customThemeSchema.parse(theme);
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (!root) return;
  clearAppliedCustomTheme(root);

  for (const [token, value] of Object.entries(parsed[mode])) {
    if (value !== undefined) {
      root.style.setProperty(token, value);
    }
  }
}

/**
 * Remove all managed inline overrides and the persisted theme.
 *
 * The persisted key is removed through resolveStorage (like load/save), not
 * gated on the optional argument: callers that pass nothing (the default
 * localStorage) used to skip the removeItem and only clear inline styles, so
 * the overrides reappeared on the next load — the "clear button does nothing"
 * report.
 */
export function clearCustomTheme(storage?: ThemePreferencesStorage): void {
  try {
    resolveStorage(storage).removeItem(CUSTOM_THEME_PREF_KEY);
  } catch {
    // Storage failure is harmless; inline state is still cleared below.
  }
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (root) clearAppliedCustomTheme(root);
}
