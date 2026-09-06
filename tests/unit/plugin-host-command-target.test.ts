import { describe, expect, it } from 'vitest';

import {
  PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
  pluginHostCommandRequiresBoundLibrary,
  resolvePluginHostCommandLibraryId,
} from '../../src/plugins/plugin-host-command-target';
import { pluginDialogContributionMatches } from '../../src/shared/plugin-ui-dialog-bridge';

describe('plugin host command library targeting', () => {
  it('does not require a bound library for Main-owned dialog and binary commands', () => {
    expect(pluginHostCommandRequiresBoundLibrary('ui.dialog')).toBe(false);
    expect(pluginHostCommandRequiresBoundLibrary('ui.widget-patch')).toBe(false);
    expect(pluginHostCommandRequiresBoundLibrary('media.binaries.get')).toBe(false);
    expect(pluginHostCommandRequiresBoundLibrary('ui.notify')).toBe(false);
    expect(pluginHostCommandRequiresBoundLibrary('asset.list')).toBe(true);
  });

  it('lets a global plugin call ui.dialog without forLibrary()', () => {
    expect(resolvePluginHostCommandLibraryId({
      commandId: 'ui.dialog',
      libraryId: PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
    })).toEqual({ ok: true, libraryId: null });
    expect(resolvePluginHostCommandLibraryId({
      commandId: 'media.binaries.get',
      libraryId: PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
    })).toEqual({ ok: true, libraryId: null });
  });

  it('still requires forLibrary() for library-bound commands on a global plugin', () => {
    expect(resolvePluginHostCommandLibraryId({
      commandId: 'asset.list',
      libraryId: PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
    })).toEqual({
      ok: false,
      message: 'A global plugin must choose an open library with serpent.forLibrary().',
    });
  });

  it('keeps an explicit forLibrary() target on dialog commands', () => {
    expect(resolvePluginHostCommandLibraryId({
      commandId: 'ui.dialog',
      libraryId: PLUGIN_GLOBAL_RUNTIME_LIBRARY_ID,
      targetLibraryId: 'library-2',
    })).toEqual({ ok: true, libraryId: 'library-2' });
  });
});

describe('plugin dialog contribution matching', () => {
  const contribution = {
    id: 'com.example.plugin.library-a.compress',
    pluginId: 'com.example.plugin',
    pluginInstanceId: 'instance-1',
  };

  it('matches Manifest local ids and fully namespaced contribution ids', () => {
    expect(pluginDialogContributionMatches(contribution, {
      dialogId: 'compress',
      pluginId: 'com.example.plugin',
      pluginInstanceId: 'instance-1',
    })).toBe(true);
    expect(pluginDialogContributionMatches(contribution, {
      dialogId: contribution.id,
      pluginId: 'com.example.plugin',
      pluginInstanceId: 'instance-1',
    })).toBe(true);
  });

  it('rejects another plugin or another dialog id', () => {
    expect(pluginDialogContributionMatches(contribution, {
      dialogId: 'compress',
      pluginId: 'com.other.plugin',
      pluginInstanceId: 'instance-1',
    })).toBe(false);
    expect(pluginDialogContributionMatches(contribution, {
      dialogId: 'convert',
      pluginId: 'com.example.plugin',
      pluginInstanceId: 'instance-1',
    })).toBe(false);
  });
});
