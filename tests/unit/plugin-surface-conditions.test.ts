import { describe, expect, it } from 'vitest';

import { createPluginContributionContext } from '../../src/plugins/plugin-context';
import { buildPluginInspectorSectionDescriptors } from '../../src/renderer/plugin-inspector-sections';
import { buildPluginShortcutDescriptors } from '../../src/renderer/plugin-shortcut-contributions';
import { buildPluginToolbarDescriptors } from '../../src/renderer/plugin-toolbar-contributions';
import { buildPluginViewerActionDescriptors } from '../../src/renderer/plugin-viewer-actions';

function context() {
  return createPluginContributionContext({
    contextId: 'surface-context',
    revision: 1,
    app: { platform: 'darwin', locale: 'zh-CN', theme: 'dark', busy: false },
    surface: { id: 'workspace', kind: 'toolbar' },
    window: { windowId: 'window-1' },
    library: { id: 'library-a', open: true, writable: false, offline: false },
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
    viewer: { active: true, assetId: 'asset-1', fullscreen: false },
  });
}

const conditions = {
  when: 'selection.assetCount == 1',
  enablement: 'library.writable',
  checked: 'app.busy',
};

describe('plugin command-backed surface conditions', () => {
  it('filters hidden toolbar actions and disables actions whose command is not enabled', () => {
    const descriptors = buildPluginToolbarDescriptors([
      {
        kind: 'toolbar', id: 'visible', title: 'Visible', commandId: 'visible', pluginId: 'plugin', ...conditions,
      },
      {
        kind: 'toolbar', id: 'hidden', title: 'Hidden', commandId: 'hidden', pluginId: 'plugin', when: 'selection.assetCount == 2',
      },
    ], context());

    expect(descriptors).toEqual([expect.objectContaining({ id: 'visible', disabled: true })]);
  });

  it('applies the same condition semantics to Inspector, Viewer and shortcut actions', () => {
    const current = context();
    expect(buildPluginInspectorSectionDescriptors([{
      kind: 'inspector-section', id: 'inspector', title: 'Inspector', commandTitle: 'Run', commandId: 'run', pluginId: 'plugin', ...conditions,
    }], current)[0]).toMatchObject({ disabled: true });
    expect(buildPluginViewerActionDescriptors([{
      kind: 'viewer-action', id: 'viewer', title: 'Viewer', commandId: 'run', pluginId: 'plugin', ...conditions,
    }], current)[0]).toMatchObject({ disabled: true });
    expect(buildPluginShortcutDescriptors([{
      kind: 'shortcut', id: 'shortcut', title: 'Shortcut', commandId: 'run', pluginId: 'plugin', accelerator: 'F9', ...conditions,
    }], current)[0]).toMatchObject({ disabled: true });
  });
});
