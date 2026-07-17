import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  LOCALE_PREF_KEY,
  createTranslator,
  interpolate,
  loadLocalePreferences,
  lookupMessage,
  setStoredLocale,
  catalogs,
} from '../../src/renderer/i18n';

describe('i18n translate', () => {
  it('looks up nested keys', () => {
    expect(lookupMessage(catalogs['zh-CN'], 'common.cancel')).toBe('取消');
    expect(lookupMessage(catalogs.en, 'common.cancel')).toBe('Cancel');
  });

  it('interpolates placeholders', () => {
    expect(interpolate('Copied {color}', { color: '#fff' })).toBe(
      'Copied #fff',
    );
    expect(interpolate('Keep {missing}', {})).toBe('Keep {missing}');
  });

  it('falls back to key then zh-CN when English key missing from primary', () => {
    const t = createTranslator(
      { only: { en: 'English only' } },
      catalogs['zh-CN'],
    );
    expect(t('common.cancel')).toBe('取消');
    expect(t('totally.missing')).toBe('totally.missing');
  });

  it('creates locale-aware translators from catalogs', () => {
    const zh = createTranslator(catalogs['zh-CN']);
    const en = createTranslator(catalogs.en, catalogs['zh-CN']);
    expect(zh('shell.libraryMenu')).toBe('资源库菜单');
    expect(en('shell.libraryMenu')).toBe('Library menu');
    expect(en('toast.colorCopied', { color: '#381444' })).toBe(
      'Copied #381444',
    );
  });
});

describe('locale preferences', () => {
  it('round-trips through injectable storage', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    };

    expect(loadLocalePreferences(storage).locale).toBe(DEFAULT_LOCALE);
    setStoredLocale('en', storage);
    expect(loadLocalePreferences(storage).locale).toBe('en');
    expect(memory.get(LOCALE_PREF_KEY)).toContain('"en"');
  });
});
