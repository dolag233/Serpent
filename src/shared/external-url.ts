import { z } from 'zod';

/**
 * 「在系统浏览器中打开外部链接」的共享规则与类型。
 *
 * 口径与检查器「源链接 (URL)」保存校验一致：仅允许不含账号密码的
 * HTTP(S) 完整链接。渲染进程用它决定跳转按钮的可用态，主进程用它在
 * shell.openExternal 之前做最后一道防线（Renderer 不可信）。
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

export type ShellSwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface SerpentShellApi {
  /** 打开一个外部 HTTP(S) 链接；返回是否实际交给了系统浏览器。 */
  openExternalUrl(url: string): Promise<boolean>;
  /** macOS 触控板三指轻扫（Electron webContents swipe）。 */
  onSwipe(listener: (direction: ShellSwipeDirection) => void): () => void;
}
