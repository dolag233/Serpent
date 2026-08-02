import { describe, expect, it } from 'vitest';

import { buildPluginMenuDescriptors } from '../../src/renderer/plugin-menu-contributions';

describe('plugin menu contribution descriptors', () => {
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
      group: 'analysis',
      children: [{
        id: 'com.example.menu.menu.asset.processing.advanced',
        label: 'Advanced',
        contributionId: 'com.example.menu.menu.asset.processing.advanced',
        pluginId: 'com.example.menu',
        children: [{
          id: 'com.example.menu.menu.asset.processing.advanced.quality',
          label: 'Quality',
          contributionId: 'com.example.menu.menu.asset.processing.advanced.quality',
          commandId: 'probe.quality',
          pluginId: 'com.example.menu',
          children: [],
        }],
      }, {
        id: 'com.example.menu.menu.asset.processing.fast',
        label: 'Fast',
        contributionId: 'com.example.menu.menu.asset.processing.fast',
        commandId: 'probe.fast',
        pluginId: 'com.example.menu',
        before: 'asset.rename',
        children: [],
      }],
    }]);
  });
});
