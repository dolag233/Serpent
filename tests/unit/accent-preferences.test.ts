import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACCENT_HEX,
  loadAccentPreferences,
  normalizeAccentHex,
  setStoredAccentHex,
} from "../../src/renderer/theme/accent-preferences";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("accent-preferences (Serpent-lti3)", () => {
  it("normalizes hex colors", () => {
    expect(normalizeAccentHex("3b82f6")).toBe("#3b82f6");
    expect(normalizeAccentHex("#ABC123")).toBe("#abc123");
    expect(normalizeAccentHex("not-a-color")).toBeNull();
  });

  it("persists accent hex in storage", () => {
    const storage = memoryStorage();
    expect(loadAccentPreferences(storage).accentHex).toBe(DEFAULT_ACCENT_HEX);
    const saved = setStoredAccentHex("#ef4444", storage);
    expect(saved.accentHex).toBe("#ef4444");
    expect(loadAccentPreferences(storage).accentHex).toBe("#ef4444");
  });
});
