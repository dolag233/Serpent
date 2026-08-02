import { describe, expect, it } from 'vitest';

import { buildPluginMenuDescriptors } from '../../src/renderer/plugin-menu-contributions';
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
        id: 'com.example.menu.menu.asset.processing.fast',
        label: 'Fast',
        contributionId: 'com.example.menu.menu.asset.processing.fast',
        commandId: 'probe.fast',
        pluginId: 'com.example.menu',
        disabled: false,
        before: 'asset.rename',
        shortcut: 'F9',
        children: [],
      }, {
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

    expect(descriptors.map((item) => item.id)).toEqual(['jpg-only', 'disabled', 'checked', 'advanced']);
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

    expect(descriptors.map((item) => item.id)).toEqual(['extension', 'mime', 'media-kind']);
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
});
