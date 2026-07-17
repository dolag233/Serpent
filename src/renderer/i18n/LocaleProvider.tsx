import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { catalogs } from './catalogs';
import {
  DEFAULT_LOCALE,
  loadLocalePreferences,
  setStoredLocale,
  type LocalePreferencesStorage,
} from './locale-preferences';
import {
  createTranslator,
  type AppLocale,
  type TranslateParams,
} from './types';

export type TranslateFn = (key: string, params?: TranslateParams) => string;

type LocaleContextValue = {
  readonly locale: AppLocale;
  readonly setLocale: (locale: AppLocale) => void;
  readonly t: TranslateFn;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export type LocaleProviderProps = {
  readonly children: ReactNode;
  /** Injected storage for tests; defaults to localStorage. */
  readonly storage?: LocalePreferencesStorage;
  /** Override initial locale (tests); otherwise load from storage. */
  readonly initialLocale?: AppLocale;
};

export function LocaleProvider({
  children,
  storage,
  initialLocale,
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<AppLocale>(
    () => initialLocale ?? loadLocalePreferences(storage).locale,
  );

  const setLocale = useCallback(
    (next: AppLocale) => {
      setStoredLocale(next, storage);
      setLocaleState(next);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = next;
      }
    },
    [storage],
  );

  const t = useMemo(() => {
    const primary = catalogs[locale];
    const fallback = locale === DEFAULT_LOCALE ? undefined : catalogs[DEFAULT_LOCALE];
    return createTranslator(primary, fallback);
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
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

/** Convenience hook when only translation is needed. */
export function useT(): TranslateFn {
  return useLocale().t;
}

/**
 * Non-React lookup for modules that resolve labels outside hooks
 * (command registries, pure helpers). Prefer useT() in components.
 */
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
