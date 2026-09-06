import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyFontSizePreferences,
  loadFontSizePreferences,
  setStoredFontSizePreference,
  type FontSizePreference,
  type FontSizePreferences,
  type FontSizePreferencesStorage,
} from "./font-size-preferences";

type FontSizeContextValue = {
  readonly preferences: FontSizePreferences;
  readonly setPreference: (preference: FontSizePreference) => void;
};

const FontSizeContext = createContext<FontSizeContextValue | null>(null);

export type FontSizeProviderProps = {
  readonly children: ReactNode;
  readonly storage?: FontSizePreferencesStorage;
  readonly initialPreferences?: FontSizePreferences;
};

export function FontSizeProvider({
  children,
  storage,
  initialPreferences,
}: FontSizeProviderProps) {
  const [preferences, setPreferences] = useState<FontSizePreferences>(
    () => initialPreferences ?? loadFontSizePreferences(storage),
  );

  useEffect(() => {
    applyFontSizePreferences(preferences);
  }, [preferences]);

  const setPreference = useCallback(
    (preference: FontSizePreference) => {
      setPreferences(setStoredFontSizePreference(preference, storage));
    },
    [storage],
  );

  const value = useMemo(
    () => ({ preferences, setPreference }),
    [preferences, setPreference],
  );

  return (
    <FontSizeContext.Provider value={value}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize(): FontSizeContextValue {
  const value = useContext(FontSizeContext);
  if (!value) {
    throw new Error("useFontSize must be used within FontSizeProvider");
  }
  return value;
}
