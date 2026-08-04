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
  applyAccentColor,
  DEFAULT_ACCENT_HEX,
  loadAccentPreferences,
  setStoredAccentHex,
} from './accent-preferences';
import {
  clearCustomTheme,
  loadCustomTheme,
  saveCustomTheme,
  type CustomTheme,
} from './custom-theme';
import { CUSTOM_THEME_COLOR_TOKENS } from './custom-theme';
import { resolveEffectiveThemeTokens } from './theme-composition';
import {
  loadThemeProfile,
  resolveThemeProfile,
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
  readonly accentHex: string;
  readonly customTheme: CustomTheme;
  readonly themeProfile: ThemeProfile;
  readonly backgroundPreferences: BackgroundPreferences;
  readonly themeRevision: number;
  readonly setTheme: (theme: ThemePreference) => void;
  readonly setAccentHex: (hex: string) => void;
  readonly setCustomTheme: (theme: CustomTheme) => void;
  readonly resetCustomTheme: () => void;
  readonly setThemeProfile: (profile: ThemeProfileId) => void;
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
  const [accentHex, setAccentHexState] = useState(
    () => loadAccentPreferences(storage).accentHex,
  );
  const [customTheme, setCustomThemeState] = useState<CustomTheme>(() => loadCustomTheme(storage));
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
    applyAccentColor(accentHex);
  }, [accentHex]);

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
      accentHex,
      defaultAccentHex: DEFAULT_ACCENT_HEX,
    });
    for (const [token, value] of Object.entries(composition.tokens)) {
      root.style.setProperty(token, value);
    }
    root.style.setProperty('--accent', composition.accentHex);
  }, [accentHex, customTheme, resolved, themeProfile]);

  useEffect(() => {
    applyBackgroundPreferences(backgroundPreferences);
  }, [backgroundPreferences]);

  useEffect(() => {
    const signature = `${resolved}:${accentHex}:${JSON.stringify(customTheme)}:${JSON.stringify(themeProfile)}:${JSON.stringify(backgroundPreferences)}`;
    if (themeSignatureRef.current === signature) return;
    themeSignatureRef.current = signature;
    setThemeRevision((revision) => revision + 1);
  }, [accentHex, backgroundPreferences, customTheme, resolved, themeProfile]);

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

  const setAccentHex = useCallback(
    (hex: string) => {
      const next = setStoredAccentHex(hex, storage);
      setAccentHexState(next.accentHex);
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
    const mode = resolveThemeProfile(next).mode;
    setStoredTheme(mode, storage);
    setPreferenceState(mode);
  }, [storage]);

  const setBackgroundPreferences = useCallback((next: BackgroundPreferences) => {
    const saved = saveBackgroundPreferences(next, storage);
    if (saved) setBackgroundPreferencesState(next);
    return saved;
  }, [storage]);

  const value = useMemo(
    () => ({
      preference,
      resolved,
      accentHex,
      customTheme,
      themeProfile,
      backgroundPreferences,
      themeRevision,
      setTheme,
      setAccentHex,
      setCustomTheme,
      resetCustomTheme,
      setThemeProfile,
      setBackgroundPreferences,
    }),
    [accentHex, backgroundPreferences, customTheme, preference, resetCustomTheme, resolved, setAccentHex, setBackgroundPreferences, setCustomTheme, setTheme, setThemeProfile, themeProfile, themeRevision],
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
