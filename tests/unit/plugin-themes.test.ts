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
  it('accepts bounded contributes.themes token overrides', () => {
    const parsed = contributionThemeSchema.parse({
      id: 'brand',
      light: { '--accent': '#c45a00', '--canvas': '#f5f5f4' },
      dark: { '--accent': '#ff9a3c' },
    });
    expect(parsed.id).toBe('brand');
    expect(() => contributionThemeSchema.parse({
      id: 'bad-token',
      light: { '--host-dom': '#000000' },
    })).toThrow();
  });

  it('extracts and merges manifest theme packages for the active resolved theme', () => {
    const manifest = pluginManifestSchema.parse(iframeProbeManifest);
    const themePackage = extractPluginThemePackage(manifest);
    expect(themePackage).toEqual({
      light: { '--accent': '#c45a00' },
      dark: { '--accent': '#ff9a3c' },
    });
    expect(mergePluginIframeThemeTokens({
      hostTokens: { '--canvas': '#111417', '--accent': '#3b82f6' },
      themePackage,
      resolvedTheme: 'dark',
    })).toEqual({
      '--canvas': '#111417',
      '--accent': '#ff9a3c',
    });
  });

  it('builds a schema-valid plugin-ui.theme host message with plugin overrides', () => {
    const message = buildPluginUiThemeHostMessage({
      contributionId: 'com.serpent.iframe-workspace-probe.workspace-probe',
      instanceId: 'instance-a',
      resolvedTheme: 'light',
      hostTokens: { '--canvas': '#f5f5f4', '--accent': '#2563eb' },
      themePackage: {
        light: { '--accent': '#c45a00' },
        dark: { '--accent': '#ff9a3c' },
      },
    });
    const parsed = parsePluginUiHostMessage(message);
    expect(parsed.type).toBe('plugin-ui.theme');
    if (parsed.type === 'plugin-ui.theme') {
      expect(parsed.theme).toBe('light');
      expect(parsed.tokens['--accent']).toBe('#c45a00');
      expect(parsed.tokens['--canvas']).toBe('#f5f5f4');
    }
  });

  it('flags trusted CSS permission for disclosure surfaces', () => {
    expect(pluginRequiresTrustedCssDisclosure(['ui.workspace', 'theme.trusted-css'])).toBe(true);
    expect(pluginRequiresTrustedCssDisclosure(['ui.workspace'])).toBe(false);
  });
});
