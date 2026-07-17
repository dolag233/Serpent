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
 * 单个平台的快捷键和弦：label 服务菜单展示，key/修饰键服务事件匹配。
 * 同一份定义同时驱动显示与匹配，按键与菜单文案不会漂移
 * （REQ-COMMAND-002；替代 0015-B 的 asset-command-shortcuts.ts 双份定义）。
 *
 * 修饰键语义为精确匹配：声明为 true 的必须按下，未声明的必须松开。
 * 因此 mac 的 ⌘O 不会命中 Ctrl+O，Windows 的 Delete 不会命中 Ctrl+Delete。
 * Alt/Shift 变体一律不匹配（沿用旧匹配器语义），故和弦不声明 alt/shift 字段。
 */
export interface ShortcutChord {
  /** 菜单展示标签，如 '⌘O' / 'Ctrl+O' / '⌘⌫' / 'Delete'。 */
  readonly label: string;
  /**
   * KeyboardEvent.key 的期望值。匹配对字符键大小写不敏感
   * （沿用旧匹配器 key.toLowerCase() 语义）；'Backspace'/'Delete'
   * 等命名键照标准大小写书写即可。
   */
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
}

/**
 * 各平台的快捷键定义（展示 + 匹配一体）。
 * 用联合类型而非双可选字段，在编译期强制至少声明一个平台的和弦。
 */
export type ShortcutSpec =
  | { readonly mac: ShortcutChord; readonly windows?: ShortcutChord }
  | { readonly mac?: ShortcutChord; readonly windows: ShortcutChord };

/**
 * 取当前平台的显示标签；该平台未声明时返回 null。
 * 刻意不做跨平台回退：Windows 菜单上显示 mac 的 '⌘' 符号属于错误展示。
 */
export function formatShortcut(
  spec: ShortcutSpec,
  platform: CommandPlatform,
): string | null {
  const chord = platform === 'mac' ? spec.mac : spec.windows;
  return chord?.label ?? null;
}

/** 键盘事件的最小结构；DOM KeyboardEvent 在结构上与之兼容。 */
export interface ShortcutEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * 事件是否命中当前平台的快捷键和弦。语义逐条移植自
 * 0015-B 的 matchesAssetCommandShortcut：
 * - Alt 或 Shift 按下时一律拒绝（旧逻辑首行即 return false）；
 * - meta/ctrl 精确匹配：mac 和弦声明 metaKey 时要求 meta 按下且 ctrl 松开，
 *   windows Delete 这类无修饰键和弦要求两个修饰键都松开；
 * - key 比较大小写不敏感（旧逻辑对 'o' 用 toLowerCase()；对命名键
 *   'Backspace'/'Delete' 浏览器只会报标准大小写，此处一视同仁）。
 * 当前平台未声明和弦时返回 false（与 formatShortcut 返回 null 对齐）。
 */
export function matchesShortcut(
  spec: ShortcutSpec,
  event: ShortcutEvent,
  platform: CommandPlatform,
): boolean {
  if (event.altKey || event.shiftKey) return false;
  const chord = platform === 'mac' ? spec.mac : spec.windows;
  if (chord === undefined) return false;
  if (event.metaKey !== (chord.metaKey ?? false)) return false;
  if (event.ctrlKey !== (chord.ctrlKey ?? false)) return false;
  return event.key.toLowerCase() === chord.key.toLowerCase();
}

/**
 * 从 userAgent 判定桌面 macOS（排除 iPhone/iPad 等 Mobile UA）。
 * 从 0015-B 的 asset-command-shortcuts.ts 迁入，供渲染层统一获取平台。
 */
export function isMacPlatform(userAgent: string): boolean {
  return userAgent.includes('Mac') && !userAgent.includes('Mobile');
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
