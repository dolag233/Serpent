/**
 * Push the effective Renderer locale to Main for native dialogs (Serpent-bwb).
 * Fire-and-forget; Main validates with Zod and ignores unauthorized senders.
 */

import type { AppLocale } from "./types";

type ShellWithLocale = {
  readonly setAppLocale?: (locale: AppLocale) => void;
};

export function syncAppLocaleToMain(locale: AppLocale): void {
  const shell = (
    globalThis as { serpent?: { shell?: ShellWithLocale } }
  ).serpent?.shell;
  shell?.setAppLocale?.(locale);
}
