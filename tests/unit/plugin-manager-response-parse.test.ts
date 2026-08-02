import { describe, expect, it } from 'vitest';
import { parsePluginManagerResponse } from '../../src/shared/plugin-manager-api';

describe('plugin manager response parse', () => {
  it('parses empty success', () => {
    expect(parsePluginManagerResponse({
      ok: true,
      packages: [],
      resolutions: [],
      safeMode: false,
    })).toEqual({ ok: true, packages: [], resolutions: [], safeMode: false });
  });

  it('parses field-level plugin setting diagnostics', () => {
    expect(parsePluginManagerResponse({
      ok: true,
      sections: [{
        id: 'batch-size',
        title: 'Batch size',
        type: 'number',
        default: 4,
        minimum: 1,
        maximum: 8,
        value: 4,
      }],
      diagnostics: [{
        settingId: 'batch-size',
        layer: 'library',
        code: 'out-of-range',
        message: 'The setting value is outside the declared range.',
      }],
    })).toMatchObject({
      ok: true,
      diagnostics: [{ settingId: 'batch-size', code: 'out-of-range' }],
    });
  });

  it('parses all host setting control types without exposing undeclared storage keys', () => {
    const parsed = parsePluginManagerResponse({
      ok: true,
      sections: [
        {
          id: 'enabled',
          title: 'Enabled',
          type: 'boolean',
          default: true,
          value: false,
        },
        {
          id: 'batch-size',
          title: 'Batch size',
          type: 'number',
          default: 4,
          minimum: 1,
          maximum: 8,
          value: 8,
        },
        {
          id: 'label',
          title: 'Label',
          type: 'string',
          default: 'Default',
          value: 'Updated',
        },
        {
          id: 'quality',
          title: 'Quality',
          type: 'select',
          default: 'fast',
          options: [
            { value: 'fast', label: 'Fast' },
            { value: 'high', label: 'High' },
          ],
          value: 'high',
        },
      ],
      diagnostics: [],
    });

    expect(parsed).toMatchObject({
      ok: true,
      sections: expect.arrayContaining([
        expect.objectContaining({ id: 'enabled', type: 'boolean', value: false }),
        expect.objectContaining({ id: 'batch-size', type: 'number', minimum: 1, maximum: 8, value: 8 }),
        expect.objectContaining({ id: 'label', type: 'string', value: 'Updated' }),
        expect.objectContaining({ id: 'quality', type: 'select', options: expect.any(Array), value: 'high' }),
      ]),
    });
    if (!('sections' in parsed)) throw new Error('expected settings sections');
    expect(parsed.sections.map((section) => section.id)).toEqual([
      'enabled',
      'batch-size',
      'label',
      'quality',
    ]);
    expect(parsed.sections.map((section) => section.id)).not.toContain('removed-setting');
    expect(() => parsePluginManagerResponse({
      ok: true,
      sections: [{
        id: 'quality',
        title: 'Quality',
        type: 'select',
        default: 'fast',
        value: 'fast',
        values: { 'removed-setting': true },
      }],
      diagnostics: [],
    })).toThrow();
  });

  const viewTargets = [
    'sidebar.entries',
    'workspace.views',
    'inspector.views',
    'viewer.overlays',
    'settings.pages',
  ] as const;

  it.each(viewTargets)('parses view contribution target %s without duplicate discriminator errors', (target) => {
    const parsed = parsePluginManagerResponse({
      ok: true,
      contributions: [{
        kind: 'view',
        id: `com.example.probe.${target}`,
        pluginId: 'com.example.probe',
        pluginInstanceId: '59847245-d394-4012-ad75-35f837393a8f',
        title: `Probe ${target}`,
        target,
        entryPath: 'entry/ui/index.html',
        url: `serpent-plugin://com.example.probe/59847245-d394-4012-ad75-35f837393a8f/entry/ui/index.html?libraryId=library-a&contributionId=com.example.probe.${target}`,
      }],
    });
    expect(parsed.ok).toBe(true);
    if (!('contributions' in parsed)) throw new Error('expected contributions');
    expect(parsed.contributions).toHaveLength(1);
    expect(parsed.contributions[0]).toMatchObject({
      kind: 'view',
      target,
      pluginId: 'com.example.probe',
      url: expect.stringMatching(/^serpent-plugin:\/\//u),
    });
  });

  it('parses a mixed contribution array with every view target plus menus.asset', () => {
    const instanceId = '59847245-d394-4012-ad75-35f837393a8f';
    const parsed = parsePluginManagerResponse({
      ok: true,
      contributions: [
        {
          kind: 'menu',
          id: 'com.example.probe.menu.asset.do',
          pluginId: 'com.example.probe',
          pluginInstanceId: instanceId,
          commandId: 'do',
          title: 'Do thing',
          target: 'menus.asset',
        },
        ...viewTargets.map((target) => ({
          kind: 'view' as const,
          id: `com.example.probe.${target}`,
          pluginId: 'com.example.probe',
          pluginInstanceId: instanceId,
          title: `Probe ${target}`,
          target,
          entryPath: 'entry/ui/index.html',
          url: `serpent-plugin://com.example.probe/${instanceId}/entry/ui/index.html?libraryId=library-a&contributionId=com.example.probe.${target}`,
        })),
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!('contributions' in parsed)) throw new Error('expected contributions');
    expect(parsed.contributions).toHaveLength(1 + viewTargets.length);
    expect(parsed.contributions.map((item) => ('target' in item ? item.target : undefined))).toEqual([
      'menus.asset',
      ...viewTargets,
    ]);
  });

  it('parses menus.asset contributions', () => {
    const parsed = parsePluginManagerResponse({
      ok: true,
      contributions: [{
        kind: 'menu',
        id: 'com.dolag.serpent.image-upscaler.upscale.selection',
        pluginId: 'com.dolag.serpent.image-upscaler',
        pluginInstanceId: '59847245-d394-4012-ad75-35f837393a8f',
        commandId: 'upscale.selection',
        title: '图像超分辨率（选中图像）',
        target: 'menus.asset',
      }],
    });
    expect(parsed.ok).toBe(true);
    if (!('contributions' in parsed)) throw new Error('expected contributions');
    expect(parsed.contributions[0]).toMatchObject({
      kind: 'menu',
      target: 'menus.asset',
      commandId: 'upscale.selection',
    });
  });

  it('preserves menu tree metadata and host setting control metadata', () => {
    const parsed = parsePluginManagerResponse({
      ok: true,
      contributions: [{
        kind: 'menu',
        id: 'com.example.menu.processing',
        pluginId: 'com.example.menu',
        pluginInstanceId: '59847245-d394-4012-ad75-35f837393a8f',
        title: 'Processing',
        target: 'menus.asset',
        group: 'organize',
        before: 'asset.rename',
        when: "selection.extensions intersects ['jpg','jpeg','png']",
        enablement: 'selection.assetCount == 1',
        checked: 'app.busy',
      }, {
        kind: 'command',
        id: 'com.example.menu.processing-command',
        pluginId: 'com.example.menu',
        pluginInstanceId: '59847245-d394-4012-ad75-35f837393a8f',
        commandId: 'processing',
        title: 'Processing',
        when: 'library.open',
        enablement: 'library.writable',
        checked: 'app.busy',
        target: 'commands',
      }, {
        kind: 'settings-section',
        id: 'com.example.settings.quality',
        pluginId: 'com.example.settings',
        pluginInstanceId: '59847245-d394-4012-ad75-35f837393a8f',
        settingId: 'quality',
        title: 'Quality',
        type: 'select',
        description: 'Choose quality.',
        options: [{ value: 'high', label: 'High' }],
        target: 'settings.sections',
      }],
    });

    expect(parsed.ok).toBe(true);
    if (!('contributions' in parsed)) throw new Error('expected contributions');
    expect(parsed.contributions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'menu',
        group: 'organize',
        before: 'asset.rename',
        when: "selection.extensions intersects ['jpg','jpeg','png']",
        enablement: 'selection.assetCount == 1',
        checked: 'app.busy',
      }),
      expect.objectContaining({
        kind: 'command',
        when: 'library.open',
        enablement: 'library.writable',
        checked: 'app.busy',
      }),
      expect.objectContaining({
        kind: 'settings-section',
        type: 'select',
        description: 'Choose quality.',
        options: [{ value: 'high', label: 'High' }],
      }),
    ]));
  });

  it('parses awaiting-trust resolution', () => {
    const hash = 'a'.repeat(64);
    expect(parsePluginManagerResponse({
      ok: true,
      packages: [{
        pluginId: 'com.example.palette-tools',
        version: '1.2.0',
        name: 'Palette Tools',
        description: 'Extract and organize asset palettes.',
        packageHash: hash,
        runtimeMode: 'restricted',
        permissions: ['asset.read'],
        source: { kind: 'local-directory' },
        sourceFingerprint: 'local:palette-tools',
        scope: 'library',
        status: 'valid',
        trust: 'untrusted',
        hasSettingsUi: false,
      }],
      resolutions: [{
        status: 'awaiting-trust',
        pluginId: 'com.example.palette-tools',
        version: '1.2.0',
        packageHash: hash,
        selection: 'use-library',
        reason: 'untrusted',
      }],
      safeMode: false,
    }).ok).toBe(true);
  });

  it('parses quarantined disabled resolution', () => {
    const hash = 'b'.repeat(64);
    expect(parsePluginManagerResponse({
      ok: true,
      packages: [],
      resolutions: [{
        status: 'disabled',
        pluginId: 'com.example.palette-tools',
        reason: 'quarantined',
        version: '1.2.0',
        packageHash: hash,
      }],
      safeMode: false,
    }).ok).toBe(true);
  });
});
