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
  /**
   * Optional Shift. When omitted, Shift must be up (legacy asset chords).
   * When true, Shift must be down (e.g. folder create ⌘⇧N / Ctrl+Shift+N).
   */
  readonly shiftKey?: boolean;
  /**
   * Optional Alt/Option. When omitted, Alt must be up. Used for mac
   * ⌥⌘Delete (delete-from-disk) and other platform-native chords.
   */
  readonly altKey?: boolean;
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
  /** Physical key (KeyboardEvent.code); used when `key` is missing or IME-noisy. */
  readonly code?: string;
  /** Legacy keyCode; Windows IME / Electron before-input sometimes omit `code`. */
  readonly keyCode?: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** DOM / Electron legacy keyCode for named and function keys (VIEWER-018 parity). */
const SHORTCUT_KEY_CODE: Readonly<Record<string, number>> = {
  backspace: 8,
  tab: 9,
  enter: 13,
  escape: 27,
  space: 32,
  delete: 46,
  f1: 112,
  f2: 113,
  f3: 114,
  f4: 115,
  f5: 116,
  f6: 117,
  f7: 118,
  f8: 119,
  f9: 120,
  f10: 121,
  f11: 122,
  f12: 123,
};

function shortcutEventMatchesChordKey(
  chordKey: string,
  event: ShortcutEvent,
): boolean {
  const expected = chordKey.toLowerCase();
  const key = event.key.toLowerCase();
  if (key.length > 0 && key !== 'process' && key === expected) return true;
  if (expected === 'delete' && key === 'del') return true;

  const code = event.code?.toLowerCase();
  if (code !== undefined && code.length > 0) {
    if (code === expected) return true;
    // Letter chords store 'o'; physical code is 'KeyO'.
    if (expected === 'delete' && (key === 'del' || code === 'del')) return true;
    if (expected.length === 1 && code === `key${expected}`) return true;
    // Numpad operators may report Add/Subtract while chord uses =/-.
    if (expected === '=' && code === 'equal') return true;
    if (expected === '+' && (code === 'equal' || code === 'add')) return true;
    if (expected === '-' && (code === 'minus' || code === 'subtract')) return true;
    if (expected === '0' && code === 'digit0') return true;
  }

  const keyCode = event.keyCode;
  if (keyCode !== undefined && keyCode !== 0) {
    const named = SHORTCUT_KEY_CODE[expected];
    if (named !== undefined && keyCode === named) return true;
    // A–Z / 0–9 when chord is a single character.
    if (expected.length === 1) {
      const upper = expected.toUpperCase();
      if (upper >= 'A' && upper <= 'Z' && keyCode === upper.charCodeAt(0)) {
        return true;
      }
      if (expected >= '0' && expected <= '9' && keyCode === expected.charCodeAt(0)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 事件是否命中当前平台的快捷键和弦。语义逐条移植自
 * 0015-B 的 matchesAssetCommandShortcut，并扩展可选 Shift：
 * - Alt 精确匹配：和弦未声明 altKey 时要求松开；声明 altKey: true 时要求按下；
 * - Shift 精确匹配：和弦未声明 shiftKey 时要求松开（旧资产快捷键），
 *   声明 shiftKey: true 时要求按下（文件夹新建 ⌘⇧N / Ctrl+Shift+N）；
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
  const chord = platform === 'mac' ? spec.mac : spec.windows;
  if (chord === undefined) return false;
  if (event.altKey !== (chord.altKey ?? false)) return false;
  if (event.metaKey !== (chord.metaKey ?? false)) return false;
  if (event.ctrlKey !== (chord.ctrlKey ?? false)) return false;
  if (event.shiftKey !== (chord.shiftKey ?? false)) return false;
  return shortcutEventMatchesChordKey(chord.key, event);
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

/**
 * 界面语言。与 i18n AppLocale 对齐，但本模块不 import i18n，避免命令纯函数
 * 层与 React/catalog 形成环依赖；消费方传入 'zh-CN' | 'en'。
 */
export type CommandLocale = 'zh-CN' | 'en';

/** 应用侧填充的只读上下文快照；保持最小集，后续轨道按需扩展字段。 */
export interface CommandContext {
  readonly surface: CommandSurface;
  readonly platform: CommandPlatform;
  /** 当前界面语言；title / disabledReason 经 translateForLocale 解析。 */
  readonly locale: CommandLocale;
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
