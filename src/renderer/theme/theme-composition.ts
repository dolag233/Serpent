import {
  CUSTOM_THEME_COLOR_TOKENS,
  type CustomTheme,
  type CustomThemeColorToken,
} from './custom-theme';
import {
  resolveThemeProfile,
  type ThemeProfile,
} from './theme-profiles';
import type { ResolvedTheme } from './theme-preferences';

export type EffectiveThemeTokenResult = {
  readonly tokens: Partial<Record<CustomThemeColorToken, string>>;
  readonly accentHex: string;
};

/**
 * Compose the host profile, mode-specific custom overrides, and the explicit
 * accent preference in one deterministic order. Keeping this pure makes the
 * precedence contract testable without mounting React or relying on effects.
 */
export function resolveEffectiveThemeTokens(input: {
  readonly themeProfile: ThemeProfile;
  readonly customTheme: CustomTheme;
  readonly resolved: ResolvedTheme;
  readonly accentHex: string;
  readonly defaultAccentHex: string;
}): EffectiveThemeTokenResult {
  const profile = resolveThemeProfile(input.themeProfile);
  const tokens: Partial<Record<CustomThemeColorToken, string>> = {};
  const setToken = (token: string, value: string) => {
    if (CUSTOM_THEME_COLOR_TOKENS.includes(token as CustomThemeColorToken)) {
      tokens[token as CustomThemeColorToken] = value;
    }
  };

  if (profile.mode === input.resolved) {
    for (const [token, value] of Object.entries(profile.tokens)) {
      setToken(token, value);
    }
  }

  const custom = input.customTheme[input.resolved];
  for (const [token, value] of Object.entries(custom)) {
    if (value !== undefined) setToken(token, value);
  }

  const customAccent = custom['--ui-action-accent'];
  const profileAccent = profile.mode === input.resolved
    ? profile.tokens['--ui-action-accent']
    : undefined;
  const accentHex = customAccent
    ?? (input.accentHex === input.defaultAccentHex ? profileAccent : undefined)
    ?? input.accentHex;

  if (customAccent === undefined) {
    tokens['--ui-action-accent'] = accentHex;
  }

  return { tokens, accentHex };
}
