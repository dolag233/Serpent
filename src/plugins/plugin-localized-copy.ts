export type PluginLocaleId = 'zh-CN' | 'en';

export type PluginLocalizedCopy = {
  readonly name?: string;
  readonly description?: string;
};

export type PluginManifestLocales = {
  readonly 'zh-CN'?: PluginLocalizedCopy;
  readonly en?: PluginLocalizedCopy;
};

export type PluginCatalogLocalizedCopy = {
  readonly name: { readonly 'zh-CN': string; readonly en: string };
  readonly description: { readonly 'zh-CN': string; readonly en: string };
};

export function pickLocalizedText(
  locale: PluginLocaleId,
  localized: { readonly 'zh-CN': string; readonly en: string },
): string {
  return localized[locale];
}

/**
 * Display name/description for a plugin. Catalog copy wins so already-installed
 * English-only packages still follow the app language after the directory loads.
 */
export function resolvePluginDisplayCopy(input: {
  locale: PluginLocaleId;
  fallbackName: string;
  fallbackDescription: string;
  manifestLocales?: PluginManifestLocales;
  catalog?: PluginCatalogLocalizedCopy;
}): { name: string; description: string } {
  const catalogName = input.catalog?.name[input.locale];
  const catalogDescription = input.catalog?.description[input.locale];
  const localeCopy = input.manifestLocales?.[input.locale];
  const englishCopy = input.manifestLocales?.en;
  return {
    name: catalogName
      ?? localeCopy?.name
      ?? (input.locale === 'en' ? undefined : englishCopy?.name)
      ?? input.fallbackName,
    description: catalogDescription
      ?? localeCopy?.description
      ?? (input.locale === 'en' ? undefined : englishCopy?.description)
      ?? input.fallbackDescription,
  };
}
