import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ACCENT_PREF_KEY,
  DEFAULT_ACCENT_HEX,
  loadAccentPreferences,
  normalizeAccentHex,
  setStoredAccentHex,
  type AccentPreferencesStorage,
} from '../../src/renderer/theme/accent-preferences';

function memoryStorage(
  initial: Record<string, string> = {},
): AccentPreferencesStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('accent-preferences (Serpent-qw6x / THEME-018)', () => {
  it('normalizes hex colors', () => {
    expect(normalizeAccentHex('3b82f6')).toBe('#3b82f6');
    expect(normalizeAccentHex('#ABC123')).toBe('#abc123');
    expect(normalizeAccentHex('not-a-color')).toBeNull();
  });

  it('persists accent hex in storage', () => {
    const storage = memoryStorage();
    expect(loadAccentPreferences(storage).accentHex).toBe(DEFAULT_ACCENT_HEX);
    const saved = setStoredAccentHex('#ef4444', storage);
    expect(saved.accentHex).toBe('#ef4444');
    expect(loadAccentPreferences(storage).accentHex).toBe('#ef4444');
    expect(storage.getItem(ACCENT_PREF_KEY)).toContain('#ef4444');
  });

  it('falls back to default on corrupt storage', () => {
    const storage = memoryStorage({ [ACCENT_PREF_KEY]: '{bad' });
    expect(loadAccentPreferences(storage).accentHex).toBe(DEFAULT_ACCENT_HEX);
  });
});

describe('accent CSS derivation (Serpent-gnus)', () => {
  const css = readFileSync(
    resolve(__dirname, '../../src/renderer/styles.css'),
    'utf8',
  );
  const foundationCss = readFileSync(
    resolve(__dirname, '../../src/renderer/ui/tokens.css'),
    'utf8',
  );

  it('derives accent-dark and soft-fg from --accent (no frozen blues)', () => {
    expect(css).toMatch(
      /--accent-dark:\s*color-mix\(in srgb,\s*var\(--accent\)/,
    );
    expect(css).not.toMatch(/--accent-soft-fg:\s*#1d4ed8/);
    expect(css).toMatch(/--accent-soft-fg:\s*var\(--ui-content-accent/);
    expect(foundationCss).toContain('--ui-content-accent: color-mix(in srgb, var(--ui-action-accent)');
    // Default leaf may still declare --accent: #3b82f6 in :root / light.
    expect(css).toContain('--accent: #3b82f6');
  });
});
