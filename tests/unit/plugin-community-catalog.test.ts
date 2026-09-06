import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseCatalogSha256File,
  pluginCommunityCatalogSchema,
} from '../../src/plugins/plugin-community-catalog';
import { resolvePluginDisplayCopy } from '../../src/plugins/plugin-localized-copy';
import { PluginCommunityCatalogStore } from '../../src/main/plugin-community-catalog-store';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

const catalog = {
  schemaVersion: 1 as const,
  generatedAt: '2026-09-06T00:00:00.000Z',
  plugins: [{
    id: 'com.example.palette-tools',
    tier: 'certified' as const,
    repo: 'example/serpent-palette-tools',
    releaseTag: 'v1.2.0',
    version: '1.2.0',
    runtimeMode: 'restricted' as const,
    name: { 'zh-CN': '色板工具', en: 'Palette Tools' },
    description: { 'zh-CN': '提取色板。', en: 'Extract palettes.' },
    assets: [{
      platform: 'any' as const,
      fileName: 'com.example.palette-tools-1.2.0-any.zip',
      sha256: 'a'.repeat(64),
    }],
  }],
  removed: [],
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('plugin community catalog', () => {
  it('parses a catalog document and a bare or GNU digest file', () => {
    expect(pluginCommunityCatalogSchema.parse(catalog).plugins[0]?.id).toBe('com.example.palette-tools');
    expect(parseCatalogSha256File(`${'b'.repeat(64)}\n`)).toBe('b'.repeat(64));
    expect(parseCatalogSha256File(`${'C'.repeat(64)}  catalog.v1.json\n`)).toBe('c'.repeat(64));
  });

  it('prefers catalog copy so installed English-only packages follow the app locale', () => {
    const copy = resolvePluginDisplayCopy({
      locale: 'zh-CN',
      fallbackName: 'Palette Tools',
      fallbackDescription: 'Extract palettes.',
      catalog: catalog.plugins[0],
    });
    expect(copy).toEqual({ name: '色板工具', description: '提取色板。' });
  });

  it('serves a cached catalog when the remote digest or fetch fails', async () => {
    const userData = temporaryRoot('serpent-catalog-');
    const json = `${JSON.stringify(catalog)}\n`;
    const digest = createHash('sha256').update(json).digest('hex');
    let calls = 0;
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (calls <= 2) {
        if (url.endsWith('.sha256')) return new Response(`${digest}\n`, { status: 200 });
        return new Response(json, { status: 200 });
      }
      return new Response('unavailable', { status: 503 });
    };
    const store = new PluginCommunityCatalogStore({
      userDataDirectory: userData,
      catalogUrl: 'https://example.test/catalog.v1.json',
      fetchImpl,
    });
    const fresh = await store.load({ refresh: true });
    expect(fresh.stale).toBe(false);
    expect(fresh.catalog.plugins).toHaveLength(1);
    const stale = await store.load({ refresh: true });
    expect(stale.stale).toBe(true);
    expect(stale.catalog.plugins[0]?.id).toBe('com.example.palette-tools');
    expect(stale.errorCode).toBe('PLUGIN_CATALOG_UNAVAILABLE');
  });

  it('rejects a catalog whose bytes do not match the published digest', async () => {
    const userData = temporaryRoot('serpent-catalog-bad-');
    mkdirSync(userData, { recursive: true });
    writeFileSync(path.join(userData, 'keep.txt'), 'x');
    const json = `${JSON.stringify(catalog)}\n`;
    const store = new PluginCommunityCatalogStore({
      userDataDirectory: userData,
      catalogUrl: 'https://example.test/catalog.v1.json',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('.sha256')) return new Response(`${'0'.repeat(64)}\n`, { status: 200 });
        return new Response(json, { status: 200 });
      },
    });
    await expect(store.load({ refresh: true })).rejects.toMatchObject({
      code: 'PLUGIN_PACKAGE_HASH_MISMATCH',
    });
  });

  it('fetches the locale README from the pinned tag and skips 404 then HTML', async () => {
    const userData = temporaryRoot('serpent-catalog-readme-');
    const json = `${JSON.stringify(catalog)}\n`;
    const digest = createHash('sha256').update(json).digest('hex');
    const requested: string[] = [];
    const store = new PluginCommunityCatalogStore({
      userDataDirectory: userData,
      catalogUrl: 'https://example.test/catalog.v1.json',
      fetchImpl: async (input) => {
        const url = String(input);
        requested.push(url);
        if (url.includes('zipball')) throw new Error('community channel must not use zipball');
        if (url.endsWith('.sha256')) return new Response(`${digest}\n`, { status: 200 });
        if (url.endsWith('catalog.v1.json')) return new Response(json, { status: 200 });
        if (url.endsWith('README.zh-CN.md')) return new Response('missing', { status: 404 });
        if (url.endsWith('README.zh.md')) {
          return new Response('<!DOCTYPE html><html>not found</html>', { status: 200 });
        }
        if (url.endsWith('README.md')) return new Response('# Palette Tools\n\nExtract palettes.\n', { status: 200 });
        return new Response('no', { status: 404 });
      },
    });
    await store.load({ refresh: true });
    const readme = await store.loadReadme({ pluginId: 'com.example.palette-tools', locale: 'zh-CN' });
    expect(readme).toMatchObject({
      pluginId: 'com.example.palette-tools',
      fileName: 'README.md',
      locale: 'zh-CN',
      requestedLocale: 'zh-CN',
      markdown: '# Palette Tools\n\nExtract palettes.\n',
    });
    const cached = await store.loadReadme({ pluginId: 'com.example.palette-tools', locale: 'zh-CN' });
    expect(cached?.fileName).toBe('README.md');
    expect(requested.filter((url) => url.includes('README.md'))).toHaveLength(1);
  });
});
