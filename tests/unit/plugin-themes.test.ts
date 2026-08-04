import { describe, expect, it } from 'vitest';

import { pluginManifestSchema } from '../../src/plugins/plugin-manifest';
import {
  buildPluginUiThemeHostMessage,
  contributionThemeSchema,
  extractPluginThemePackage,
  mergePluginIframeThemeTokens,
  pluginRequiresTrustedCssDisclosure,
} from '../../src/plugins/plugin-themes';
import { parsePluginUiHostMessage } from '../../src/shared/plugin-ui-protocol';
import iframeProbeManifest from '../fixtures/plugins/iframe-workspace-probe/serpent-plugin.json';

describe('plugin theme token packages (PLUGIN-032)', () => {
  it('accepts semantic references and bounded plugin-owned color tokens', () => {
    const parsed = contributionThemeSchema.parse({
      id: 'brand',
      version: 1,
      light: {
        references: { accent: 'action.accent' },
        tokens: { badge: '#c45a00' },
      },
      dark: {
        references: { accent: 'action.accent' },
        tokens: { badge: '#ff9a3c' },
      },
    });
    expect(parsed.id).toBe('brand');
    expect(() => contributionThemeSchema.parse({
      id: 'bad-token',
      light: { tokens: { '--host-dom': '#000000' } },
    })).toThrow();
    expect(() => contributionThemeSchema.parse({
      id: 'bad-value',
      light: { tokens: { badge: 'url(https://evil.invalid)' } },
    })).toThrow();
  });

  it('extracts and merges manifest theme packages for the active resolved theme', () => {
    const manifest = pluginManifestSchema.parse(iframeProbeManifest);
    const themePackage = extractPluginThemePackage(manifest);
    expect(themePackage).toEqual({
      version: 1,
      light: {
        references: { accent: 'action.accent' },
        tokens: { badge: '#c45a00' },
      },
      dark: {
        references: { accent: 'action.accent' },
        tokens: { badge: '#ff9a3c' },
      },
    });
    expect(mergePluginIframeThemeTokens({
      hostTokens: { '--ui-surface-canvas': '#111417', '--ui-action-accent': '#3b82f6' },
      themePackage,
      resolvedTheme: 'dark',
    })).toEqual({
      '--ui-surface-canvas': '#111417',
      '--ui-action-accent': '#3b82f6',
      '--serpent-plugin-ref-accent': '#3b82f6',
      '--serpent-plugin-token-badge': '#ff9a3c',
    });
  });

  it('builds a schema-valid plugin-ui.theme-changed message with plugin aliases', () => {
    const message = buildPluginUiThemeHostMessage({
      contributionId: 'com.serpent.iframe-workspace-probe.workspace-probe',
      instanceId: 'instance-a',
      resolvedTheme: 'light',
      revision: 4,
      hostTokens: { '--ui-surface-canvas': '#f5f5f4', '--ui-action-accent': '#2563eb' },
      themePackage: {
        version: 1,
        light: {
          references: { accent: 'action.accent' },
          tokens: { badge: '#c45a00' },
        },
        dark: {
          references: { accent: 'action.accent' },
          tokens: { badge: '#ff9a3c' },
        },
      },
    });
    const parsed = parsePluginUiHostMessage(message);
    expect(parsed.type).toBe('plugin-ui.theme-changed');
    if (parsed.type === 'plugin-ui.theme-changed') {
      expect(parsed.theme).toBe('light');
      expect(parsed.revision).toBe(4);
      expect(parsed.contrast).toBe('normal');
      expect(parsed.tokens['--serpent-plugin-ref-accent']).toBe('#2563eb');
      expect(parsed.tokens['--serpent-plugin-token-badge']).toBe('#c45a00');
    }
  });

  it('flags trusted CSS permission for disclosure surfaces', () => {
    expect(pluginRequiresTrustedCssDisclosure(['ui.workspace', 'theme.trusted-css'])).toBe(true);
    expect(pluginRequiresTrustedCssDisclosure(['ui.workspace'])).toBe(false);
  });
});
