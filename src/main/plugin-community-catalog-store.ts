import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  catalogSha256Url,
  DEFAULT_PLUGIN_COMMUNITY_CATALOG_URL,
  parseCatalogSha256File,
  pluginCommunityCatalogSchema,
  type PluginCommunityCatalog,
  type PluginCommunityEntry,
} from '../plugins/plugin-community-catalog';
import {
  PLUGIN_README_MAX_BYTES,
  pluginReadmeCandidates,
  pluginReadmeRawUrl,
  type PluginReadmeFileName,
} from '../plugins/plugin-community-readme';
import type { PluginLocaleId } from '../plugins/plugin-localized-copy';
import { PluginPackageManagerError } from './plugin-package-manager-types';

const CACHE_DIRECTORY_NAME = 'plugin-community';
const CACHE_FILE_NAME = 'catalog.v1.json';
const META_FILE_NAME = 'catalog-meta.json';

export type PluginCommunityCatalogSnapshot = {
  catalog: PluginCommunityCatalog;
  stale: boolean;
  fetchedAt?: string;
  sourceUrl: string;
  errorCode?: string;
};

export type PluginCommunityReadmeSnapshot = {
  pluginId: string;
  fileName: PluginReadmeFileName;
  locale: PluginLocaleId;
  requestedLocale: PluginLocaleId;
  markdown: string;
};

type CatalogCacheMeta = {
  sha256: string;
  fetchedAt: string;
  sourceUrl: string;
};

export type PluginCommunityCatalogStoreOptions = {
  userDataDirectory: string;
  catalogUrl?: string;
  fetchImpl?: typeof fetch;
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class PluginCommunityCatalogStore {
  readonly #userDataDirectory: string;
  readonly #catalogUrl: string;
  readonly #fetchImpl: typeof fetch;

  constructor(options: PluginCommunityCatalogStoreOptions) {
    this.#userDataDirectory = options.userDataDirectory;
    this.#catalogUrl = options.catalogUrl ?? DEFAULT_PLUGIN_COMMUNITY_CATALOG_URL;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async load(input: { refresh?: boolean } = {}): Promise<PluginCommunityCatalogSnapshot> {
    const refresh = input.refresh !== false;
    if (!refresh) {
      const cached = await this.#readCache();
      if (cached !== undefined) return { ...cached, stale: false };
    }
    try {
      const remote = await this.#fetchRemote();
      await this.#writeCache(remote.bytes, remote.sha256);
      return {
        catalog: remote.catalog,
        stale: false,
        fetchedAt: new Date().toISOString(),
        sourceUrl: this.#catalogUrl,
      };
    } catch (error) {
      const cached = await this.#readCache();
      if (cached !== undefined) {
        return {
          ...cached,
          stale: true,
          errorCode: error instanceof PluginPackageManagerError
            ? error.code
            : 'PLUGIN_CATALOG_UNAVAILABLE',
        };
      }
      if (error instanceof PluginPackageManagerError) throw error;
      throw new PluginPackageManagerError(
        'PLUGIN_CATALOG_UNAVAILABLE',
        'The plugin directory could not be downloaded.',
      );
    }
  }

  async loadReadme(input: {
    pluginId: string;
    locale: PluginLocaleId;
  }): Promise<PluginCommunityReadmeSnapshot | undefined> {
    const snapshot = await this.load({ refresh: false });
    const entry = snapshot.catalog.plugins.find((item) => item.id === input.pluginId);
    if (entry === undefined) {
      throw new PluginPackageManagerError(
        'PLUGIN_COMMUNITY_ENTRY_INVALID',
        'The plugin is not in the official directory.',
      );
    }
    for (const fileName of pluginReadmeCandidates(input.locale)) {
      const cached = await this.#readReadmeCache(entry, fileName);
      if (cached !== undefined) {
        return {
          pluginId: entry.id,
          fileName,
          locale: localeForReadmeFile(fileName, input.locale),
          requestedLocale: input.locale,
          markdown: cached,
        };
      }
      const fetched = await this.#fetchReadme(entry, fileName);
      if (fetched === undefined) continue;
      await this.#writeReadmeCache(entry, fileName, fetched);
      return {
        pluginId: entry.id,
        fileName,
        locale: localeForReadmeFile(fileName, input.locale),
        requestedLocale: input.locale,
        markdown: fetched,
      };
    }
    return undefined;
  }

  #cacheDirectory(): string {
    return path.join(this.#userDataDirectory, CACHE_DIRECTORY_NAME);
  }

  async #fetchRemote(): Promise<{ bytes: Uint8Array; catalog: PluginCommunityCatalog; sha256: string }> {
    const [catalogResponse, digestResponse] = await Promise.all([
      this.#fetchImpl(this.#catalogUrl, { headers: { Accept: 'application/json' } }),
      this.#fetchImpl(catalogSha256Url(this.#catalogUrl), { headers: { Accept: 'text/plain' } }),
    ]);
    if (!catalogResponse.ok || !digestResponse.ok) {
      throw new PluginPackageManagerError(
        'PLUGIN_CATALOG_UNAVAILABLE',
        'The plugin directory could not be downloaded.',
      );
    }
    const bytes = new Uint8Array(await catalogResponse.arrayBuffer());
    const expected = parseCatalogSha256File(await digestResponse.text());
    const actual = sha256Hex(bytes);
    if (expected === undefined || expected !== actual) {
      throw new PluginPackageManagerError(
        'PLUGIN_PACKAGE_HASH_MISMATCH',
        'The plugin directory digest did not match the downloaded catalog.',
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new PluginPackageManagerError(
        'PLUGIN_CATALOG_UNAVAILABLE',
        'The plugin directory is not valid JSON.',
      );
    }
    const parsed = pluginCommunityCatalogSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new PluginPackageManagerError(
        'PLUGIN_CATALOG_UNAVAILABLE',
        'The plugin directory failed schema validation.',
      );
    }
    return { bytes, catalog: parsed.data, sha256: actual };
  }

  async #readCache(): Promise<Omit<PluginCommunityCatalogSnapshot, 'stale'> | undefined> {
    try {
      const [raw, metaRaw] = await Promise.all([
        readFile(path.join(this.#cacheDirectory(), CACHE_FILE_NAME)),
        readFile(path.join(this.#cacheDirectory(), META_FILE_NAME), 'utf8'),
      ]);
      const meta = JSON.parse(metaRaw) as CatalogCacheMeta;
      if (typeof meta.sha256 !== 'string' || sha256Hex(raw) !== meta.sha256) return undefined;
      const parsed = pluginCommunityCatalogSchema.safeParse(JSON.parse(raw.toString('utf8')));
      if (!parsed.success) return undefined;
      return {
        catalog: parsed.data,
        fetchedAt: typeof meta.fetchedAt === 'string' ? meta.fetchedAt : undefined,
        sourceUrl: typeof meta.sourceUrl === 'string' ? meta.sourceUrl : this.#catalogUrl,
      };
    } catch {
      return undefined;
    }
  }

  async #writeCache(bytes: Uint8Array, sha256: string): Promise<void> {
    const directory = this.#cacheDirectory();
    await mkdir(directory, { recursive: true });
    const meta: CatalogCacheMeta = {
      sha256,
      fetchedAt: new Date().toISOString(),
      sourceUrl: this.#catalogUrl,
    };
    await writeFile(path.join(directory, CACHE_FILE_NAME), bytes);
    await writeFile(path.join(directory, META_FILE_NAME), `${JSON.stringify(meta, null, 2)}\n`);
  }

  #readmeCachePath(entry: PluginCommunityEntry, fileName: PluginReadmeFileName): string {
    const tag = entry.releaseTag.replace(/[^\w.-]+/gu, '_');
    return path.join(this.#cacheDirectory(), 'readme', entry.id, tag, fileName);
  }

  async #readReadmeCache(
    entry: PluginCommunityEntry,
    fileName: PluginReadmeFileName,
  ): Promise<string | undefined> {
    try {
      const raw = await readFile(this.#readmeCachePath(entry, fileName));
      if (raw.byteLength === 0 || raw.byteLength > PLUGIN_README_MAX_BYTES) return undefined;
      return decodeReadmeBytes(raw);
    } catch {
      return undefined;
    }
  }

  async #writeReadmeCache(
    entry: PluginCommunityEntry,
    fileName: PluginReadmeFileName,
    markdown: string,
  ): Promise<void> {
    const filePath = this.#readmeCachePath(entry, fileName);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, markdown, 'utf8');
  }

  async #fetchReadme(
    entry: PluginCommunityEntry,
    fileName: PluginReadmeFileName,
  ): Promise<string | undefined> {
    const url = pluginReadmeRawUrl(`https://github.com/${entry.repo}`, entry.releaseTag, fileName);
    try {
      const response = await this.#fetchImpl(url, {
        headers: { Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.1' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return undefined;
      if (!response.ok) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > PLUGIN_README_MAX_BYTES) return undefined;
      const markdown = decodeReadmeBytes(bytes);
      if (markdown.startsWith('<!DOCTYPE html') || markdown.startsWith('<html')) return undefined;
      return markdown;
    } catch {
      return undefined;
    }
  }
}

function localeForReadmeFile(fileName: PluginReadmeFileName, requestedLocale: PluginLocaleId): PluginLocaleId {
  if (fileName === 'README.en.md') return 'en';
  if (fileName === 'README.zh-CN.md' || fileName === 'README.zh.md') return 'zh-CN';
  return requestedLocale;
}

function decodeReadmeBytes(bytes: Uint8Array): string {
  return new TextDecoder('utf8', { fatal: false }).decode(bytes).replace(/\0/gu, '');
}
