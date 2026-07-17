import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

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
  readonly setTheme: (theme: ThemePreference) => void;
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
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    readSystemTheme(),
  );

  const resolved = useMemo(
    () => resolveEffectiveTheme(preference, systemTheme),
    [preference, systemTheme],
  );

  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

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

  const value = useMemo(
    () => ({ preference, resolved, setTheme }),
    [preference, resolved, setTheme],
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
