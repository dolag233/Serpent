import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createPluginUiUrl,
  parsePluginUiAssetRequest,
  parsePluginUiAssetRequestFromNavigation,
  resolvePluginUiAssetPath,
  rewritePluginUiHtmlAssetUrls,
} from '../../src/main/plugin-ui-assets';
import {
  isTrustedPluginUiMessage,
  parsePluginUiIframeMessage,
  parsePluginUiHostMessage,
} from '../../src/shared/plugin-ui-protocol';
import { buildPluginUiThemeHostMessage } from '../../src/plugins/plugin-themes';
import { pluginManifestSchema } from '../../src/plugins/plugin-manifest';

describe('plugin custom UI contract', () => {
  it('requires a relative entry path for workspace views', () => {
    const result = pluginManifestSchema.safeParse({
      manifestVersion: 1,
      id: 'com.example.iframe',
      version: '1.0.0',
      name: 'Iframe probe',
      description: 'Probe',
      author: 'Serpent',
      license: 'MIT',
      engines: { serpent: '>=0.1.0', pluginApi: 1 },
      runtime: { mode: 'restricted', entry: 'entry/main.js' },
      permissions: ['ui.workspace', 'storage.write'],
      contributes: {
        commands: [{ id: 'probe.write', title: 'Write probe' }],
        menus: {},
        toolbar: [],
        inspector: [],
        viewerActions: [],
        views: [{
          id: 'probe-view',
          title: 'Probe view',
          location: 'workspace',
          entry: 'entry/index.html',
        }],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contributes.views[0]?.entry).toBe('entry/index.html');
    }
    expect(pluginManifestSchema.safeParse({
      ...result.success ? result.data : {},
      contributes: {
        ...(result.success ? result.data.contributes : {}),
        views: [{
          id: 'probe-view',
          title: 'Probe view',
          location: 'workspace',
          entry: '../escape.html',
        }],
      },
    }).success).toBe(false);
  });

  it('accepts only typed iframe messages and binds them to the iframe source', () => {
    const ready = parsePluginUiIframeMessage({
      type: 'plugin-ui.ready',
      contributionId: 'com.example.iframe.probe-view',
      instanceId: 'instance-a',
    });
    expect(ready.type).toBe('plugin-ui.ready');

    const invoke = parsePluginUiIframeMessage({
      type: 'plugin-ui.invoke-command',
      requestId: 'request-a',
      commandId: 'probe.write',
      context: { assetIds: ['asset-a'] },
    });
    expect(invoke.type).toBe('plugin-ui.invoke-command');
    expect(() => parsePluginUiIframeMessage({ type: 'plugin-ui.ready' })).toThrow();
    expect(parsePluginUiHostMessage({
      type: 'plugin-ui.theme-changed',
      contributionId: 'com.example.iframe.probe-view',
      instanceId: 'instance-a',
      theme: 'dark',
      contrast: 'normal',
      revision: 1,
      tokens: { '--ui-surface-canvas': '#111417' },
    }).type).toBe('plugin-ui.theme-changed');

    expect(isTrustedPluginUiMessage({
      origin: 'null',
      source: 'iframe-window',
      expectedOrigin: 'null',
      expectedSource: 'iframe-window',
    })).toBe(true);
    expect(isTrustedPluginUiMessage({
      origin: 'serpent-plugin://com.example.iframe',
      source: 'iframe-window',
      expectedOrigin: 'null',
      expectedPluginOrigin: 'serpent-plugin://com.example.iframe',
      expectedSource: 'iframe-window',
    })).toBe(true);
    expect(isTrustedPluginUiMessage({
      origin: 'https://serpent.invalid',
      source: 'iframe-window',
      expectedOrigin: 'null',
      expectedSource: 'iframe-window',
    })).toBe(false);
    expect(() => parsePluginUiHostMessage({
      type: 'plugin-ui.theme-changed',
      contributionId: 'com.example.iframe.probe-view',
      instanceId: 'instance-a',
      theme: 'dark',
      contrast: 'normal',
      revision: 1,
      tokens: { '--ui-surface-canvas': '#111417' },
      unexpected: true,
    })).toThrow();
    expect(() => parsePluginUiHostMessage({
      type: 'plugin-ui.theme-changed',
      contributionId: 'com.example.iframe.probe-view',
      instanceId: 'instance-a',
      theme: 'dark',
      contrast: 'normal',
      revision: 1,
      tokens: { '--canvas': '#111417' },
    })).toThrow();

    const themed = buildPluginUiThemeHostMessage({
      contributionId: 'com.example.iframe.probe-view',
      instanceId: 'instance-a',
      resolvedTheme: 'dark',
      revision: 2,
      hostTokens: { '--ui-surface-canvas': '#111417', '--ui-action-accent': '#3b82f6' },
      themePackage: {
        version: 1,
        light: { references: {}, tokens: {} },
        dark: {
          references: { accent: 'action.accent' },
          tokens: { badge: '#ff9a3c' },
        },
      },
    });
    const themedParsed = parsePluginUiHostMessage(themed);
    expect(themedParsed.type).toBe('plugin-ui.theme-changed');
    if (themedParsed.type === 'plugin-ui.theme-changed') {
      expect(themedParsed.tokens['--serpent-plugin-token-badge']).toBe('#ff9a3c');
    }
  });

  it('creates and parses non-app plugin asset URLs without allowing traversal', () => {
    const url = createPluginUiUrl({
      pluginId: 'com.example.iframe',
      instanceId: 'instance-a',
      contributionId: 'com.example.iframe.probe-view',
      libraryId: 'library-a',
      entryPath: 'entry/index.html',
    });
    expect(new URL(url).protocol).toBe('serpent-plugin:');
    expect(parsePluginUiAssetRequest(url)).toEqual({
      pluginId: 'com.example.iframe',
      instanceId: 'instance-a',
      contributionId: 'com.example.iframe.probe-view',
      libraryId: 'library-a',
      relativePath: 'entry/index.html',
    });
    expect(parsePluginUiAssetRequest(
      'serpent-plugin://com.example.iframe/instance-a/../secret.js?libraryId=library-a&contributionId=bad',
    )).toBeUndefined();
    expect(parsePluginUiAssetRequest(
      'serpent-plugin://com.example.iframe/instance-a/%2e%2e/secret.js?libraryId=library-a&contributionId=com.example.iframe.probe-view',
    )).toBeUndefined();
    // path.resolve 返回平台路径（Windows 下带盘符）
    expect(resolvePluginUiAssetPath('/plugins/com.example.iframe/1.0.0', 'entry/index.html'))
      .toBe(path.resolve('/plugins/com.example.iframe/1.0.0/entry/index.html'));
    expect(resolvePluginUiAssetPath('/plugins/com.example.iframe/1.0.0', '../secret.js'))
      .toBeUndefined();
  });

  it('recovers query-less subresource URLs via referer and HTML rewrite', () => {
    const documentUrl = createPluginUiUrl({
      pluginId: 'com.example.iframe',
      instanceId: 'instance-a',
      contributionId: 'com.example.iframe.probe-view',
      libraryId: 'library-a',
      entryPath: 'entry/ui/index.html',
    });
    const scriptUrl = new URL('./ui.js', documentUrl).href;
    expect(parsePluginUiAssetRequest(scriptUrl)).toBeUndefined();
    expect(parsePluginUiAssetRequestFromNavigation(scriptUrl, documentUrl)).toEqual({
      pluginId: 'com.example.iframe',
      instanceId: 'instance-a',
      contributionId: 'com.example.iframe.probe-view',
      libraryId: 'library-a',
      relativePath: 'entry/ui/ui.js',
    });
    expect(parsePluginUiAssetRequestFromNavigation(scriptUrl, null)).toBeUndefined();

    const rewritten = rewritePluginUiHtmlAssetUrls(
      '<script src="./ui.js"></script><link href="./app.css" rel="stylesheet">',
      documentUrl,
    );
    expect(rewritten).toContain(`src="./ui.js${new URL(documentUrl).search}"`);
    expect(rewritten).toContain(`href="./app.css${new URL(documentUrl).search}"`);
  });
});
