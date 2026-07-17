import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREF_KEY,
  loadThemePreferences,
  resolveEffectiveTheme,
  setStoredTheme,
} from '../../src/renderer/theme';

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    memory,
  };
}

describe('theme preferences', () => {
  it('defaults to dark until clarification #11 changes policy', () => {
    const storage = memoryStorage();
    expect(loadThemePreferences(storage).theme).toBe(DEFAULT_THEME_PREFERENCE);
    expect(DEFAULT_THEME_PREFERENCE).toBe('dark');
  });

  it('round-trips light/dark/system through injectable storage', () => {
    const storage = memoryStorage();
    setStoredTheme('light', storage);
    expect(loadThemePreferences(storage).theme).toBe('light');
    setStoredTheme('system', storage);
    expect(loadThemePreferences(storage).theme).toBe('system');
    expect(storage.memory.get(THEME_PREF_KEY)).toContain('"system"');
  });

  it('falls back to default on corrupt storage', () => {
    const storage = memoryStorage();
    storage.setItem(THEME_PREF_KEY, '{not-json');
    expect(loadThemePreferences(storage).theme).toBe('dark');
  });
});

describe('resolveEffectiveTheme', () => {
  it('returns explicit preference as-is', () => {
    expect(resolveEffectiveTheme('light', 'dark')).toBe('light');
    expect(resolveEffectiveTheme('dark', 'light')).toBe('dark');
  });

  it('follows system when preference is system', () => {
    expect(resolveEffectiveTheme('system', 'light')).toBe('light');
    expect(resolveEffectiveTheme('system', 'dark')).toBe('dark');
  });
});
