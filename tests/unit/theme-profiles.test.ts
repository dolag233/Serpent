import { afterEach, describe, expect, it } from 'vitest';

import {
  CUSTOM_THEME_COLOR_TOKENS,
} from '../../src/renderer/theme/custom-theme';
import {
  DEFAULT_THEME_PROFILE,
  THEME_PROFILE_IDS,
  THEME_PROFILE_PREF_KEY,
  THEME_PROFILE_PRESETS,
  THEME_PROFILE_VERSION,
  applyThemeProfile,
  loadThemeProfile,
  parseThemeProfile,
  resolveThemeProfile,
  saveThemeProfile,
  themeProfileSchema,
} from '../../src/renderer/theme/theme-profiles';
import { resolveEffectiveThemeTokens } from '../../src/renderer/theme/theme-composition';
import { DEFAULT_CUSTOM_THEME } from '../../src/renderer/theme/custom-theme';

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

describe('theme profile contract v2', () => {
  it('exposes the four supported semantic-token presets', () => {
    expect(THEME_PROFILE_IDS).toEqual([
      'vscode-dark',
      'serpent-dark',
      'serpent-light',
      'soft-light',
    ]);

    for (const id of THEME_PROFILE_IDS) {
      const preset = THEME_PROFILE_PRESETS[id];
      expect(preset.tokens).toEqual(expect.objectContaining({
        '--ui-surface-canvas': expect.any(String),
        '--ui-content-primary': expect.any(String),
        '--ui-action-accent': expect.any(String),
      }));
      expect(Object.keys(preset.tokens).sort()).toEqual(
        [...CUSTOM_THEME_COLOR_TOKENS].sort(),
      );
    }
  });

  it('accepts semantic color overrides and rejects unsafe or unknown fields', () => {
    const profile = parseThemeProfile({
      version: THEME_PROFILE_VERSION,
      preset: 'vscode-dark',
      overrides: {
        '--ui-action-accent': '#ff00aa',
        '--ui-surface-canvas': 'transparent',
      },
    });

    expect(profile).toEqual({
      version: THEME_PROFILE_VERSION,
      preset: 'vscode-dark',
      overrides: {
        '--ui-action-accent': '#ff00aa',
        '--ui-surface-canvas': 'transparent',
      },
    });

    for (const invalid of [
      { version: 1, preset: 'vscode-dark', overrides: {} },
      { version: 2, preset: 'unknown', overrides: {} },
      { version: 2, preset: 'vscode-dark', overrides: { '--ui-space-1': '4px' } },
      { version: 2, preset: 'vscode-dark', overrides: { '--ui-surface-canvas': 'var(--secret)' } },
      { version: 2, preset: 'vscode-dark', overrides: { '--ui-font-family': 'system-ui' } },
      { version: 2, preset: 'vscode-dark', extra: true, overrides: {} },
    ]) {
      expect(() => themeProfileSchema.parse(invalid)).toThrow();
    }

    expect(parseThemeProfile({ version: 2, preset: 'unknown', overrides: {} })).toEqual(
      DEFAULT_THEME_PROFILE,
    );
  });

  it('round-trips the current profile through isolated storage', () => {
    const storage = memoryStorage();
    const profile = {
      version: THEME_PROFILE_VERSION,
      preset: 'soft-light' as const,
      overrides: { '--ui-action-accent': '#8839ef' },
    };

    saveThemeProfile(profile, storage);

    expect(storage.memory.get(THEME_PROFILE_PREF_KEY)).toContain('"version":2');
    expect(loadThemeProfile(storage)).toEqual(profile);
  });

  it('falls back to the default profile for missing or corrupt persistence', () => {
    const storage = memoryStorage();
    expect(loadThemeProfile(storage)).toEqual(DEFAULT_THEME_PROFILE);

    expect(loadThemeProfile({
      getItem: () => { throw new Error('storage unavailable'); },
      setItem: () => undefined,
      removeItem: () => undefined,
    })).toEqual(DEFAULT_THEME_PROFILE);

    storage.memory.set(THEME_PROFILE_PREF_KEY, '{not-json');
    expect(loadThemeProfile(storage)).toEqual(DEFAULT_THEME_PROFILE);

    storage.memory.set(THEME_PROFILE_PREF_KEY, JSON.stringify({
      version: 2,
      preset: 'vscode-dark',
      overrides: { '--ui-space-1': '4px' },
    }));
    expect(loadThemeProfile(storage)).toEqual(DEFAULT_THEME_PROFILE);
  });

  it('composes profile, custom override, and explicit accent in stable precedence order', () => {
    const composed = resolveEffectiveThemeTokens({
      themeProfile: {
        version: THEME_PROFILE_VERSION,
        preset: 'vscode-dark',
        overrides: { '--ui-content-primary': '#eeeeee' },
      },
      customTheme: {
        ...DEFAULT_CUSTOM_THEME,
        dark: { '--ui-content-primary': '#ff00aa' },
      },
      resolved: 'dark',
      accentHex: '#3b82f6',
      defaultAccentHex: '#3b82f6',
    });

    expect(composed.tokens['--ui-content-primary']).toBe('#ff00aa');
    expect(composed.accentHex).toBe(THEME_PROFILE_PRESETS['vscode-dark'].tokens['--ui-action-accent']);
    expect(composed.tokens['--ui-action-accent']).toBe(composed.accentHex);

    const explicit = resolveEffectiveThemeTokens({
      themeProfile: DEFAULT_THEME_PROFILE,
      customTheme: DEFAULT_CUSTOM_THEME,
      resolved: 'dark',
      accentHex: '#00ffaa',
      defaultAccentHex: '#3b82f6',
    });
    expect(explicit.accentHex).toBe('#00ffaa');
  });

  it('resolves overrides over the selected preset without adding arbitrary tokens', () => {
    const resolved = resolveThemeProfile({
      version: THEME_PROFILE_VERSION,
      preset: 'serpent-light',
      overrides: { '--ui-surface-canvas': '#fff7ed' },
    });

    expect(resolved.mode).toBe('light');
    expect(resolved.tokens['--ui-surface-canvas']).toBe('#fff7ed');
    expect(Object.keys(resolved.tokens).sort()).toEqual(
      [...CUSTOM_THEME_COLOR_TOKENS].sort(),
    );
  });

  it('clears a previous profile token set before applying the next profile', () => {
    const dom = installDocumentStub();
    try {
      dom.values.set('--ui-content-primary', '#from-old-profile');
      dom.values.set('--ui-action-accent', '#from-old-profile');
      dom.values.set('--ui-layer-modal', '800');
      dom.values.set('--unrelated-inline-token', 'preserve');

      applyThemeProfile({
        version: THEME_PROFILE_VERSION,
        preset: 'serpent-light',
        overrides: { '--ui-content-primary': '#111111' },
      });

      expect(dom.values.get('--ui-content-primary')).toBe('#111111');
      expect(dom.values.get('--ui-action-accent')).toBe(
        THEME_PROFILE_PRESETS['serpent-light'].tokens['--ui-action-accent'],
      );

      applyThemeProfile({
        version: THEME_PROFILE_VERSION,
        preset: 'vscode-dark',
        overrides: {},
      });

      expect(dom.values.get('--ui-content-primary')).toBe(
        THEME_PROFILE_PRESETS['vscode-dark'].tokens['--ui-content-primary'],
      );
      expect(dom.values.get('--ui-layer-modal')).toBe('800');
      expect(dom.values.get('--unrelated-inline-token')).toBe('preserve');
    } finally {
      dom.restore();
    }
  });
});
