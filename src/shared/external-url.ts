import { z } from 'zod';

import type { ShowEditContextMenuResult } from './edit-context-menu';

/**
 * 「在系统浏览器中打开外部链接」的共享规则与类型。
 *
 * 口径与检查器「源链接 (URL)」保存校验一致：仅允许不含账号密码的
 * HTTP(S) 完整链接。渲染进程用它决定跳转按钮的可用态，主进程用它在
 * shell.openExternal 之前做最后一道防线（Renderer 不可信）。
 *
 * IPC 结果用公开错误码回传，避免把 unauthorized / malformed / rejected /
 * shell failure 压成 boolean；日志侧只记 code，不写敏感 URL。
 */

const OPENABLE_PROTOCOLS = new Set(['http:', 'https:']);

export function toOpenableExternalUrl(raw: string): string | null {
  if (raw === '' || raw !== raw.trim()) return null;
  try {
    const parsed = new URL(raw);
    if (!OPENABLE_PROTOCOLS.has(parsed.protocol)) return null;
    if (parsed.username !== '' || parsed.password !== '') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const openExternalUrlRequestSchema = z.object({
  url: z.string().min(1).max(2048),
});

export function parseOpenExternalUrlRequest(input: unknown): { url: string } | null {
  const parsed = openExternalUrlRequestSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const OPEN_EXTERNAL_URL_ERROR_CODES = [
  'unauthorized_sender',
  'malformed_request',
  'rejected_url',
  'shell_failure',
] as const;

export type OpenExternalUrlErrorCode = (typeof OPEN_EXTERNAL_URL_ERROR_CODES)[number];

export type OpenExternalUrlResult =
  | { ok: true }
  | { ok: false; code: OpenExternalUrlErrorCode };

const openExternalUrlResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    code: z.enum(OPEN_EXTERNAL_URL_ERROR_CODES),
  }),
]);

export function parseOpenExternalUrlResult(input: unknown): OpenExternalUrlResult {
  const parsed = openExternalUrlResultSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  // 旧 boolean 桥或损坏响应：不得当成成功。
  if (input === true) return { ok: true };
  if (input === false) return { ok: false, code: 'shell_failure' };
  return { ok: false, code: 'shell_failure' };
}

/**
 * 主进程在调用 shell.openExternal 之前的纯校验。
 * 不含 sender 授权与 shell 调用，便于单测覆盖失败路径。
 */
export function resolveOpenExternalUrlTarget(
  input: unknown,
): { ok: true; url: string } | { ok: false; code: 'malformed_request' | 'rejected_url' } {
  const request = parseOpenExternalUrlRequest(input);
  if (!request) return { ok: false, code: 'malformed_request' };
  const url = toOpenableExternalUrl(request.url);
  if (!url) return { ok: false, code: 'rejected_url' };
  return { ok: true, url };
}

export type ShellSwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface SerpentShellApi {
  /** 打开外部 HTTP(S) 链接；失败时返回公开错误码（不含 URL）。 */
  openExternalUrl(url: string): Promise<OpenExternalUrlResult>;
  /**
   * 在文本输入控件上弹出平台原生编辑菜单（撤销/剪切/复制/粘贴/删除/全选）。
   * 仅传屏幕坐标；菜单项启用态由 Main 侧 Electron role 根据焦点控件计算。
   */
  showEditContextMenu(point: {
    x: number;
    y: number;
  }): Promise<ShowEditContextMenuResult>;
  /** macOS 触控板三指轻扫（Electron webContents swipe）。 */
  onSwipe(listener: (direction: ShellSwipeDirection) => void): () => void;
}
