import { afterEach, describe, expect, it } from 'vitest';

import {
  CUSTOM_THEME_COLOR_TOKENS,
} from '../../src/renderer/theme/custom-theme';
import {
  DEFAULT_THEME_PROFILE,
  THEME_PROFILE_IDS,
  THEME_PROFILE_LEGACY_KEY,
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
import {
  migrateLegacyAccentIntoCustomTheme,
  resolveEffectiveThemeTokens,
} from '../../src/renderer/theme/theme-composition';
import { DEFAULT_CUSTOM_THEME, loadCustomTheme } from '../../src/renderer/theme/custom-theme';
import { ACCENT_PREF_KEY, DEFAULT_ACCENT_HEX } from '../../src/renderer/theme/accent-preferences';

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

describe('theme profile contract v3', () => {
  it('exposes three themes, each with complete dark and light tone variants', () => {
    expect(THEME_PROFILE_IDS).toEqual(['serpent', 'vscode', 'soft']);

    for (const id of THEME_PROFILE_IDS) {
      const preset = THEME_PROFILE_PRESETS[id];
      for (const mode of ['dark', 'light'] as const) {
        const tokens = preset.tokens[mode];
        expect(tokens).toEqual(expect.objectContaining({
          '--ui-surface-canvas': expect.any(String),
          '--ui-content-primary': expect.any(String),
          '--ui-action-accent': expect.any(String),
        }));
        expect(Object.keys(tokens).sort()).toEqual(
          [...CUSTOM_THEME_COLOR_TOKENS].sort(),
        );
      }
      // The theme's two tone variants differ (dark ≠ light canvas).
      expect(preset.tokens.dark['--ui-surface-canvas']).not.toBe(
        preset.tokens.light['--ui-surface-canvas'],
      );
    }
  });

  it('ships a default theme color (blue family) per tone variant', () => {
    function isBlueFamily(hex: string): boolean {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      // Blue-family: the blue channel dominates over red and green.
      return b >= r && b >= g;
    }
    for (const id of THEME_PROFILE_IDS) {
      for (const mode of ['dark', 'light'] as const) {
        const tokens = THEME_PROFILE_PRESETS[id].tokens[mode];
        for (const token of [
          '--ui-action-accent',
          '--ui-action-accent-hover',
          '--ui-action-accent-pressed',
          '--ui-content-accent',
          '--ui-border-focus',
        ] as const) {
          const accent = tokens[token];
          expect(accent).toMatch(/^#[0-9a-f]{6}$/iu);
          expect(isBlueFamily(accent), `${id}/${mode} ${token} = ${accent} is not blue-family`).toBe(true);
        }
      }
    }
  });

  it('accepts semantic color overrides and rejects unsafe or unknown fields', () => {
    const profile = parseThemeProfile({
      version: THEME_PROFILE_VERSION,
      preset: 'serpent',
      overrides: {
        '--ui-action-accent': '#ff00aa',
        '--ui-surface-canvas': 'transparent',
      },
    });

    expect(profile).toEqual({
      version: THEME_PROFILE_VERSION,
      preset: 'serpent',
      overrides: {
        '--ui-action-accent': '#ff00aa',
        '--ui-surface-canvas': 'transparent',
      },
    });

    for (const invalid of [
      { version: 1, preset: 'serpent', overrides: {} },
      { version: 3, preset: 'unknown', overrides: {} },
      { version: 3, preset: 'serpent', overrides: { '--ui-space-1': '4px' } },
      { version: 3, preset: 'serpent', overrides: { '--ui-surface-canvas': 'var(--secret)' } },
      { version: 3, preset: 'serpent', overrides: { '--ui-font-family': 'system-ui' } },
      { version: 3, preset: 'serpent', extra: true, overrides: {} },
    ]) {
      expect(() => themeProfileSchema.parse(invalid)).toThrow();
    }

    expect(parseThemeProfile({ version: 3, preset: 'unknown', overrides: {} })).toEqual(
      DEFAULT_THEME_PROFILE,
    );
  });

  it('migrates a v2 preset onto its theme and drops the legacy entry', () => {
    const storage = memoryStorage();
    storage.memory.set(
      THEME_PROFILE_LEGACY_KEY,
      JSON.stringify({
        version: 2,
        preset: 'vscode-dark',
        overrides: { '--ui-action-accent': '#0078d4' },
      }),
    );

    const loaded = loadThemeProfile(storage);
    expect(loaded).toEqual({
      version: 3,
      preset: 'vscode',
      overrides: { '--ui-action-accent': '#0078d4' },
    });
    expect(storage.memory.has(THEME_PROFILE_PREF_KEY)).toBe(true);
    expect(storage.memory.has(THEME_PROFILE_LEGACY_KEY)).toBe(false);

    // serpent-light and serpent-dark both collapse onto the serpent theme.
    const serpentLight = parseThemeProfile({
      version: 2,
      preset: 'serpent-light',
      overrides: {},
    });
    expect(serpentLight.preset).toBe('serpent');
    expect(parseThemeProfile({ version: 2, preset: 'soft-light', overrides: {} }).preset).toBe('soft');
  });

  it('round-trips the current profile through isolated storage', () => {
    const storage = memoryStorage();
    const profile = {
      version: THEME_PROFILE_VERSION,
      preset: 'soft' as const,
      overrides: { '--ui-action-accent': '#4f8bd9' },
    };

    saveThemeProfile(profile, storage);

    expect(storage.memory.get(THEME_PROFILE_PREF_KEY)).toContain('"version":3');
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
      version: 3,
      preset: 'serpent',
      overrides: { '--ui-space-1': '4px' },
    }));
    expect(loadThemeProfile(storage)).toEqual(DEFAULT_THEME_PROFILE);
  });

  it('composes profile and custom override in stable precedence order', () => {
    const composed = resolveEffectiveThemeTokens({
      themeProfile: {
        version: THEME_PROFILE_VERSION,
        preset: 'vscode',
        overrides: { '--ui-content-primary': '#eeeeee' },
      },
      customTheme: {
        ...DEFAULT_CUSTOM_THEME,
        dark: { '--ui-content-primary': '#ff00aa' },
      },
      resolved: 'dark',
    });

    expect(composed.tokens['--ui-content-primary']).toBe('#ff00aa');
    expect(composed.accentHex).toBe(
      THEME_PROFILE_PRESETS.vscode.tokens.dark['--ui-action-accent'],
    );
    expect(composed.tokens['--ui-action-accent']).toBe(composed.accentHex);
  });

  it('derives the accent from the custom override when one is set', () => {
    const composed = resolveEffectiveThemeTokens({
      themeProfile: DEFAULT_THEME_PROFILE,
      customTheme: {
        ...DEFAULT_CUSTOM_THEME,
        dark: { '--ui-action-accent': '#00ffaa' },
      },
      resolved: 'dark',
    });
    expect(composed.accentHex).toBe('#00ffaa');
    expect(composed.tokens['--ui-action-accent']).toBe('#00ffaa');
  });

  it('recomputes derived accent and danger tokens from custom base colors', () => {
    const composed = resolveEffectiveThemeTokens({
      themeProfile: DEFAULT_THEME_PROFILE,
      customTheme: {
        ...DEFAULT_CUSTOM_THEME,
        light: {
          '--ui-action-accent': '#8839ef',
          '--ui-status-danger': '#ff7a45',
        },
      },
      resolved: 'light',
    });

    expect(composed.tokens['--ui-action-accent-pressed']).toBe(
      'color-mix(in srgb, var(--ui-action-accent) 78%, black)',
    );
    expect(composed.tokens['--ui-action-danger']).toBe(
      'var(--ui-status-danger)',
    );
    expect(composed.tokens['--ui-action-danger-hover']).toBe(
      'color-mix(in srgb, var(--ui-status-danger) 82%, black)',
    );
    expect(composed.tokens['--ui-surface-selected']).toBe(
      'color-mix(in srgb, var(--ui-action-accent) 18%, #ffffff)',
    );
  });

  it('resolves the tone variant from the resolved mode, not the profile', () => {
    const dark = resolveThemeProfile(
      { version: THEME_PROFILE_VERSION, preset: 'serpent', overrides: {} },
      'dark',
    );
    const light = resolveThemeProfile(
      { version: THEME_PROFILE_VERSION, preset: 'serpent', overrides: {} },
      'light',
    );
    expect(dark.tokens['--ui-surface-canvas']).toBe('#202124');
    expect(light.tokens['--ui-surface-canvas']).toBe('#f4f5f7');
    expect(dark.id).toBe('serpent');
    expect(light.id).toBe('serpent');
  });

  it('merges overrides into the resolved variant without adding arbitrary tokens', () => {
    const resolved = resolveThemeProfile(
      {
        version: THEME_PROFILE_VERSION,
        preset: 'serpent',
        overrides: { '--ui-surface-canvas': '#fff7ed' },
      },
      'light',
    );

    expect(resolved.tokens['--ui-surface-canvas']).toBe('#fff7ed');
    expect(Object.keys(resolved.tokens).sort()).toEqual(
      [...CUSTOM_THEME_COLOR_TOKENS].sort(),
    );
  });

  it('migrates a legacy accent preference into custom-theme overrides once', () => {
    const storage = memoryStorage();
    storage.memory.set(ACCENT_PREF_KEY, JSON.stringify({
      version: 1,
      accentHex: '#00ffaa',
    }));

    const migrated = migrateLegacyAccentIntoCustomTheme(DEFAULT_CUSTOM_THEME, storage);
    expect(migrated.light['--ui-action-accent']).toBe('#00ffaa');
    expect(migrated.dark['--ui-action-accent']).toBe('#00ffaa');
    expect(storage.memory.has(ACCENT_PREF_KEY)).toBe(false);
    expect(loadCustomTheme(storage).light['--ui-action-accent']).toBe('#00ffaa');

    // Idempotent: a second run has nothing to migrate and keeps the theme.
    const again = migrateLegacyAccentIntoCustomTheme(migrated, storage);
    expect(again).toEqual(migrated);
  });

  it('drops a default legacy accent without writing overrides', () => {
    const storage = memoryStorage();
    storage.memory.set(ACCENT_PREF_KEY, JSON.stringify({
      version: 1,
      accentHex: DEFAULT_ACCENT_HEX,
    }));

    const migrated = migrateLegacyAccentIntoCustomTheme(DEFAULT_CUSTOM_THEME, storage);
    expect(migrated).toEqual(DEFAULT_CUSTOM_THEME);
    expect(storage.memory.has(ACCENT_PREF_KEY)).toBe(false);
  });

  it('clears a previous profile token set before applying the next profile', () => {
    const dom = installDocumentStub();
    try {
      dom.values.set('--ui-content-primary', '#from-old-profile');
      dom.values.set('--ui-action-accent', '#from-old-profile');
      dom.values.set('--ui-layer-modal', '800');
      dom.values.set('--unrelated-inline-token', 'preserve');

      applyThemeProfile(
        {
          version: THEME_PROFILE_VERSION,
          preset: 'serpent',
          overrides: { '--ui-content-primary': '#111111' },
        },
        'dark',
      );

      expect(dom.values.get('--ui-content-primary')).toBe('#111111');
      expect(dom.values.get('--ui-action-accent')).toBe(
        THEME_PROFILE_PRESETS.serpent.tokens.dark['--ui-action-accent'],
      );

      applyThemeProfile(
        { version: THEME_PROFILE_VERSION, preset: 'vscode', overrides: {} },
        'light',
      );

      expect(dom.values.get('--ui-content-primary')).toBe(
        THEME_PROFILE_PRESETS.vscode.tokens.light['--ui-content-primary'],
      );
      expect(dom.values.get('--ui-layer-modal')).toBe('800');
      expect(dom.values.get('--unrelated-inline-token')).toBe('preserve');
    } finally {
      dom.restore();
    }
  });
});
