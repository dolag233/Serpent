import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE_PREFERENCE,
  LOCALE_PREF_KEY,
  createTranslator,
  interpolate,
  loadLocalePreferences,
  lookupMessage,
  readSystemLocale,
  resolveEffectiveLocale,
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
    expect(zh('shell.networkStorageBanner')).toContain('网络共享');
    expect(en('shell.libraryMenu')).toBe('Library menu');
    expect(en('shell.networkStorageBanner')).toContain('network share');
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

    expect(loadLocalePreferences(storage).locale).toBe(DEFAULT_LOCALE_PREFERENCE);
    expect(DEFAULT_LOCALE_PREFERENCE).toBe('system');
    setStoredLocale('en', storage);
    expect(loadLocalePreferences(storage).locale).toBe('en');
    expect(memory.get(LOCALE_PREF_KEY)).toContain('"en"');
    setStoredLocale('system', storage);
    expect(loadLocalePreferences(storage).locale).toBe('system');
  });

  it('resolves system preference from language tags', () => {
    expect(resolveEffectiveLocale('zh-CN', 'en')).toBe('zh-CN');
    expect(resolveEffectiveLocale('system', 'en')).toBe('en');
    expect(resolveEffectiveLocale('system', 'zh-CN')).toBe('zh-CN');
    expect(readSystemLocale(['en-US', 'en'])).toBe('en');
    expect(readSystemLocale(['zh-Hans-CN', 'en'])).toBe('zh-CN');
  });
});
