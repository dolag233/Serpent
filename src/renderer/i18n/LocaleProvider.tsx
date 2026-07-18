import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { catalogs } from './catalogs';
import {
  DEFAULT_LOCALE,
  loadLocalePreferences,
  readSystemLocale,
  resolveEffectiveLocale,
  setStoredLocale,
  type LocalePreference,
  type LocalePreferencesStorage,
} from './locale-preferences';
import {
  createTranslator,
  type AppLocale,
  type TranslateParams,
} from './types';

export type TranslateFn = (key: string, params?: TranslateParams) => string;

type LocaleContextValue = {
  readonly preference: LocalePreference;
  readonly locale: AppLocale;
  readonly setLocale: (locale: LocalePreference) => void;
  readonly t: TranslateFn;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export type LocaleProviderProps = {
  readonly children: ReactNode;
  readonly storage?: LocalePreferencesStorage;
  readonly initialPreference?: LocalePreference;
};

export function LocaleProvider({
  children,
  storage,
  initialPreference,
}: LocaleProviderProps) {
  const [preference, setPreferenceState] = useState<LocalePreference>(
    () => initialPreference ?? loadLocalePreferences(storage).locale,
  );
  const [systemLocale, setSystemLocale] = useState<AppLocale>(() =>
    readSystemLocale(),
  );

  const locale = useMemo(
    () => resolveEffectiveLocale(preference, systemLocale),
    [preference, systemLocale],
  );

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // languagechange is the closest portable signal when OS locale changes.
    const onLanguageChange = () => setSystemLocale(readSystemLocale());
    window.addEventListener('languagechange', onLanguageChange);
    return () => window.removeEventListener('languagechange', onLanguageChange);
  }, []);

  const setLocale = useCallback(
    (next: LocalePreference) => {
      setStoredLocale(next, storage);
      setPreferenceState(next);
    },
    [storage],
  );

  const t = useMemo(() => {
    const primary = catalogs[locale];
    const fallback = locale === DEFAULT_LOCALE ? undefined : catalogs[DEFAULT_LOCALE];
    return createTranslator(primary, fallback);
  }, [locale]);

  const value = useMemo(
    () => ({ preference, locale, setLocale, t }),
    [preference, locale, setLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return value;
}

export function useT(): TranslateFn {
  return useLocale().t;
}

export function translateForLocale(
  locale: AppLocale,
  key: string,
  params?: TranslateParams,
): string {
  const primary = catalogs[locale];
  const fallback =
    locale === DEFAULT_LOCALE ? undefined : catalogs[DEFAULT_LOCALE];
  return createTranslator(primary, fallback)(key, params);
}
