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
  applyMenuAcrylicPreferences,
  clampMenuAcrylicLevel,
  loadMenuAcrylicPreferences,
  setStoredMenuAcrylicLevel,
  type MenuAcrylicLevel,
  type MenuAcrylicPreferences,
  type MenuAcrylicPreferencesStorage,
} from "./menu-acrylic-preferences";

type MenuAcrylicContextValue = {
  readonly preferences: MenuAcrylicPreferences;
  readonly setLevel: (level: MenuAcrylicLevel) => void;
};

const MenuAcrylicContext = createContext<MenuAcrylicContextValue | null>(null);

export type MenuAcrylicProviderProps = {
  readonly children: ReactNode;
  readonly storage?: MenuAcrylicPreferencesStorage;
  readonly initialPreferences?: MenuAcrylicPreferences;
};

export function MenuAcrylicProvider({
  children,
  storage,
  initialPreferences,
}: MenuAcrylicProviderProps) {
  const [preferences, setPreferences] = useState<MenuAcrylicPreferences>(
    () => initialPreferences ?? loadMenuAcrylicPreferences(storage),
  );

  useEffect(() => {
    applyMenuAcrylicPreferences(preferences);
  }, [preferences]);

  const setLevel = useCallback(
    (level: MenuAcrylicLevel) => {
      setPreferences(
        setStoredMenuAcrylicLevel(clampMenuAcrylicLevel(level), storage),
      );
    },
    [storage],
  );

  const value = useMemo(
    () => ({ preferences, setLevel }),
    [preferences, setLevel],
  );

  return (
    <MenuAcrylicContext.Provider value={value}>
      {children}
    </MenuAcrylicContext.Provider>
  );
}

export function useMenuAcrylic(): MenuAcrylicContextValue {
  const value = useContext(MenuAcrylicContext);
  if (!value) {
    throw new Error("useMenuAcrylic must be used within MenuAcrylicProvider");
  }
  return value;
}
