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
  applyShadowPreferences,
  clampShadowLevel,
  loadShadowPreferences,
  setStoredShadowLevel,
  type ShadowLevel,
  type ShadowPreferences,
  type ShadowPreferencesStorage,
} from "./shadow-preferences";

type ElevationContextValue = {
  readonly preferences: ShadowPreferences;
  readonly setLevel: (level: ShadowLevel) => void;
};

const ElevationContext = createContext<ElevationContextValue | null>(null);

export type ElevationProviderProps = {
  readonly children: ReactNode;
  readonly storage?: ShadowPreferencesStorage;
  readonly initialPreferences?: ShadowPreferences;
};

/**
 * Elevation prefs (Serpent-zcyg): 0–3 stepped levels drive CSS `--elev-*`
 * multipliers. Level 0 omits experimental shell/card box-shadows.
 */
export function ElevationProvider({
  children,
  storage,
  initialPreferences,
}: ElevationProviderProps) {
  const [preferences, setPreferences] = useState<ShadowPreferences>(
    () => initialPreferences ?? loadShadowPreferences(storage),
  );

  useEffect(() => {
    applyShadowPreferences(preferences);
  }, [preferences]);

  const setLevel = useCallback(
    (level: ShadowLevel) => {
      setPreferences(setStoredShadowLevel(clampShadowLevel(level), storage));
    },
    [storage],
  );

  const value = useMemo(
    () => ({ preferences, setLevel }),
    [preferences, setLevel],
  );

  return (
    <ElevationContext.Provider value={value}>
      {children}
    </ElevationContext.Provider>
  );
}

export function useElevation(): ElevationContextValue {
  const value = useContext(ElevationContext);
  if (!value) {
    throw new Error("useElevation must be used within ElevationProvider");
  }
  return value;
}
