import {
  ACCENT_PREF_KEY,
  DEFAULT_ACCENT_HEX,
  loadAccentPreferences,
} from './accent-preferences';
import {
  CUSTOM_THEME_COLOR_TOKENS,
  saveCustomTheme,
  type CustomTheme,
  type CustomThemeColorToken,
} from './custom-theme';
import {
  resolveThemeProfile,
  type ThemeProfile,
} from './theme-profiles';
import { normalizeAccentHex } from './accent-preferences';
import type { ResolvedTheme } from './theme-preferences';
import type { ThemePreferencesStorage } from './theme-preferences';

export type EffectiveThemeTokenResult = {
  readonly tokens: Partial<Record<CustomThemeColorToken, string>>;
  readonly accentHex: string;
};

function recomputeDerivedColorTokens(
  tokens: Partial<Record<CustomThemeColorToken, string>>,
  custom: CustomTheme['dark'],
  resolved: ResolvedTheme,
  shouldRecomputeAccentDerived: boolean,
) {
  const isDark = resolved === 'dark';
  const setDerived = (token: CustomThemeColorToken, value: string) => {
    if (custom[token] === undefined) tokens[token] = value;
  };

  if (shouldRecomputeAccentDerived) {
    setDerived(
      '--ui-surface-selected',
      isDark
        ? 'color-mix(in srgb, var(--ui-action-accent) 14%, transparent)'
        : 'color-mix(in srgb, var(--ui-action-accent) 18%, #ffffff)',
    );
    setDerived(
      '--ui-content-accent',
      isDark
        ? 'color-mix(in srgb, var(--ui-action-accent) 55%, white)'
        : 'color-mix(in srgb, var(--ui-action-accent) 68%, black)',
    );
    setDerived(
      '--ui-border-focus',
      isDark
        ? 'color-mix(in srgb, var(--ui-action-accent) 72%, transparent)'
        : 'color-mix(in srgb, var(--ui-action-accent) 58%, transparent)',
    );
    setDerived('--ui-border-selection', 'var(--ui-action-accent)');
    setDerived('--ui-action-selected', 'var(--ui-surface-selected)');
    setDerived(
      '--ui-action-accent-hover',
      isDark
        ? 'color-mix(in srgb, var(--ui-action-accent) 86%, white)'
        : 'color-mix(in srgb, var(--ui-action-accent) 86%, black)',
    );
    setDerived(
      '--ui-action-accent-pressed',
      'color-mix(in srgb, var(--ui-action-accent) 78%, black)',
    );
    setDerived(
      '--ui-action-accent-soft',
      isDark
        ? 'color-mix(in srgb, var(--ui-action-accent) 14%, transparent)'
        : 'color-mix(in srgb, var(--ui-action-accent) 18%, #ffffff)',
    );
  }

  if (custom['--ui-status-danger'] !== undefined) {
    setDerived('--ui-border-danger', isDark
      ? 'color-mix(in srgb, var(--ui-status-danger) 58%, var(--ui-border-divider))'
      : 'color-mix(in srgb, var(--ui-status-danger) 50%, var(--ui-border-divider))');
    setDerived('--ui-action-danger', 'var(--ui-status-danger)');
    setDerived(
      '--ui-action-danger-hover',
      isDark
        ? 'color-mix(in srgb, var(--ui-status-danger) 82%, white)'
        : 'color-mix(in srgb, var(--ui-status-danger) 82%, black)',
    );
    setDerived(
      '--ui-status-danger-surface',
      isDark
        ? 'color-mix(in srgb, var(--ui-status-danger) 14%, var(--ui-surface-raised))'
        : 'color-mix(in srgb, var(--ui-status-danger) 10%, var(--ui-surface-raised))',
    );
    setDerived(
      '--ui-status-danger-content',
      isDark
        ? 'color-mix(in srgb, var(--ui-status-danger) 74%, white)'
        : 'color-mix(in srgb, var(--ui-status-danger) 62%, black)',
    );
  }
}

/**
 * Compose the host profile for the resolved mode and the mode-specific custom
 * overrides in one deterministic order. Keeping this pure makes the
 * precedence contract testable without mounting React or relying on effects.
 *
 * The accent color is composed in three layers: the profile's default, the
 * optional quick theme color, and the advanced custom-theme override. The
 * quick layer stays independent so a profile can be paired with a color,
 * while an explicit advanced override still has the final say.
 */
export function resolveEffectiveThemeTokens(input: {
  readonly themeProfile: ThemeProfile;
  readonly customTheme: CustomTheme;
  readonly resolved: ResolvedTheme;
  readonly themeAccentHex?: string | null;
}): EffectiveThemeTokenResult {
  const profile = resolveThemeProfile(input.themeProfile, input.resolved);
  const tokens: Partial<Record<CustomThemeColorToken, string>> = {};
  const setToken = (token: string, value: string) => {
    if (CUSTOM_THEME_COLOR_TOKENS.includes(token as CustomThemeColorToken)) {
      tokens[token as CustomThemeColorToken] = value;
    }
  };

  for (const [token, value] of Object.entries(profile.tokens)) {
    setToken(token, value);
  }

  const quickAccent = input.themeAccentHex === undefined || input.themeAccentHex === null
    ? null
    : normalizeAccentHex(input.themeAccentHex);
  if (quickAccent) tokens['--ui-action-accent'] = quickAccent;

  const custom = input.customTheme[input.resolved];
  for (const [token, value] of Object.entries(custom)) {
    if (value !== undefined) setToken(token, value);
  }
  recomputeDerivedColorTokens(
    tokens,
    custom,
    input.resolved,
    quickAccent !== null || custom['--ui-action-accent'] !== undefined,
  );

  // The effective accent is the composed --ui-action-accent (custom override
  // wins over the profile's built-in tone variant).
  const accentHex =
    tokens['--ui-action-accent'] ?? profile.tokens['--ui-action-accent'];
  tokens['--ui-action-accent'] = accentHex;

  return { tokens, accentHex };
}

/**
 * One-time migration: the legacy standalone accent preference (accent-prefs
 * v1) becomes a custom-theme override of --ui-action-accent on both tone
 * variants, then the legacy key is removed. A non-default accent survives;
 * the default is simply dropped (profiles now ship their own accent).
 *
 * Pure enough to run inside a state initializer: it reads, merges and
 * persists synchronously and is idempotent (the legacy key is removed on the
 * first run, so a second call is a no-op). Storage failures never throw.
 */
export function migrateLegacyAccentIntoCustomTheme(
  theme: CustomTheme,
  storage?: ThemePreferencesStorage,
): CustomTheme {
  try {
    const legacy = loadAccentPreferences(storage);
    // Resolve the real store (like load/save do) so the legacy key is
    // removed even when the caller passes no storage — ThemeProvider mounts
    // without one, and a no-op removeItem would re-run the migration on
    // every launch.
    const store =
      storage ??
      (globalThis as { localStorage?: ThemePreferencesStorage }).localStorage;
    if (legacy.accentHex === DEFAULT_ACCENT_HEX) {
      store?.removeItem(ACCENT_PREF_KEY);
      return theme;
    }
    const next: CustomTheme = {
      ...theme,
      light: { ...theme.light, '--ui-action-accent': legacy.accentHex },
      dark: { ...theme.dark, '--ui-action-accent': legacy.accentHex },
    };
    saveCustomTheme(next, storage);
    store?.removeItem(ACCENT_PREF_KEY);
    return next;
  } catch {
    // Migration is best-effort; the in-memory theme is still valid.
    return theme;
  }
}
