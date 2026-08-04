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
  applyAccentColor,
  loadAccentPreferences,
  setStoredAccentHex,
} from './accent-preferences';
import {
  applyCustomTheme,
  clearCustomTheme,
  loadCustomTheme,
  saveCustomTheme,
  type CustomTheme,
} from './custom-theme';
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
  readonly themeRevision: number;
  readonly setTheme: (theme: ThemePreference) => void;
  readonly setAccentHex: (hex: string) => void;
  readonly setCustomTheme: (theme: CustomTheme) => void;
  readonly resetCustomTheme: () => void;
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
    applyCustomTheme(customTheme, resolved);
  }, [customTheme, resolved]);

  useEffect(() => {
    applyAccentColor(accentHex);
  }, [accentHex]);

  useEffect(() => {
    const signature = `${resolved}:${accentHex}:${JSON.stringify(customTheme)}`;
    if (themeSignatureRef.current === signature) return;
    themeSignatureRef.current = signature;
    setThemeRevision((revision) => revision + 1);
  }, [accentHex, customTheme, resolved]);

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

  const value = useMemo(
    () => ({
      preference,
      resolved,
      accentHex,
      customTheme,
      themeRevision,
      setTheme,
      setAccentHex,
      setCustomTheme,
      resetCustomTheme,
    }),
    [accentHex, customTheme, preference, resetCustomTheme, resolved, setAccentHex, setCustomTheme, setTheme, themeRevision],
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
