import { z } from "zod";

/**
 * Frameless Windows caption controls (Serpent-znex).
 *
 * Renderer draws min / max-restore / close; Main owns BrowserWindow actions.
 * Requests are typed actions; maximize state is returned and pushed as events.
 */

export const WINDOW_CONTROL_ACTIONS = [
  "minimize",
  "maximize-toggle",
  "close",
  "get-state",
] as const;

export type WindowControlAction = (typeof WINDOW_CONTROL_ACTIONS)[number];

const windowControlRequestSchema = z.object({
  action: z.enum(WINDOW_CONTROL_ACTIONS),
});

export type WindowControlRequest = z.infer<typeof windowControlRequestSchema>;

export const WINDOW_CONTROL_ERROR_CODES = [
  "unauthorized_sender",
  "malformed_request",
  "no_window",
] as const;

export type WindowControlErrorCode =
  (typeof WINDOW_CONTROL_ERROR_CODES)[number];

export type WindowControlResult =
  | { ok: true; maximized: boolean }
  | { ok: false; code: WindowControlErrorCode };

export type WindowMaximizedStateEvent = {
  type: "shell.window.maximized";
  maximized: boolean;
};

const windowControlResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    maximized: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(WINDOW_CONTROL_ERROR_CODES),
  }),
]);

const windowMaximizedStateEventSchema = z.object({
  type: z.literal("shell.window.maximized"),
  maximized: z.boolean(),
});

export function parseWindowControlRequest(
  input: unknown,
): WindowControlRequest | null {
  const parsed = windowControlRequestSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseWindowControlResult(
  input: unknown,
): WindowControlResult {
  const parsed = windowControlResultSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  return { ok: false, code: "malformed_request" };
}

export function parseWindowMaximizedStateEvent(
  input: unknown,
): WindowMaximizedStateEvent | null {
  const parsed = windowMaximizedStateEventSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Windows hides the menu bar for frameless shell unity (Serpent-znex). */
export function shouldHideApplicationMenuBar(
  platform: NodeJS.Platform,
): boolean {
  return platform === "win32";
}

/** Windows uses a hidden title bar with in-app caption buttons. */
export function shouldUseFramelessTitleBar(
  platform: NodeJS.Platform,
): boolean {
  return platform === "win32";
}

/** Windows' custom close caption hides the window and leaves the app in the tray. */
export function shouldHideWindowOnClose(
  platform: NodeJS.Platform,
): boolean {
  return platform === "win32";
}
