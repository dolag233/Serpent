import { describe, expect, it } from 'vitest';

import {
  createContributionRegistry,
  listAssetMenuContributions,
  listCommandContributions,
  listInspectorSectionContributions,
  listMenuContributions,
  listSettingsContributions,
  listToolbarContributions,
  listViewerActionContributions,
  listInspectorViewContributions,
  listSettingsPageContributions,
  listSidebarViewContributions,
  listViewerOverlayContributions,
  listWorkspaceViewContributions,
  listShortcutContributions,
  registerManifestContributions,
} from '../../src/plugins/plugin-contributions';
import { pluginManifestSchema } from '../../src/plugins/plugin-manifest';
import manifestFixture from '../fixtures/plugin-manifests/palette-tools.serpent-plugin.json';

describe('plugin Contributions', () => {
  it('preserves menu categories and nested submenu levels', () => {
    const manifest = pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        commands: [
          { id: 'probe.fast', title: 'Fast' },
          { id: 'probe.quality', title: 'Quality' },
          { id: 'probe.deep', title: 'Deep' },
        ],
        menus: {
          asset: [{
            id: 'processing',
            title: 'Processing',
            group: 'analysis',
            when: "selection.extensions intersects ['jpg','jpeg','png']",
            submenu: [
              { command: 'probe.fast', before: 'asset.rename', enablement: 'selection.assetCount == 1' },
              {
                id: 'advanced',
                title: 'Advanced',
                checked: 'app.busy',
                submenu: [{ command: 'probe.quality' }, { command: 'probe.deep' }],
              },
            ],
          }],
        },
        settings: [],
      },
    });
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '99999999-9999-4999-8999-999999999999',
      libraryId: 'library-a',
      pluginId: manifest.id,
      contributes: manifest.contributes,
    });

    expect(listAssetMenuContributions(registry)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `${manifest.id}.library-a.menu.asset.processing`,
        title: 'Processing',
        group: 'analysis',
        when: "selection.extensions intersects ['jpg','jpeg','png']",
      }),
      expect.objectContaining({
        id: `${manifest.id}.library-a.menu.asset.processing.probe.fast`,
        commandId: 'probe.fast',
        parentId: `${manifest.id}.library-a.menu.asset.processing`,
        before: 'asset.rename',
        enablement: 'selection.assetCount == 1',
      }),
      expect.objectContaining({
        id: `${manifest.id}.library-a.menu.asset.processing.advanced`,
        title: 'Advanced',
        parentId: `${manifest.id}.library-a.menu.asset.processing`,
        checked: 'app.busy',
      }),
      expect.objectContaining({
        id: `${manifest.id}.library-a.menu.asset.processing.advanced.probe.quality`,
        commandId: 'probe.quality',
        parentId: `${manifest.id}.library-a.menu.asset.processing.advanced`,
      }),
      expect.objectContaining({
        id: `${manifest.id}.library-a.menu.asset.processing.advanced.probe.deep`,
        commandId: 'probe.deep',
        parentId: `${manifest.id}.library-a.menu.asset.processing.advanced`,
      }),
    ]));
    expect(listAssetMenuContributions(registry)).toHaveLength(5);
  });

  it('registers command conditions and keeps them in the command descriptor', () => {
    const registry = createContributionRegistry();
    const manifest = pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        commands: [{
          id: 'probe.conditional',
          title: 'Conditional',
          when: 'library.open',
          enablement: 'library.writable',
          checked: 'app.busy',
        }],
        menus: {},
        settings: [],
      },
    });

    registerManifestContributions(registry, {
      pluginInstanceId: '33333333-3333-4333-8333-333333333333',
      libraryId: 'library-a',
      pluginId: manifest.id,
      contributes: manifest.contributes,
    });

    expect(listCommandContributions(registry)).toEqual([expect.objectContaining({
      commandId: 'probe.conditional',
      when: 'library.open',
      enablement: 'library.writable',
      checked: 'app.busy',
    })]);
  });

  it('rejects blank and overlong context expressions at manifest boundaries', () => {
    expect(() => pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        commands: [{ id: 'probe.invalid', title: 'Invalid', when: '   ' }],
        menus: {},
        settings: [],
      },
    })).toThrow();
    expect(() => pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        commands: [{ id: 'probe.invalid', title: 'Invalid', when: 'a'.repeat(4_097) }],
        menus: {},
        settings: [],
      },
    })).toThrow();
  });

  it('resolves asset menu titles from declared commands and exposes stable rows', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-a',
      pluginId: 'com.example.menu',
      contributes: {
        commands: [
          { id: 'probe.write-selection', title: 'Write selection' },
          { id: 'probe.other', title: 'Other command' },
        ],
        menus: {
          asset: [
            { command: 'probe.write-selection' },
            { command: 'probe.other' },
          ],
        },
        toolbar: [],
        inspector: [],
        viewerActions: [],
        shortcuts: [],
        views: [],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listAssetMenuContributions(registry)).toEqual([
      {
        id: 'com.example.menu.library-a.menu.asset.probe.other',
        pluginId: 'com.example.menu',
        pluginInstanceId: '11111111-1111-4111-8111-111111111111',
        commandId: 'probe.other',
        title: 'Other command',
        target: 'menus.asset',
      },
      {
        id: 'com.example.menu.library-a.menu.asset.probe.write-selection',
        pluginId: 'com.example.menu',
        pluginInstanceId: '11111111-1111-4111-8111-111111111111',
        commandId: 'probe.write-selection',
        title: 'Write selection',
        target: 'menus.asset',
      },
    ]);
  });

  it('registers folder and collection menu contributions with command ids', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '22222222-2222-4222-8222-222222222222',
      libraryId: 'library-a',
      pluginId: 'com.example.menu',
      contributes: {
        commands: [
          { id: 'probe.write-folder', title: 'Write folder' },
          { id: 'probe.write-collection', title: 'Write collection' },
        ],
        menus: {
          folder: [{ command: 'probe.write-folder' }],
          collection: [{ command: 'probe.write-collection' }],
        },
        toolbar: [],
        inspector: [],
        viewerActions: [],
        shortcuts: [],
        views: [],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listMenuContributions(registry, 'menus.folder')).toEqual([
      {
        id: 'com.example.menu.library-a.menu.folder.probe.write-folder',
        pluginId: 'com.example.menu',
        pluginInstanceId: '22222222-2222-4222-8222-222222222222',
        commandId: 'probe.write-folder',
        title: 'Write folder',
        target: 'menus.folder',
      },
    ]);
    expect(listMenuContributions(registry, 'menus.collection')).toEqual([
      {
        id: 'com.example.menu.library-a.menu.collection.probe.write-collection',
        pluginId: 'com.example.menu',
        pluginInstanceId: '22222222-2222-4222-8222-222222222222',
        commandId: 'probe.write-collection',
        title: 'Write collection',
        target: 'menus.collection',
      },
    ]);
    expect(listMenuContributions(registry, 'menus.workspace')).toEqual([]);
  });

  it('registers workspace menu contributions with command ids', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '55555555-5555-4555-8555-555555555555',
      libraryId: 'library-a',
      pluginId: 'com.example.menu',
      contributes: {
        commands: [
          { id: 'probe.write-workspace', title: 'Write workspace' },
        ],
        menus: {
          workspace: [{ command: 'probe.write-workspace' }],
        },
        toolbar: [],
        inspector: [],
        viewerActions: [],
        shortcuts: [],
        views: [],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listMenuContributions(registry, 'menus.workspace')).toEqual([
      {
        id: 'com.example.menu.library-a.menu.workspace.probe.write-workspace',
        pluginId: 'com.example.menu',
        pluginInstanceId: '55555555-5555-4555-8555-555555555555',
        commandId: 'probe.write-workspace',
        title: 'Write workspace',
        target: 'menus.workspace',
      },
    ]);
  });

  it('registers toolbar contributions with command ids and resolved titles', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '44444444-4444-4444-8444-444444444444',
      libraryId: 'library-a',
      pluginId: 'com.example.toolbar',
      contributes: {
        commands: [
          { id: 'probe.write-toolbar', title: 'Write toolbar' },
        ],
        menus: {},
        toolbar: [
          { id: 'write-toolbar', command: 'probe.write-toolbar' },
        ],
        inspector: [],
        viewerActions: [],
        shortcuts: [],
        views: [],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listToolbarContributions(registry)).toEqual([
      {
        id: 'com.example.toolbar.library-a.toolbar.write-toolbar',
        pluginId: 'com.example.toolbar',
        pluginInstanceId: '44444444-4444-4444-8444-444444444444',
        commandId: 'probe.write-toolbar',
        title: 'Write toolbar',
      },
    ]);
  });

  it('registers settings sections with stable ids and setting types', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '33333333-3333-4333-8333-333333333333',
      libraryId: 'library-a',
      pluginId: 'com.example.settings',
      contributes: {
        commands: [],
        menus: {},
        toolbar: [],
        inspector: [],
        viewerActions: [],
        shortcuts: [],
        views: [],
        settings: [
          { id: 'enabled-demo', title: 'Enabled demo', type: 'boolean' },
          { id: 'batch-size', title: 'Batch size', type: 'number' },
        ],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listSettingsContributions(registry)).toEqual([
      {
        id: 'com.example.settings.library-a.batch-size',
        pluginId: 'com.example.settings',
        pluginInstanceId: '33333333-3333-4333-8333-333333333333',
        settingId: 'batch-size',
        title: 'Batch size',
        type: 'number',
      },
      {
        id: 'com.example.settings.library-a.enabled-demo',
        pluginId: 'com.example.settings',
        pluginInstanceId: '33333333-3333-4333-8333-333333333333',
        settingId: 'enabled-demo',
        title: 'Enabled demo',
        type: 'boolean',
      },
    ]);
  });

  it('registers inspector sections with section and command titles', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '55555555-5555-4555-8555-555555555555',
      libraryId: 'library-a',
      pluginId: 'com.example.inspector',
      contributes: {
        commands: [
          { id: 'probe.write-inspector', title: 'Write inspector' },
        ],
        menus: {},
        toolbar: [],
        inspector: [
          { id: 'write-inspector', title: 'Probe inspector', command: 'probe.write-inspector' },
        ],
        viewerActions: [],
        shortcuts: [],
        views: [],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listInspectorSectionContributions(registry)).toEqual([
      {
        id: 'com.example.inspector.library-a.inspector.write-inspector',
        pluginId: 'com.example.inspector',
        pluginInstanceId: '55555555-5555-4555-8555-555555555555',
        commandId: 'probe.write-inspector',
        title: 'Probe inspector',
        commandTitle: 'Write inspector',
      },
    ]);
  });

  it('registers viewer actions with command ids and resolved titles', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '66666666-6666-4666-8666-666666666666',
      libraryId: 'library-a',
      pluginId: 'com.example.viewer',
      contributes: {
        commands: [
          { id: 'probe.write-viewer', title: 'Write viewer' },
        ],
        menus: {},
        toolbar: [],
        inspector: [],
        viewerActions: [
          { id: 'write-viewer', command: 'probe.write-viewer' },
        ],
        shortcuts: [],
        views: [],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listViewerActionContributions(registry)).toEqual([
      {
        id: 'com.example.viewer.library-a.viewer-action.write-viewer',
        pluginId: 'com.example.viewer',
        pluginInstanceId: '66666666-6666-4666-8666-666666666666',
        commandId: 'probe.write-viewer',
        title: 'Write viewer',
      },
    ]);
  });

  it('keeps the verified custom view entry path for workspace iframe loading', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '77777777-7777-4777-8777-777777777777',
      libraryId: 'library-a',
      pluginId: 'com.example.iframe',
      contributes: {
        commands: [],
        menus: {},
        toolbar: [],
        inspector: [],
        viewerActions: [],
        shortcuts: [],
        views: [{
          id: 'workspace-probe',
          title: 'Workspace probe',
          location: 'workspace',
          entry: 'entry/ui/index.html',
        }],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listWorkspaceViewContributions(registry)).toEqual([{
      id: 'com.example.iframe.library-a.workspace-probe',
      pluginId: 'com.example.iframe',
      pluginInstanceId: '77777777-7777-4777-8777-777777777777',
      title: 'Workspace probe',
      entryPath: 'entry/ui/index.html',
    }]);
  });

  it('registers sidebar view contributions with entry paths', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '77777777-7777-4777-8777-777777777777',
      libraryId: 'library-a',
      pluginId: 'com.example.iframe',
      contributes: {
        commands: [],
        menus: {},
        toolbar: [],
        inspector: [],
        viewerActions: [],
        shortcuts: [],
        views: [{
          id: 'sidebar-probe',
          title: 'Sidebar probe',
          location: 'sidebar',
          entry: 'entry/ui/sidebar.html',
        }],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listSidebarViewContributions(registry)).toEqual([{
      id: 'com.example.iframe.library-a.sidebar-probe',
      pluginId: 'com.example.iframe',
      pluginInstanceId: '77777777-7777-4777-8777-777777777777',
      title: 'Sidebar probe',
      entryPath: 'entry/ui/sidebar.html',
    }]);
  });

  it('registers inspector, viewer overlay, and settings page view contributions', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '88888888-8888-4888-8888-888888888888',
      libraryId: 'library-a',
      pluginId: 'com.example.iframe',
      contributes: {
        commands: [],
        menus: {},
        toolbar: [],
        inspector: [],
        viewerActions: [],
        shortcuts: [],
        views: [
          {
            id: 'inspector-probe',
            title: 'Inspector probe',
            location: 'inspector',
            entry: 'entry/ui/inspector.html',
          },
          {
            id: 'viewer-overlay-probe',
            title: 'Viewer overlay probe',
            location: 'viewer',
            entry: 'entry/ui/viewer-overlay.html',
          },
          {
            id: 'settings-page-probe',
            title: 'Settings page probe',
            location: 'settings',
            entry: 'entry/ui/settings-page.html',
          },
        ],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listInspectorViewContributions(registry)).toEqual([{
      id: 'com.example.iframe.library-a.inspector-probe',
      pluginId: 'com.example.iframe',
      pluginInstanceId: '88888888-8888-4888-8888-888888888888',
      title: 'Inspector probe',
      entryPath: 'entry/ui/inspector.html',
    }]);
    expect(listViewerOverlayContributions(registry)).toEqual([{
      id: 'com.example.iframe.library-a.viewer-overlay-probe',
      pluginId: 'com.example.iframe',
      pluginInstanceId: '88888888-8888-4888-8888-888888888888',
      title: 'Viewer overlay probe',
      entryPath: 'entry/ui/viewer-overlay.html',
    }]);
    expect(listSettingsPageContributions(registry)).toEqual([{
      id: 'com.example.iframe.library-a.settings-page-probe',
      pluginId: 'com.example.iframe',
      pluginInstanceId: '88888888-8888-4888-8888-888888888888',
      title: 'Settings page probe',
      entryPath: 'entry/ui/settings-page.html',
    }]);
  });

  it('registers shortcut contributions and skips reserved accelerators', () => {
    const registry = createContributionRegistry();

    registerManifestContributions(registry, {
      pluginInstanceId: '99999999-9999-4999-8999-999999999999',
      libraryId: 'library-a',
      pluginId: 'com.example.shortcuts',
      contributes: {
        commands: [
          { id: 'probe.write-shortcut', title: 'Write shortcut' },
          { id: 'probe.conflict', title: 'Conflict' },
        ],
        menus: {},
        toolbar: [],
        inspector: [],
        viewerActions: [],
        shortcuts: [
          { id: 'write-shortcut', command: 'probe.write-shortcut', accelerator: 'F9' },
          { id: 'focus-search', command: 'probe.conflict', accelerator: 'CmdOrCtrl+F' },
        ],
        views: [],
        settings: [],
        hooks: [],
        jobs: [],
        providers: [],
        themes: [],
      },
    });

    expect(listShortcutContributions(registry)).toEqual([
      {
        id: 'com.example.shortcuts.library-a.shortcut.write-shortcut',
        pluginId: 'com.example.shortcuts',
        pluginInstanceId: '99999999-9999-4999-8999-999999999999',
        commandId: 'probe.write-shortcut',
        title: 'Write shortcut',
        accelerator: 'F9',
      },
    ]);
  });
});
