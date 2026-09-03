import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  applyBackgroundPreferences,
  loadBackgroundPreferences,
  saveBackgroundPreferences,
  type BackgroundPreferences,
} from './background-preferences';
import {
  clearCustomTheme,
  loadCustomTheme,
  saveCustomTheme,
  type CustomTheme,
} from './custom-theme';
import { CUSTOM_THEME_COLOR_TOKENS } from './custom-theme';
import {
  migrateLegacyAccentIntoCustomTheme,
  resolveEffectiveThemeTokens,
} from './theme-composition';
import {
  loadThemeAccent,
  saveThemeAccent,
} from './theme-accent-preferences';
import {
  loadThemeProfile,
  saveThemeProfile,
  THEME_PROFILE_VERSION,
  type ThemeProfile,
  type ThemeProfileId,
} from './theme-profiles';
import {
  applyResolvedTheme,
  loadThemePreferences,
  readSystemTheme,
  resolveEffectiveTheme,
  setStoredTheme,
  type ResolvedTheme,
  type ThemePreference,
  type ThemePreferencesStorage,
} from './theme-preferences';

type ThemeContextValue = {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly customTheme: CustomTheme;
  readonly themeAccentHex: string | null;
  readonly themeProfile: ThemeProfile;
  readonly backgroundPreferences: BackgroundPreferences;
  readonly themeRevision: number;
  readonly setTheme: (theme: ThemePreference) => void;
  readonly setCustomTheme: (theme: CustomTheme) => void;
  readonly resetCustomTheme: () => void;
  readonly setThemeProfile: (profile: ThemeProfileId) => void;
  readonly setThemeAccent: (accentHex: string) => void;
  readonly setBackgroundPreferences: (preferences: BackgroundPreferences) => boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export type ThemeProviderProps = {
  readonly children: ReactNode;
  readonly storage?: ThemePreferencesStorage;
  readonly initialPreference?: ThemePreference;
};

export function ThemeProvider({
  children,
  storage,
  initialPreference,
}: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    () => initialPreference ?? loadThemePreferences(storage).theme,
  );
  const [customTheme, setCustomThemeState] = useState<CustomTheme>(() =>
    // The legacy standalone accent preference migrates into a custom-theme
    // override here, once, before anything else reads the theme.
    migrateLegacyAccentIntoCustomTheme(loadCustomTheme(storage), storage),
  );
  const [themeAccentHex, setThemeAccentState] = useState<string | null>(() =>
    loadThemeAccent(storage),
  );
  const [themeProfile, setThemeProfileState] = useState<ThemeProfile>(() => loadThemeProfile(storage));
  const [backgroundPreferences, setBackgroundPreferencesState] = useState<BackgroundPreferences>(() => loadBackgroundPreferences(storage));
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    readSystemTheme(),
  );
  const [themeRevision, setThemeRevision] = useState(0);
  const themeSignatureRef = useRef('');

  const resolved = useMemo(
    () => resolveEffectiveTheme(preference, systemTheme),
    [preference, systemTheme],
  );

  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const token of CUSTOM_THEME_COLOR_TOKENS) {
      root.style.removeProperty(token);
    }
    const composition = resolveEffectiveThemeTokens({
      themeProfile,
      customTheme,
      resolved,
      themeAccentHex,
    });
    for (const [token, value] of Object.entries(composition.tokens)) {
      root.style.setProperty(token, value);
    }
    root.style.setProperty('--accent', composition.accentHex);
  }, [customTheme, resolved, themeAccentHex, themeProfile]);

  useEffect(() => {
    applyBackgroundPreferences(backgroundPreferences);
  }, [backgroundPreferences]);

  useEffect(() => {
    const signature = `${resolved}:${JSON.stringify(customTheme)}:${JSON.stringify(themeAccentHex)}:${JSON.stringify(themeProfile)}:${JSON.stringify(backgroundPreferences)}`;
    if (themeSignatureRef.current === signature) return;
    themeSignatureRef.current = signature;
    setThemeRevision((revision) => revision + 1);
  }, [backgroundPreferences, customTheme, resolved, themeAccentHex, themeProfile]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystemTheme(readSystemTheme());
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setStoredTheme(next, storage);
      setPreferenceState(next);
    },
    [storage],
  );

  const setCustomTheme = useCallback((next: CustomTheme) => {
    saveCustomTheme(next, storage);
    setCustomThemeState(next);
  }, [storage]);

  const resetCustomTheme = useCallback(() => {
    clearCustomTheme(storage);
    setCustomThemeState(loadCustomTheme(storage));
  }, [storage]);

  const setThemeProfile = useCallback((preset: ThemeProfileId) => {
    const next: ThemeProfile = { version: THEME_PROFILE_VERSION, preset, overrides: {} };
    saveThemeProfile(next, storage);
    setThemeProfileState(next);
    // Light/dark is orthogonal to the theme: picking a profile must not flip
    // the global light/dark preference.
  }, [storage]);

  const setThemeAccent = useCallback((accentHex: string) => {
    const nextHex = saveThemeAccent(accentHex, storage);
    setThemeAccentState(nextHex);
    // A quick color is an intentional shortcut for the accent only. Remove
    // the advanced accent override so clicking a swatch always takes effect;
    // every other advanced color remains untouched.
    const nextCustomTheme: CustomTheme = {
      ...customTheme,
      light: { ...customTheme.light },
      dark: { ...customTheme.dark },
    };
    delete nextCustomTheme.light['--ui-action-accent'];
    delete nextCustomTheme.dark['--ui-action-accent'];
    saveCustomTheme(nextCustomTheme, storage);
    setCustomThemeState(nextCustomTheme);
  }, [customTheme, storage]);

  const setBackgroundPreferences = useCallback((next: BackgroundPreferences) => {
    const saved = saveBackgroundPreferences(next, storage);
    if (saved) setBackgroundPreferencesState(next);
    return saved;
  }, [storage]);

  const value = useMemo(
    () => ({
      preference,
      resolved,
      customTheme,
      themeAccentHex,
      themeProfile,
      backgroundPreferences,
      themeRevision,
      setTheme,
      setCustomTheme,
      resetCustomTheme,
      setThemeProfile,
      setThemeAccent,
      setBackgroundPreferences,
    }),
    [backgroundPreferences, customTheme, preference, resetCustomTheme, resolved, setBackgroundPreferences, setCustomTheme, setTheme, setThemeAccent, setThemeProfile, themeAccentHex, themeProfile, themeRevision],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return value;
}
