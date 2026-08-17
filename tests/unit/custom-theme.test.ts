import { afterEach, describe, expect, it } from 'vitest';

import {
  CUSTOM_THEME_COLOR_TOKENS,
  CUSTOM_THEME_PREF_KEY,
  DEFAULT_CUSTOM_THEME,
  applyCustomTheme,
  clearCustomTheme,
  customThemeSchema,
  loadCustomTheme,
  saveCustomTheme,
} from '../../src/renderer/theme';

function memoryStorage() {
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
    memory,
  };
}

function installDocumentStub() {
  const values = new Map<string, string>();
  const style = {
    setProperty: (name: string, value: string) => values.set(name, value),
    removeProperty: (name: string) => {
      const previous = values.get(name) ?? '';
      values.delete(name);
      return previous;
    },
    getPropertyValue: (name: string) => values.get(name) ?? '',
  };
  const documentStub = {
    documentElement: { style },
  } as unknown as Document;
  const previous = (globalThis as { document?: Document }).document;
  (globalThis as { document?: Document }).document = documentStub;
  return {
    values,
    restore: () => {
      if (previous === undefined) {
        delete (globalThis as { document?: Document }).document;
      } else {
        (globalThis as { document?: Document }).document = previous;
      }
    },
  };
}

afterEach(() => {
  delete (globalThis as { document?: Document }).document;
});

describe('custom theme contract v1', () => {
  it('exposes a finite color-only --ui-* token allowlist', () => {
    expect(CUSTOM_THEME_COLOR_TOKENS.length).toBeGreaterThan(0);
    expect(CUSTOM_THEME_COLOR_TOKENS.every((token) => token.startsWith('--ui-'))).toBe(true);
    expect(CUSTOM_THEME_COLOR_TOKENS).not.toContain('--ui-space-1');
    expect(CUSTOM_THEME_COLOR_TOKENS).not.toContain('--ui-font-family');
    expect(CUSTOM_THEME_COLOR_TOKENS).not.toContain('--ui-layer-modal');
  });

  it('accepts versioned light/dark color overrides and rejects unsafe input', () => {
    expect(customThemeSchema.parse({
      version: 1,
      light: {
        '--ui-surface-canvas': '#f8fafc',
        '--ui-content-primary': '#0f172a',
        '--ui-border-focus': '#2563eb80',
        '--ui-surface-scrim': 'transparent',
      },
      dark: { '--ui-surface-canvas': '#0f172a' },
    }).dark['--ui-surface-canvas']).toBe('#0f172a');

    for (const invalid of [
      { version: 2, light: {} },
      { version: 1, light: { '--ui-space-1': '4px' } },
      { version: 1, light: { '--ui-font-family': 'system-ui' } },
      { version: 1, light: { '--ui-surface-canvas': 'var(--secret)' } },
      { version: 1, light: { '--ui-surface-canvas': 'url(https://evil.invalid)' } },
      { version: 1, light: { '--accent': '#ff0000' } },
    ]) {
      expect(() => customThemeSchema.parse(invalid)).toThrow();
    }
  });

  it('round-trips through the shared ThemePreferencesStorage contract', () => {
    const storage = memoryStorage();
    const theme = {
      version: 1 as const,
      light: { '--ui-action-accent': '#2563eb' },
      dark: { '--ui-action-accent': '#93c5fd' },
    };

    saveCustomTheme(theme, storage);

    expect(storage.memory.get(CUSTOM_THEME_PREF_KEY)).toContain('"version":1');
    expect(loadCustomTheme(storage)).toEqual(theme);
  });

  it('falls back to an empty v1 theme for missing or corrupt storage', () => {
    const storage = memoryStorage();
    expect(loadCustomTheme(storage)).toEqual(DEFAULT_CUSTOM_THEME);

    storage.memory.set(CUSTOM_THEME_PREF_KEY, '{not-json');
    expect(loadCustomTheme(storage)).toEqual(DEFAULT_CUSTOM_THEME);

    storage.memory.set(CUSTOM_THEME_PREF_KEY, JSON.stringify({
      version: 1,
      light: { '--ui-space-1': '4px' },
    }));
    expect(loadCustomTheme(storage)).toEqual(DEFAULT_CUSTOM_THEME);
  });

  it('clears managed old overrides before applying the next mode', () => {
    const dom = installDocumentStub();
    try {
      const theme = {
        version: 1 as const,
        light: {
          '--ui-surface-canvas': '#ffffff',
          '--ui-content-primary': '#111111',
        },
        dark: { '--ui-surface-canvas': '#000000' },
      };
      dom.values.set('--ui-layer-modal', '800');
      dom.values.set('--unrelated-inline-token', 'preserve');

      applyCustomTheme(theme, 'light');
      expect(dom.values.get('--ui-content-primary')).toBe('#111111');

      applyCustomTheme(theme, 'dark');
      expect(dom.values.get('--ui-surface-canvas')).toBe('#000000');
      expect(dom.values.has('--ui-content-primary')).toBe(false);
      expect(dom.values.get('--ui-layer-modal')).toBe('800');
      expect(dom.values.get('--unrelated-inline-token')).toBe('preserve');
    } finally {
      dom.restore();
    }
  });

  it('clears all managed overrides and optionally removes persisted state', () => {
    const dom = installDocumentStub();
    const storage = memoryStorage();
    try {
      saveCustomTheme({
        version: 1,
        light: { '--ui-surface-canvas': '#fff' },
        dark: { '--ui-status-danger': '#f00' },
      }, storage);
      for (const token of CUSTOM_THEME_COLOR_TOKENS) {
        dom.values.set(token, '#000000');
      }
      dom.values.set('--ui-layer-modal', '800');

      clearCustomTheme(storage);

      expect(storage.memory.has(CUSTOM_THEME_PREF_KEY)).toBe(false);
      expect(CUSTOM_THEME_COLOR_TOKENS.every((token) => !dom.values.has(token))).toBe(true);
      expect(dom.values.get('--ui-layer-modal')).toBe('800');
    } finally {
      dom.restore();
    }
  });

  it('clears persisted state even when no storage argument is passed', () => {
    // Regression: ThemeProvider mounts without an explicit storage argument;
    // clearCustomTheme used to skip removeItem then, so overrides reappeared
    // on the next load ("clear button does nothing").
    const dom = installDocumentStub();
    const memory = new Map<string, string>();
    const previous = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    };
    try {
      memory.set(CUSTOM_THEME_PREF_KEY, JSON.stringify({
        version: 1,
        light: { '--ui-surface-canvas': '#fff' },
        dark: {},
      }));
      dom.values.set('--ui-surface-canvas', '#fff');

      clearCustomTheme();

      expect(memory.has(CUSTOM_THEME_PREF_KEY)).toBe(false);
      expect(dom.values.has('--ui-surface-canvas')).toBe(false);
    } finally {
      if (previous === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else (globalThis as { localStorage?: unknown }).localStorage = previous;
      dom.restore();
    }
  });
});
