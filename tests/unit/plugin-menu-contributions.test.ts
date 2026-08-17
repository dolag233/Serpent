import { describe, expect, it, vi } from 'vitest';

import {
  buildPluginMenuDescriptors,
  placePluginMenuItemsAroundHost,
  runPluginMenuCommand,
} from '../../src/renderer/plugin-menu-contributions';
import { createPluginContributionContext } from '../../src/plugins/plugin-context';

function createContext() {
  return createPluginContributionContext({
    contextId: 'context-1',
    revision: 1,
    app: { platform: 'darwin', locale: 'zh-CN', theme: 'dark', busy: false },
    surface: { id: 'asset-context-menu', kind: 'context-menu' },
    window: { windowId: 'window-1' },
    library: { id: 'library-a', open: true, writable: true, offline: false },
    selection: {
      ref: 'selection-1',
      count: 1,
      primaryId: 'asset-1',
      assetCount: 1,
      folderCount: 0,
      mixed: false,
      extensions: ['jpg'],
      mimeTypes: ['image/jpeg'],
      mediaKinds: ['image'],
      summary: {
        managedCount: 1,
        unmanagedCount: 0,
        availableCount: 1,
        unavailableCount: 0,
        deletedCount: 0,
        hasDeleted: false,
        hasUnavailable: false,
      },
      hasDeleted: false,
      hasUnavailable: false,
    },
    browse: {},
    viewer: { active: false, fullscreen: false },
  });
}

describe('plugin menu contribution descriptors', () => {
  it('keeps plugin-to-plugin placement inside the host group', () => {
    const items = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'plugin-a',
        pluginId: 'com.example.menu',
        title: 'A',
        target: 'menus.asset',
        group: 'organize',
      },
      {
        kind: 'menu',
        id: 'plugin-b',
        pluginId: 'com.example.menu',
        title: 'B',
        target: 'menus.asset',
        after: 'plugin-a',
      },
    ] as never);

    const placement = placePluginMenuItemsAroundHost(
      items,
      { organize: ['asset.rename'] },
      new Set(['asset.rename']),
    );

    expect(placement.groups.get('organize')?.after.map((item) => item.id))
      .toEqual(['plugin-a', 'plugin-b']);
    expect(placement.outside).toEqual([]);
  });

  it('keeps a plugin chain adjacent to an inline host anchor', () => {
    const items = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'plugin-a',
        pluginId: 'com.example.menu',
        title: 'A',
        target: 'menus.asset',
        after: 'asset.rename',
      },
      {
        kind: 'menu',
        id: 'plugin-b',
        pluginId: 'com.example.menu',
        title: 'B',
        target: 'menus.asset',
        after: 'plugin-a',
      },
    ] as never);

    const placement = placePluginMenuItemsAroundHost(
      items,
      { organize: ['asset.rename'] },
      new Set(['asset.rename']),
    );

    expect(placement.anchors.get('asset.rename')?.after.map((item) => item.id))
      .toEqual(['plugin-a', 'plugin-b']);
    expect(placement.outside).toEqual([]);
  });

  it('maps non-inline host anchors into their rendered host group', () => {
    const items = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'plugin-a',
        pluginId: 'com.example.menu',
        title: 'A',
        target: 'menus.asset',
        before: 'asset.copy',
      },
      {
        kind: 'menu',
        id: 'plugin-b',
        pluginId: 'com.example.menu',
        title: 'B',
        target: 'menus.asset',
        after: 'plugin-a',
        group: 'metadata',
      },
    ] as never);

    const placement = placePluginMenuItemsAroundHost(
      items,
      { organize: ['asset.copy'], metadata: ['asset.ai-analyze'] },
      new Set(),
    );

    expect(placement.groups.get('organize')?.before.map((item) => item.id))
      .toEqual(['plugin-a', 'plugin-b']);
    expect(placement.groups.get('metadata')?.after).toEqual([]);
    expect(placement.outside).toEqual([]);
  });

  it('keeps an unavailable host anchor visible in the plugin section', () => {
    const items = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'plugin-a',
        pluginId: 'com.example.menu',
        title: 'A',
        target: 'menus.asset',
        after: 'asset.open-with',
      },
    ] as never);

    const placement = placePluginMenuItemsAroundHost(
      items,
      { open: ['asset.view'], organize: ['asset.copy'] },
      new Set(),
    );

    expect(placement.outside.map((item) => item.id)).toEqual(['plugin-a']);
  });

  it('keeps an explicit cross-group plugin edge in one rendered group', () => {
    const items = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'plugin-a',
        pluginId: 'com.example.menu',
        title: 'A',
        target: 'menus.asset',
        group: 'metadata',
      },
      {
        kind: 'menu',
        id: 'plugin-b',
        pluginId: 'com.example.menu',
        title: 'B',
        target: 'menus.asset',
        group: 'organize',
        after: 'plugin-a',
      },
    ] as never);

    const placement = placePluginMenuItemsAroundHost(
      items,
      { organize: ['asset.copy'], metadata: ['asset.ai-analyze'] },
      new Set(),
    );

    expect(placement.groups.get('organize')?.after.map((item) => item.id))
      .toEqual(['plugin-a', 'plugin-b']);
    expect(placement.groups.get('metadata')?.after).toEqual([]);
  });

  it('formats portable accelerators for the active menu platform', () => {
    const [descriptor] = buildPluginMenuDescriptors([{
      kind: 'menu',
      id: 'shortcut',
      pluginId: 'com.example.menu',
      pluginInstanceId: 'instance',
      title: 'Shortcut',
      target: 'menus.asset',
      commandId: 'shortcut',
      shortcut: 'CmdOrCtrl+Shift+K',
    }] as never);

    expect(descriptor?.shortcut).toBe('Ctrl+Shift+K');
  });

  it('builds grouped nested menu descriptors up to three levels', () => {
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'com.example.menu.menu.asset.processing',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Processing',
        target: 'menus.asset',
        group: 'analysis',
      },
      {
        kind: 'menu',
        id: 'com.example.menu.menu.asset.processing.fast',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Fast',
        target: 'menus.asset',
        parentId: 'com.example.menu.menu.asset.processing',
        commandId: 'probe.fast',
        shortcut: 'F9',
        before: 'asset.rename',
      },
      {
        kind: 'menu',
        id: 'com.example.menu.menu.asset.processing.advanced',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Advanced',
        target: 'menus.asset',
        parentId: 'com.example.menu.menu.asset.processing',
      },
      {
        kind: 'menu',
        id: 'com.example.menu.menu.asset.processing.advanced.quality',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Quality',
        target: 'menus.asset',
        parentId: 'com.example.menu.menu.asset.processing.advanced',
        commandId: 'probe.quality',
      },
    ] as never);

    expect(descriptors).toEqual([{
      id: 'com.example.menu.menu.asset.processing',
      label: 'Processing',
      contributionId: 'com.example.menu.menu.asset.processing',
      pluginId: 'com.example.menu',
      disabled: false,
      group: 'analysis',
      children: [{
        id: 'com.example.menu.menu.asset.processing.advanced',
        label: 'Advanced',
        contributionId: 'com.example.menu.menu.asset.processing.advanced',
        pluginId: 'com.example.menu',
        disabled: false,
        children: [{
          id: 'com.example.menu.menu.asset.processing.advanced.quality',
          label: 'Quality',
          contributionId: 'com.example.menu.menu.asset.processing.advanced.quality',
          commandId: 'probe.quality',
          pluginId: 'com.example.menu',
          disabled: false,
          children: [],
        }],
      }, {
        id: 'com.example.menu.menu.asset.processing.fast',
        label: 'Fast',
        contributionId: 'com.example.menu.menu.asset.processing.fast',
        commandId: 'probe.fast',
        pluginId: 'com.example.menu',
        disabled: false,
        before: 'asset.rename',
        shortcut: 'F9',
        children: [],
      }],
    }]);
  });

  it('honors first and last placement constraints before group ordering', () => {
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'middle',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Middle',
        target: 'menus.asset',
        group: 'a',
      },
      {
        kind: 'menu',
        id: 'last',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Last',
        target: 'menus.asset',
        first: false,
        last: true,
      },
      {
        kind: 'menu',
        id: 'first',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'First',
        target: 'menus.asset',
        first: true,
      },
    ] as never);

    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(['first', 'middle', 'last']);
  });

  it('keeps deterministic plugin ties and reports unknown anchors without dropping items', () => {
    const diagnostics: unknown[] = [];
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'z-item',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Z',
        target: 'menus.asset',
        before: 'missing.host.command',
      },
      {
        kind: 'menu',
        id: 'a-item',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'A',
        target: 'menus.asset',
      },
    ] as never, undefined, { onPlacementDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });

    expect(descriptors.map((item) => item.id)).toEqual(['a-item', 'z-item']);
    expect(diagnostics).toEqual([{
      code: 'missing-anchor',
      itemId: 'z-item',
      anchorId: 'missing.host.command',
    }]);
  });

  it('breaks only a cyclic placement relation and keeps every branch', () => {
    const diagnostics: unknown[] = [];
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'a',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'A',
        target: 'menus.asset',
        after: 'b',
      },
      {
        kind: 'menu',
        id: 'b',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'B',
        target: 'menus.asset',
        after: 'a',
      },
    ] as never, undefined, { onPlacementDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });

    expect(descriptors.map((item) => item.id)).toEqual(['b', 'a']);
    expect(diagnostics).toEqual([{
      code: 'cycle-broken',
      itemId: 'a',
      anchorId: 'b',
    }]);
  });

  it('rejects only children beyond the supported menu depth', () => {
    const diagnostics: unknown[] = [];
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'level-1',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Level 1',
        target: 'menus.asset',
      },
      {
        kind: 'menu',
        id: 'level-2',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Level 2',
        target: 'menus.asset',
        parentId: 'level-1',
      },
      {
        kind: 'menu',
        id: 'level-3',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Level 3',
        target: 'menus.asset',
        parentId: 'level-2',
      },
      {
        kind: 'menu',
        id: 'level-4',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Level 4',
        target: 'menus.asset',
        parentId: 'level-3',
      },
    ] as never, undefined, { onPlacementDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.children[0]?.children).toHaveLength(1);
    expect(descriptors[0]?.children[0]?.children[0]?.children).toEqual([]);
    expect(diagnostics).toEqual([{
      code: 'max-depth',
      itemId: 'level-4',
    }]);
  });

  it('filters when, computes enablement and checked from a Contribution Context', () => {
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'jpg-only',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'JPG only',
        target: 'menus.asset',
        commandId: 'jpg-only',
        when: "selection.extensions intersects ['jpg','jpeg','png']",
      },
      {
        kind: 'menu',
        id: 'hidden-gif',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'GIF only',
        target: 'menus.asset',
        commandId: 'hidden-gif',
        when: "selection.extensions intersects ['gif']",
      },
      {
        kind: 'menu',
        id: 'disabled',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Disabled',
        target: 'menus.asset',
        commandId: 'disabled',
        enablement: 'selection.assetCount == 2',
      },
      {
        kind: 'menu',
        id: 'checked',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Checked',
        target: 'menus.asset',
        commandId: 'checked',
        checked: "app.theme == 'dark'",
      },
      {
        kind: 'menu',
        id: 'advanced',
        pluginId: 'com.example.menu',
        pluginInstanceId: 'instance',
        title: 'Advanced',
        target: 'menus.asset',
        submenu: undefined,
      },
    ] as never, createContext());

    expect(descriptors.map((item) => item.id)).toEqual(['advanced', 'checked', 'disabled', 'jpg-only']);
    expect(descriptors.find((item) => item.id === 'hidden-gif')).toBeUndefined();
    expect(descriptors.find((item) => item.id === 'jpg-only')).toMatchObject({
      disabled: false,
      condition: { when: "selection.extensions intersects ['jpg','jpeg','png']" },
    });
    expect(descriptors.find((item) => item.id === 'disabled')).toMatchObject({ disabled: true });
    expect(descriptors.find((item) => item.id === 'checked')).toMatchObject({
      checked: true,
      condition: { checked: "app.theme == 'dark'" },
    });
  });

  it('matches extension, MIME, and media kind predicates while failing closed for multi/mixed selections', () => {
    const context = createContext();
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'extension',
        pluginId: 'com.example.menu',
        title: 'Extension',
        commandId: 'extension',
        when: "selection.extensions intersects ['jpg']",
      },
      {
        kind: 'menu',
        id: 'mime',
        pluginId: 'com.example.menu',
        title: 'MIME',
        commandId: 'mime',
        when: "selection.mimeTypes intersects ['image/jpeg']",
      },
      {
        kind: 'menu',
        id: 'media-kind',
        pluginId: 'com.example.menu',
        title: 'Media kind',
        commandId: 'media-kind',
        when: "selection.mediaKinds intersects ['image']",
      },
      {
        kind: 'menu',
        id: 'multi-only',
        pluginId: 'com.example.menu',
        title: 'Multi only',
        commandId: 'multi-only',
        when: 'selection.assetCount == 2',
      },
      {
        kind: 'menu',
        id: 'mixed-only',
        pluginId: 'com.example.menu',
        title: 'Mixed only',
        commandId: 'mixed-only',
        when: 'selection.mixed == true',
      },
      {
        kind: 'menu',
        id: 'unknown-field',
        pluginId: 'com.example.menu',
        title: 'Unknown field',
        commandId: 'unknown-field',
        when: 'selection.isMulti == true',
      },
    ] as never, context);

    expect(descriptors.map((item) => item.id)).toEqual(['extension', 'media-kind', 'mime']);
  });

  it('preserves conditional state on nested parent and child menu descriptors', () => {
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'parent',
        pluginId: 'com.example.menu',
        title: 'Parent',
        when: 'selection.assetCount == 1',
        enablement: 'library.writable',
      },
      {
        kind: 'menu',
        id: 'child',
        pluginId: 'com.example.menu',
        title: 'Child',
        parentId: 'parent',
        commandId: 'child',
        checked: "app.theme == 'dark'",
      },
    ] as never, createContext());

    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({
      id: 'parent',
      disabled: false,
      condition: {
        when: 'selection.assetCount == 1',
        enablement: 'library.writable',
      },
      children: [{
        id: 'child',
        commandId: 'child',
        checked: true,
        condition: { checked: "app.theme == 'dark'" },
      }],
    });
  });

  it('does not promote children when their parent is hidden by when', () => {
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu',
        id: 'hidden-parent',
        pluginId: 'com.example.menu',
        title: 'Hidden parent',
        when: "selection.extensions intersects ['gif']",
      },
      {
        kind: 'menu',
        id: 'hidden-child',
        pluginId: 'com.example.menu',
        title: 'Hidden child',
        parentId: 'hidden-parent',
        commandId: 'hidden-child',
      },
      {
        kind: 'menu',
        id: 'visible-root',
        pluginId: 'com.example.menu',
        title: 'Visible root',
        commandId: 'visible-root',
      },
    ] as never, createContext());

    expect(descriptors.map((item) => item.id)).toEqual(['visible-root']);
  });

  it('keeps conditional descriptors unchanged when no context snapshot is supplied', () => {
    const [descriptor] = buildPluginMenuDescriptors([{
      kind: 'menu',
      id: 'conditional',
      pluginId: 'com.example.menu',
      title: 'Conditional',
      commandId: 'conditional',
      when: 'selection.assetCount == 1',
      enablement: 'library.writable',
      checked: 'app.busy',
    }]);

    expect(descriptor).toMatchObject({
      disabled: false,
      condition: {
        when: 'selection.assetCount == 1',
        enablement: 'library.writable',
        checked: 'app.busy',
      },
    });
    expect(descriptor?.checked).toBeUndefined();
  });

  it('breaks a parent cycle without dropping the entire menu tree', () => {
    const diagnostics: unknown[] = [];
    const descriptors = buildPluginMenuDescriptors([
      {
        kind: 'menu', id: 'a', pluginId: 'com.example.menu', title: 'A', parentId: 'b', commandId: 'a',
      },
      {
        kind: 'menu', id: 'b', pluginId: 'com.example.menu', title: 'B', parentId: 'a', commandId: 'b',
      },
    ] as never, createContext(), {
      onPlacementDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(descriptors.length).toBeGreaterThan(0);
    expect(JSON.stringify(descriptors)).toContain('A');
    expect(JSON.stringify(descriptors)).toContain('B');
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'cycle-broken' }),
    ]));
  });

  it('freezes the invocation snapshot when a menu command is dispatched', async () => {
    const runPluginCommand = vi.fn().mockResolvedValue({
      ok: true,
      executed: true,
    });
    const pluginApi = { runPluginCommand } as never;
    const context = createContext();

    await runPluginMenuCommand(pluginApi, 'library-a', {
      id: 'com.example.menu.menu.asset.run',
      contributionId: 'com.example.menu.library-a.menu.asset.run',
    }, {
      assetIds: ['asset-1'],
      contributionContext: context,
    });

    expect(runPluginCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'plugin-manager.run-command',
      libraryId: 'library-a',
      contributionId: 'com.example.menu.library-a.menu.asset.run',
      assetIds: ['asset-1'],
      invocation: expect.objectContaining({
        contextId: 'context-1',
        revision: 1,
        libraryId: 'library-a',
        selection: expect.objectContaining({
          refs: ['asset-1'],
          assetIds: ['asset-1'],
        }),
      }),
    }));
  });
});
