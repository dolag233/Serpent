// @vitest-environment happy-dom

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  createContributionRegistry,
  listUiDescriptorContributions,
  registerManifestContributions,
} from '../../src/plugins/plugin-contributions';
import { pluginManifestSchema } from '../../src/plugins/plugin-manifest';
import {
  parsePluginUiDescriptor,
  pluginUiDescriptorSchema,
} from '../../src/shared/plugin-ui-descriptor';
import { pluginManagerContributionSchema } from '../../src/shared/plugin-manager-api';
import { PluginUiDescriptorRenderer } from '../../src/renderer/plugin-ui-descriptor-renderer';
import manifestFixture from '../fixtures/plugin-manifests/plugin-ui-descriptor.serpent-plugin.json';

describe('Plugin UI Contract v1', () => {
  it('parses the fixture through the existing manifest and contribution registry', () => {
    const manifest = pluginManifestSchema.parse(manifestFixture);
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '99999999-9999-4999-8999-999999999999',
      pluginId: manifest.id,
      libraryId: 'library-a',
      contributes: manifest.contributes,
    });

    const descriptors = listUiDescriptorContributions(registry);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.descriptor.settings?.groups[0]?.items).toHaveLength(3);
    expect(descriptors[0]?.descriptor.jobs?.[0]?.id).toBe('index');

    const ipcContribution = pluginManagerContributionSchema.parse({
      kind: 'ui-descriptor',
      id: descriptors[0]?.id,
      pluginId: manifest.id,
      pluginInstanceId: '99999999-9999-4999-8999-999999999999',
      descriptor: descriptors[0]?.descriptor,
      target: 'ui.descriptor',
    });
    expect(ipcContribution.kind).toBe('ui-descriptor');
  });

  it('keeps valid fields when individual JSON entries are invalid', () => {
    const result = parsePluginUiDescriptor({
      version: 1,
      notices: [
        { id: 'good', message: 'Good', tone: 'success' },
        { id: 'bad', message: 'Bad', css: '.plugin { color: red; }' },
        { id: 'also-good', message: 'Also good' },
      ],
      activities: { bad: true },
      settings: {
        groups: [{
          id: 'general',
          title: 'General',
          items: [{ settingId: 'enabled' }, { settingId: 'bad id' }],
        }],
      },
      onClick: () => undefined,
    });

    expect(result.descriptor?.notices?.map((notice) => notice.id)).toEqual(['good', 'also-good']);
    expect(result.descriptor?.activities).toBeUndefined();
    expect(result.descriptor?.settings?.groups[0]?.items).toEqual([{ settingId: 'enabled' }]);
    expect(result.diagnostics.some((item) => item.path === 'notices[1]')).toBe(true);
    expect(result.diagnostics.some((item) => item.path === 'activities')).toBe(true);
    expect(result.diagnostics.some((item) => item.path === 'onClick')).toBe(true);
  });

  it('rejects unsupported versions and non-JSON UI fields', () => {
    expect(parsePluginUiDescriptor({ version: 2 }).descriptor).toBeUndefined();
    expect(parsePluginUiDescriptor({ version: 2 }).diagnostics[0]?.code).toBe('unsupported-version');
    expect(pluginUiDescriptorSchema.safeParse({
      version: 1,
      notices: [{ id: 'unsafe', message: 'x', html: '<b>x</b>' }],
    }).success).toBe(false);
  });

  it('renders settings, submenu, notice, activity and job using shared Host UI', () => {
    const manifest = pluginManifestSchema.parse(manifestFixture);
    const settings = [
      { id: 'enabled', title: 'Enabled', type: 'boolean' as const, default: true, value: true },
      {
        id: 'quality', title: 'Quality', type: 'select' as const, default: 'balanced', value: 'balanced',
        options: [{ value: 'balanced', label: 'Balanced' }, { value: 'best', label: 'Best' }],
      },
      { id: 'scale', title: 'Scale', type: 'slider' as const, default: 2, value: 2, minimum: 1, maximum: 4, step: 1 },
    ];
    const html = renderToStaticMarkup(createElement(PluginUiDescriptorRenderer, {
      descriptor: manifest.contributes.ui!,
      jobs: new Map([['index', { status: 'running' as const, completed: 1, total: 2, phase: 'reading' }]]),
      onCommand: () => undefined,
      settings,
    }));

    expect(html).toContain('data-ui-pattern="settings-card"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('⌘R');
    expect(html).toContain('data-ui-pattern="notice"');
    expect(html).toContain('data-ui-pattern="activity"');
    expect(html).toContain('reading');
    expect(html).toContain('data-ui-pattern="status-badge"');
  });
});
