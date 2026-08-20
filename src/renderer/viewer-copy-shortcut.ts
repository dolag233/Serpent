/**
 * Viewer Ctrl/Cmd+C copy decision (Serpent-f8e175).
 *
 * 查看器聚焦时 Ctrl/Cmd+C 复制当前资产（与右键「复制」一致）。判定规则：
 * - 文本查看器让渡给原生（用户的期望是复制选中文本，不拦截）。
 * - 输入框/可编辑元素聚焦时不抢键。
 * - 其余情况（图片/视频/PDF/音频等查看器）拦截并触发复制。
 *
 * 独立成纯函数以便完整单测。
 */
export interface CopyShortcutContext {
  /** 文本查看器（text media type）激活中。 */
  isTextViewer: boolean;
  /** Ctrl 或 Cmd 按下。 */
  metaOrCtrl: boolean;
  /** 键值（不区分大小写比较，如 "c"/"C"）。 */
  key: string;
  /** 事件目标元素标签名的大写形式（INPUT/TEXTAREA/SELECT/...），无则 null。 */
  targetTag: string | null;
  /** 事件目标是否 contentEditable。 */
  contentEditable: boolean;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function shouldCopyAssetOnShortcut(
  context: CopyShortcutContext,
): boolean {
  if (context.isTextViewer) return false;
  if (!context.metaOrCtrl || context.key.toLowerCase() !== "c") return false;
  if (
    context.contentEditable ||
    (context.targetTag !== null && EDITABLE_TAGS.has(context.targetTag))
  ) {
    return false;
  }
  return true;
}