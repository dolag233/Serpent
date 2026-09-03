import { describe, expect, it } from 'vitest';

import {
  THEME_ACCENT_PREF_KEY,
  THEME_ACCENT_PRESETS,
  loadThemeAccent,
  saveThemeAccent,
  themeAccentPresetByHex,
} from '../../src/renderer/theme/theme-accent-preferences';

function memoryStorage(initial: Record<string, string> = {}) {
  const memory = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    memory,
  };
}

describe('theme accent preferences', () => {
  it('ships the quick color palette with stable labels and hex values', () => {
    expect(THEME_ACCENT_PRESETS).toHaveLength(8);
    expect(THEME_ACCENT_PRESETS.every((preset) => /^#[0-9a-f]{6}$/iu.test(preset.hex))).toBe(true);
    expect(themeAccentPresetByHex('#8B5CF6')).toBe('purple');
    expect(themeAccentPresetByHex('#123456')).toBeNull();
  });

  it('persists a normalized quick color and falls back on corrupt data', () => {
    const storage = memoryStorage();

    expect(loadThemeAccent(storage)).toBeNull();
    expect(saveThemeAccent('#8B5CF6', storage)).toBe('#8b5cf6');
    expect(loadThemeAccent(storage)).toBe('#8b5cf6');
    expect(storage.memory.get(THEME_ACCENT_PREF_KEY)).toContain('#8b5cf6');

    storage.memory.set(THEME_ACCENT_PREF_KEY, '{not-json');
    expect(loadThemeAccent(storage)).toBeNull();
    storage.memory.set(THEME_ACCENT_PREF_KEY, JSON.stringify({ version: 2, accentHex: '#8b5cf6' }));
    expect(loadThemeAccent(storage)).toBeNull();
  });

  it('rejects values outside the six-digit hex contract', () => {
    const storage = memoryStorage();
    expect(() => saveThemeAccent('var(--secret)', storage)).toThrow();
    expect(() => saveThemeAccent('#fff', storage)).toThrow();
  });
});
