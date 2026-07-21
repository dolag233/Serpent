import { describe, expect, it } from 'vitest';

import {
  formatShortcut,
  isMacPlatform,
  matchesShortcut,
  type ShortcutEvent,
  type ShortcutSpec,
} from '../../src/renderer/commands/command-types';
import { assetCommandDefinitions } from '../../src/renderer/commands/asset-commands';
import { assetMultiCommandDefinitions } from '../../src/renderer/commands/asset-multi-commands';

// REQ-COMMAND-002：快捷键的展示标签与事件匹配共用注册表中的同一份
// ShortcutSpec。本文件锁定 matchesShortcut 的语义（逐条移植自 0015-B 的
// matchesAssetCommandShortcut），并断言三条真实命令定义的标签与匹配
// 行为不漂移。

const event = (overrides: Partial<ShortcutEvent>): ShortcutEvent => ({
  key: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

const OPEN_EXTERNAL: ShortcutSpec = {
  mac: { label: '⌘O', key: 'o', metaKey: true },
  windows: { label: 'Ctrl+O', key: 'o', ctrlKey: true },
};

const MOVE_TO_TRASH: ShortcutSpec = {
  mac: { label: '⌘⌫', key: 'Backspace', metaKey: true },
  windows: { label: 'Delete', key: 'Delete' },
};

describe('matchesShortcut 修饰键语义（移植自旧匹配器）', () => {
  it('mac ⌘O 命中 meta+o，且字符键大小写不敏感', () => {
    expect(
      matchesShortcut(OPEN_EXTERNAL, event({ key: 'o', metaKey: true }), 'mac'),
    ).toBe(true);
    expect(
      matchesShortcut(OPEN_EXTERNAL, event({ key: 'O', metaKey: true }), 'mac'),
    ).toBe(true);
  });

  it('mac 平台拒绝 ctrl 变体与裸按键', () => {
    // 旧逻辑：expectedModifier=meta 必须按下，unexpectedModifier=ctrl 必须松开。
    expect(
      matchesShortcut(OPEN_EXTERNAL, event({ key: 'o', ctrlKey: true }), 'mac'),
    ).toBe(false);
    expect(
      matchesShortcut(
        OPEN_EXTERNAL,
        event({ key: 'o', metaKey: true, ctrlKey: true }),
        'mac',
      ),
    ).toBe(false);
    expect(matchesShortcut(OPEN_EXTERNAL, event({ key: 'o' }), 'mac')).toBe(
      false,
    );
  });

  it('windows Ctrl+O 命中 ctrl+o，拒绝 meta 变体', () => {
    expect(
      matchesShortcut(
        OPEN_EXTERNAL,
        event({ key: 'o', ctrlKey: true }),
        'windows',
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        OPEN_EXTERNAL,
        event({ key: 'O', ctrlKey: true }),
        'windows',
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        OPEN_EXTERNAL,
        event({ key: 'o', metaKey: true }),
        'windows',
      ),
    ).toBe(false);
  });

  it('Alt 按下时一律拒绝；未声明 Shift 的和弦拒绝 Shift 变体', () => {
    expect(
      matchesShortcut(
        OPEN_EXTERNAL,
        event({ key: 'o', metaKey: true, altKey: true }),
        'mac',
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        OPEN_EXTERNAL,
        event({ key: 'o', metaKey: true, shiftKey: true }),
        'mac',
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        MOVE_TO_TRASH,
        event({ key: 'Delete', shiftKey: true }),
        'windows',
      ),
    ).toBe(false);
  });

  it('声明 shiftKey 的和弦要求 Shift 按下（文件夹新建）', () => {
    const createFolder: ShortcutSpec = {
      mac: { label: '⌘⇧N', key: 'n', metaKey: true, shiftKey: true },
      windows: {
        label: 'Ctrl+Shift+N',
        key: 'n',
        ctrlKey: true,
        shiftKey: true,
      },
    };
    expect(
      matchesShortcut(
        createFolder,
        event({ key: 'n', metaKey: true, shiftKey: true }),
        'mac',
      ),
    ).toBe(true);
    expect(
      matchesShortcut(
        createFolder,
        event({ key: 'n', metaKey: true }),
        'mac',
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        createFolder,
        event({ key: 'n', ctrlKey: true, shiftKey: true }),
        'windows',
      ),
    ).toBe(true);
  });

  it('mac ⌘⌫ 是 meta+Backspace，windows Delete 是无修饰键 Delete', () => {
    // 旧逻辑 mac 分支：metaKey && !ctrlKey && key === 'Backspace'。
    expect(
      matchesShortcut(
        MOVE_TO_TRASH,
        event({ key: 'Backspace', metaKey: true }),
        'mac',
      ),
    ).toBe(true);
    expect(
      matchesShortcut(MOVE_TO_TRASH, event({ key: 'Backspace' }), 'mac'),
    ).toBe(false);
    expect(
      matchesShortcut(
        MOVE_TO_TRASH,
        event({ key: 'Backspace', metaKey: true, ctrlKey: true }),
        'mac',
      ),
    ).toBe(false);
    // 旧逻辑 windows 分支：!metaKey && !ctrlKey && key === 'Delete'。
    expect(
      matchesShortcut(MOVE_TO_TRASH, event({ key: 'Delete' }), 'windows'),
    ).toBe(true);
    expect(
      matchesShortcut(
        MOVE_TO_TRASH,
        event({ key: 'Delete', ctrlKey: true }),
        'windows',
      ),
    ).toBe(false);
    expect(
      matchesShortcut(
        MOVE_TO_TRASH,
        event({ key: 'Delete', metaKey: true }),
        'windows',
      ),
    ).toBe(false);
    // 跨平台不串键：mac 的 Backspace 不命中 windows 定义，反之亦然。
    expect(
      matchesShortcut(MOVE_TO_TRASH, event({ key: 'Backspace' }), 'windows'),
    ).toBe(false);
    expect(
      matchesShortcut(MOVE_TO_TRASH, event({ key: 'Delete' }), 'mac'),
    ).toBe(false);
  });

  it('当前平台未声明和弦时不匹配（与 formatShortcut 返回 null 对齐）', () => {
    const macOnly: ShortcutSpec = {
      mac: { label: '⌘O', key: 'o', metaKey: true },
    };
    expect(
      matchesShortcut(macOnly, event({ key: 'o', metaKey: true }), 'windows'),
    ).toBe(false);
    expect(formatShortcut(macOnly, 'windows')).toBeNull();
  });
});

describe('注册表定义：标签与匹配同源（REQ-COMMAND-002 不漂移）', () => {
  const defs = [...assetCommandDefinitions, ...assetMultiCommandDefinitions];
  const specOf = (id: string): ShortcutSpec => {
    const spec = defs.find((def) => def.id === id)?.shortcut;
    if (spec === undefined) throw new Error(`${id} 缺少 shortcut 定义`);
    return spec;
  };

  it('asset.open-external：⌘O / Ctrl+O 标签与按键同源', () => {
    const spec = specOf('asset.open-external');
    expect(formatShortcut(spec, 'mac')).toBe('⌘O');
    expect(formatShortcut(spec, 'windows')).toBe('Ctrl+O');
    expect(
      matchesShortcut(spec, event({ key: 'o', metaKey: true }), 'mac'),
    ).toBe(true);
    expect(
      matchesShortcut(spec, event({ key: 'o', ctrlKey: true }), 'windows'),
    ).toBe(true);
  });

  it('asset.rename：F2 标签与按键同源', () => {
    const spec = specOf('asset.rename');
    expect(formatShortcut(spec, 'mac')).toBe('F2');
    expect(formatShortcut(spec, 'windows')).toBe('F2');
    expect(matchesShortcut(spec, event({ key: 'F2' }), 'mac')).toBe(true);
    expect(matchesShortcut(spec, event({ key: 'F2' }), 'windows')).toBe(true);
    expect(
      matchesShortcut(spec, event({ key: 'F2', metaKey: true }), 'mac'),
    ).toBe(false);
  });
});

describe('isMacPlatform（从旧模块迁入 command-types）', () => {
  it('识别桌面 macOS，且不把移动端 UA 当作 macOS', () => {
    expect(isMacPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe(true);
    expect(isMacPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS) Mobile')).toBe(
      false,
    );
  });
});
