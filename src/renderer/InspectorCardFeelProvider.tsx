import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  loadInspectorCardFeelPreferences,
  setInspectorCardFeelEnabled,
  type InspectorCardFeelPreferences,
  type InspectorCardFeelPreferencesStorage,
} from "./inspector-card-feel-preferences";

type InspectorCardFeelContextValue = {
  readonly enabled: boolean;
  readonly preferences: InspectorCardFeelPreferences;
  readonly setEnabled: (enabled: boolean) => void;
  readonly toggle: () => void;
};

const InspectorCardFeelContext =
  createContext<InspectorCardFeelContextValue | null>(null);

export type InspectorCardFeelProviderProps = {
  readonly children: ReactNode;
  readonly storage?: InspectorCardFeelPreferencesStorage;
  readonly initialPreferences?: InspectorCardFeelPreferences;
};

export function InspectorCardFeelProvider({
  children,
  storage,
  initialPreferences,
}: InspectorCardFeelProviderProps) {
  const [preferences, setPreferences] = useState<InspectorCardFeelPreferences>(
    () => initialPreferences ?? loadInspectorCardFeelPreferences(storage),
  );

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setPreferences(setInspectorCardFeelEnabled(enabled, storage));
    },
    [storage],
  );

  const toggle = useCallback(() => {
    setEnabled(!preferences.enabled);
  }, [preferences.enabled, setEnabled]);

  const value = useMemo(
    () => ({
      enabled: preferences.enabled,
      preferences,
      setEnabled,
      toggle,
    }),
    [preferences, setEnabled, toggle],
  );

  return (
    <InspectorCardFeelContext.Provider value={value}>
      {children}
    </InspectorCardFeelContext.Provider>
  );
}

export function useInspectorCardFeel(): InspectorCardFeelContextValue {
  const value = useContext(InspectorCardFeelContext);
  if (!value) {
    throw new Error(
      "useInspectorCardFeel must be used within InspectorCardFeelProvider",
    );
  }
  return value;
}
