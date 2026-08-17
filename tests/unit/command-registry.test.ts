import { describe, expect, it } from 'vitest';

import { createCommandRegistry } from '../../src/renderer/commands/command-registry';
import {
  formatShortcut,
  GROUP_ORDER,
} from '../../src/renderer/commands/command-types';
import type {
  CommandContext,
  CommandDefinition,
  ShortcutSpec,
} from '../../src/renderer/commands/command-types';

// REQ-COMMAND-001: 注册表是纯函数模块，node 环境直接测试，不挂载任何 DOM。

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    surface: 'asset-single',
    platform: 'mac',
    locale: 'zh-CN',
    selectedAssetIds: ['asset-1'],
    primaryAssetId: 'asset-1',
    assetScope: 'all',
    trashMode: false,
    ...overrides,
  };
}

function makeCommand(
  overrides: Partial<CommandDefinition> & { id: string },
): CommandDefinition {
  return {
    title: overrides.id,
    group: 'organize',
    run: () => undefined,
    ...overrides,
  };
}

describe('createCommandRegistry (REQ-COMMAND-001)', () => {
  it('rejects duplicate command ids and names the id', () => {
    const first = makeCommand({ id: 'asset.open', group: 'open' });
    const second = makeCommand({ id: 'asset.open', title: '重复定义' });
    expect(() => createCommandRegistry([first, second])).toThrowError(
      /asset\.open/,
    );
  });

  it('exposes definitions through get and list', () => {
    const open = makeCommand({ id: 'asset.open', group: 'open' });
    const registry = createCommandRegistry([open]);
    expect(registry.get('asset.open')).toBe(open);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.list()).toEqual([open]);
  });

  it('resolves an empty menu from an empty registry', () => {
    const registry = createCommandRegistry([]);
    expect(registry.list()).toEqual([]);
    expect(registry.resolveMenu(makeContext())).toEqual([]);
  });
});

describe('resolveMenu visibility and titles', () => {
  it('keeps commands visible by default and drops visible: () => false', () => {
    const registry = createCommandRegistry([
      makeCommand({ id: 'shown' }),
      makeCommand({ id: 'hidden', visible: () => false }),
    ]);
    const ids = registry.resolveMenu(makeContext()).map((item) => item.id);
    expect(ids).toEqual(['shown']);
  });

  it('evaluates visible against the context snapshot', () => {
    const registry = createCommandRegistry([
      makeCommand({ id: 'restore', visible: (ctx) => ctx.trashMode }),
    ]);
    expect(
      registry.resolveMenu(makeContext({ trashMode: true })),
    ).toHaveLength(1);
    expect(
      registry.resolveMenu(makeContext({ trashMode: false })),
    ).toHaveLength(0);
  });

  it('keeps string titles verbatim and resolves title functions with ctx', () => {
    const registry = createCommandRegistry([
      makeCommand({ id: 'static', title: '打开' }),
      makeCommand({
        id: 'dynamic',
        title: (ctx) => `移动 ${ctx.selectedAssetIds.length} 项`,
      }),
    ]);
    const menu = registry.resolveMenu(
      makeContext({ selectedAssetIds: ['a', 'b', 'c'] }),
    );
    expect(menu[0]?.label).toBe('打开');
    expect(menu[1]?.label).toBe('移动 3 项');
  });
});

describe('shortcut labels', () => {
  it('formats per platform and returns null when the platform has no label', () => {
    const trash: ShortcutSpec = {
      mac: { label: '⌘⌫', key: 'Backspace', metaKey: true },
      windows: { label: 'Delete', key: 'Delete' },
    };
    expect(formatShortcut(trash, 'mac')).toBe('⌘⌫');
    expect(formatShortcut(trash, 'windows')).toBe('Delete');
    expect(
      formatShortcut(
        { mac: { label: '⌘O', key: 'o', metaKey: true } },
        'windows',
      ),
    ).toBeNull();
    expect(
      formatShortcut(
        { windows: { label: 'Ctrl+O', key: 'o', ctrlKey: true } },
        'mac',
      ),
    ).toBeNull();
  });

  it('resolves shortcutLabel for the context platform', () => {
    const registry = createCommandRegistry([
      makeCommand({
        id: 'open-external',
        group: 'open',
        shortcut: {
          mac: { label: '⌘O', key: 'o', metaKey: true },
          windows: { label: 'Ctrl+O', key: 'o', ctrlKey: true },
        },
      }),
      makeCommand({
        id: 'mac-only',
        group: 'open',
        shortcut: { mac: { label: '⌘⇧O', key: 'o', metaKey: true } },
      }),
      makeCommand({ id: 'no-shortcut', group: 'open' }),
    ]);
    const mac = registry.resolveMenu(makeContext({ platform: 'mac' }));
    expect(mac.map((item) => item.shortcutLabel)).toEqual(['⌘O', '⌘⇧O', null]);
    const windows = registry.resolveMenu(makeContext({ platform: 'windows' }));
    expect(windows.map((item) => item.shortcutLabel)).toEqual([
      'Ctrl+O',
      null,
      null,
    ]);
  });
});

describe('disabled state', () => {
  it('passes the disabled reason through and defaults to enabled', () => {
    const registry = createCommandRegistry([
      makeCommand({ id: 'blocked', disabledReason: () => '仅本地资产可用' }),
      makeCommand({ id: 'enabled', disabledReason: () => null }),
      makeCommand({ id: 'unset' }),
    ]);
    const menu = registry.resolveMenu(makeContext());
    expect(menu[0]).toMatchObject({
      disabled: true,
      disabledReason: '仅本地资产可用',
    });
    expect(menu[1]).toMatchObject({ disabled: false, disabledReason: null });
    expect(menu[2]).toMatchObject({ disabled: false, disabledReason: null });
  });
});

describe('group ordering', () => {
  it('pins the canonical baseline order', () => {
    expect(GROUP_ORDER).toEqual(['open', 'organize', 'metadata', 'delete']);
  });

  it('sorts by GROUP_ORDER then keeps registration order within a group', () => {
    const registry = createCommandRegistry([
      makeCommand({ id: 'meta-1', group: 'metadata' }),
      makeCommand({ id: 'delete-1', group: 'delete' }),
      makeCommand({ id: 'organize-1', group: 'organize' }),
      makeCommand({ id: 'open-1', group: 'open' }),
      makeCommand({ id: 'organize-2', group: 'organize' }),
      makeCommand({ id: 'open-2', group: 'open' }),
    ]);
    const menu = registry.resolveMenu(makeContext());
    expect(menu.map((item) => item.id)).toEqual([
      'open-1',
      'open-2',
      'organize-1',
      'organize-2',
      'meta-1',
      'delete-1',
    ]);
    expect(menu.map((item) => item.group)).toEqual([
      'open',
      'open',
      'organize',
      'organize',
      'metadata',
      'delete',
    ]);
  });
});
