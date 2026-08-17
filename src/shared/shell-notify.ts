import { z } from 'zod';

/** Main → Renderer user-visible notice from scripts / MCP / plugins. */
export const shellNotifyPayloadSchema = z.strictObject({
  severity: z.enum(['info', 'warning', 'error']),
  mode: z.enum(['toast', 'dialog']),
  message: z.string().min(1).max(500),
  title: z.string().min(1).max(120).optional(),
});
export type ShellNotifyPayload = z.infer<typeof shellNotifyPayloadSchema>;

const FORBIDDEN_TITLE = /严重|致命|critical|fatal/iu;

/** Calm default dialog titles (0004); never use alarming wording. */
export function defaultShellNotifyDialogTitle(severity: ShellNotifyPayload['severity']): string {
  switch (severity) {
    case 'info':
      return 'Notice';
    case 'warning':
      return 'Warning';
    case 'error':
      return "Couldn't complete the action";
  }
}

export function sanitizeShellNotifyTitle(
  title: string | undefined,
  severity: ShellNotifyPayload['severity'],
): string {
  const trimmed = title?.trim();
  if (trimmed === undefined || trimmed.length === 0 || FORBIDDEN_TITLE.test(trimmed)) {
    return defaultShellNotifyDialogTitle(severity);
  }
  return trimmed.slice(0, 120);
}
