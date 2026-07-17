import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shell panel-width preferences (REQ-SHELL-007)
//
// The left navigation pane and the right Inspector pane are user-resizable;
// the chosen widths survive a full app restart. Versioned + Zod-validated +
// storage-injectable, mirroring canvas-preferences.ts. Kept separate from
// canvas preferences because shell layout and canvas display are unrelated
// concerns.
// ---------------------------------------------------------------------------

export interface ShellPreferences {
  readonly version: 1;
  /** Left navigation pane width in px. */
  readonly navPanelWidth: number;
  /** Right Inspector pane width in px. */
  readonly inspectorPanelWidth: number;
}

export interface ShellPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const NAV_PANEL_WIDTH_MIN = 200;
export const NAV_PANEL_WIDTH_MAX = 420;
export const INSPECTOR_PANEL_WIDTH_MIN = 260;
export const INSPECTOR_PANEL_WIDTH_MAX = 560;

/** Matches the historical fixed layout widths in styles.css (.app-shell). */
export const DEFAULT_NAV_PANEL_WIDTH = 224;
export const DEFAULT_INSPECTOR_PANEL_WIDTH = 268;

const shellPreferencesSchema = z.object({
  version: z.literal(1),
  navPanelWidth: z
    .number()
    .int()
    .min(NAV_PANEL_WIDTH_MIN)
    .max(NAV_PANEL_WIDTH_MAX),
  inspectorPanelWidth: z
    .number()
    .int()
    .min(INSPECTOR_PANEL_WIDTH_MIN)
    .max(INSPECTOR_PANEL_WIDTH_MAX),
});

export const SHELL_PREF_KEY = 'serpent.shell-prefs.v1';

export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = {
  version: 1,
  navPanelWidth: DEFAULT_NAV_PANEL_WIDTH,
  inspectorPanelWidth: DEFAULT_INSPECTOR_PANEL_WIDTH,
};

export function clampNavPanelWidth(value: number): number {
  return Math.min(
    NAV_PANEL_WIDTH_MAX,
    Math.max(NAV_PANEL_WIDTH_MIN, Math.round(value)),
  );
}

export function clampInspectorPanelWidth(value: number): number {
  return Math.min(
    INSPECTOR_PANEL_WIDTH_MAX,
    Math.max(INSPECTOR_PANEL_WIDTH_MIN, Math.round(value)),
  );
}

function resolveStorage(storage?: ShellPreferencesStorage): ShellPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: ShellPreferencesStorage }).localStorage;
  if (!ls) {
    throw new Error(
      'ShellPreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return ls;
}

/**
 * Load shell preferences from storage. Returns the stored v1 value only when
 * it passes Zod validation; absent/corrupt/out-of-range values fall back to
 * the default widths (there is no legacy key to migrate — this is a new
 * preference family).
 */
export function loadShellPreferences(
  storage?: ShellPreferencesStorage,
): ShellPreferences {
  const s = resolveStorage(storage);
  const raw = s.getItem(SHELL_PREF_KEY);
  if (raw === null) return DEFAULT_SHELL_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SHELL_PREFERENCES;
  }
  const result = shellPreferencesSchema.safeParse(parsed);
  return result.success ? result.data : DEFAULT_SHELL_PREFERENCES;
}

/**
 * Persist shell preferences. Widths are clamped before writing so the stored
 * value is always valid; the input object is not mutated.
 */
export function saveShellPreferences(
  prefs: ShellPreferences,
  storage?: ShellPreferencesStorage,
): void {
  const s = resolveStorage(storage);
  const cleaned: ShellPreferences = {
    version: 1,
    navPanelWidth: clampNavPanelWidth(prefs.navPanelWidth),
    inspectorPanelWidth: clampInspectorPanelWidth(prefs.inspectorPanelWidth),
  };
  s.setItem(SHELL_PREF_KEY, JSON.stringify(cleaned));
}
