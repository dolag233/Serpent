// ---------------------------------------------------------------------------
// 统一命令注册表核心类型（REQ-COMMAND-001，切片 0015-A）
//
// 纯类型与纯函数：不依赖 React / Electron / DOM，可在 node 环境直接测试。
// 后续轨道用同一份 CommandDefinition 驱动右键菜单、键盘快捷键和工具栏。
// ---------------------------------------------------------------------------

/** 右键菜单语义基线的四个分组（mvp-ui-ux-requirements-backlog.md「右键菜单语义基线」）。 */
export type CommandGroup = 'open' | 'organize' | 'metadata' | 'delete';

/** 分组规范顺序：打开 → 剪贴板与组织 → 元数据 → 删除（破坏性操作恒在最后）。 */
export const GROUP_ORDER: readonly CommandGroup[] = [
  'open',
  'organize',
  'metadata',
  'delete',
];

export type CommandPlatform = 'mac' | 'windows';

/**
 * 各平台的快捷键显示标签（如 '⌘⌫' / 'Ctrl+O'）。
 * 用联合类型而非双可选字段，在编译期强制至少声明一个平台的标签。
 */
export type ShortcutSpec =
  | { readonly mac: string; readonly windows?: string }
  | { readonly mac?: string; readonly windows: string };

/**
 * 取当前平台的显示标签；该平台未声明时返回 null。
 * 刻意不做跨平台回退：Windows 菜单上显示 mac 的 '⌘' 符号属于错误展示。
 */
export function formatShortcut(
  spec: ShortcutSpec,
  platform: CommandPlatform,
): string | null {
  const label = platform === 'mac' ? spec.mac : spec.windows;
  return label ?? null;
}

/** 命令可出现的界面位置；后续新增位置时扩展此联合即可。 */
export type CommandSurface =
  | 'asset-single'
  | 'asset-multi'
  | 'folder'
  | 'sidebar'
  | 'canvas';

/** 应用侧填充的只读上下文快照；保持最小集，后续轨道按需扩展字段。 */
export interface CommandContext {
  readonly surface: CommandSurface;
  readonly platform: CommandPlatform;
  readonly selectedAssetIds: readonly string[];
  readonly primaryAssetId: string | null;
  readonly assetScope: string;
  readonly trashMode: boolean;
}

export interface CommandDefinition<C extends CommandContext = CommandContext> {
  readonly id: string;
  readonly title: string | ((ctx: C) => string);
  readonly group: CommandGroup;
  readonly shortcut?: ShortcutSpec;
  readonly visible?: (ctx: C) => boolean;
  readonly disabledReason?: (ctx: C) => string | null;
  readonly run: (ctx: C) => void | Promise<void>;
}

/** 菜单直接消费的解析结果：title/visible/disabled 等函数均已求值为纯数据。 */
export interface ResolvedMenuItem {
  readonly id: string;
  readonly label: string;
  readonly group: CommandGroup;
  readonly shortcutLabel: string | null;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
}
