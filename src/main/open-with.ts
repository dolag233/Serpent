/**
 * Open a resolved absolute path with a non-default application (Serpent-w29).
 *
 * Renderer only sends asset/folder ids (REQ-COMMAND-003). Main receives the
 * Worker-resolved absolute path and:
 * - macOS: application picker dialog → `open -a <app> <path>`
 * - Windows: system "Open with" dialog via OpenAs_RunDLL
 *
 * Cancelled pickers are a quiet no-op (ok), not an error toast.
 */

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { BrowserWindow, OpenDialogOptions } from "electron";

import {
  resolveNativeDialogCopy,
  type AppLocale,
} from "../shared/native-dialog-i18n";

const execFile = promisify(execFileCallback);

export type OpenWithOutcome = "opened" | "cancelled" | "failed";

export type OpenWithPlatform = "darwin" | "win32" | "other";

export type OpenWithDeps = {
  readonly platform: OpenWithPlatform;
  readonly locale: AppLocale;
  readonly getParentWindow: () => BrowserWindow | null;
  readonly showOpenDialog: (
    parent: BrowserWindow | null,
    options: OpenDialogOptions,
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
  readonly execFile: (
    file: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
};

export function detectOpenWithPlatform(
  nodePlatform: NodeJS.Platform = process.platform,
): OpenWithPlatform {
  if (nodePlatform === "darwin") return "darwin";
  if (nodePlatform === "win32") return "win32";
  return "other";
}

export function createOpenWithDeps(
  locale: AppLocale,
  getParentWindow: () => BrowserWindow | null,
): OpenWithDeps {
  // Lazy-require electron so unit tests can inject deps without loading Electron.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require("electron") as {
    dialog: {
      showOpenDialog: (
        ...args:
          | [OpenDialogOptions]
          | [BrowserWindow, OpenDialogOptions]
      ) => Promise<{ canceled: boolean; filePaths: string[] }>;
    };
  };
  const { dialog } = electron;
  return {
    platform: detectOpenWithPlatform(),
    locale,
    getParentWindow,
    showOpenDialog: (parent, options) =>
      parent
        ? dialog.showOpenDialog(parent, options)
        : dialog.showOpenDialog(options),
    execFile: (file, args) => execFile(file, [...args]),
  };
}

/**
 * Pure-ish entry used by Main and unit tests.
 * `targetPath` must already be a Worker-validated absolute path.
 */
export async function openPathWithOtherApplication(
  targetPath: string,
  deps: OpenWithDeps,
): Promise<OpenWithOutcome> {
  if (!targetPath) return "failed";

  try {
    if (deps.platform === "darwin") {
      return await openWithOnMac(targetPath, deps);
    }
    if (deps.platform === "win32") {
      return await openWithOnWindows(targetPath, deps);
    }
    return "failed";
  } catch {
    return "failed";
  }
}

async function openWithOnMac(
  targetPath: string,
  deps: OpenWithDeps,
): Promise<OpenWithOutcome> {
  const copy = resolveNativeDialogCopy(deps.locale, "chooseApplication");
  const parent = deps.getParentWindow();
  const result = await deps.showOpenDialog(parent, {
    title: copy.title,
    buttonLabel: copy.buttonLabel,
    defaultPath: "/Applications",
    properties: ["openFile"],
    filters: [
      {
        name: copy.filterName ?? "Applications",
        extensions: ["app"],
      },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return "cancelled";
  }
  const applicationPath = result.filePaths[0];
  if (!applicationPath) return "cancelled";

  await deps.execFile("open", ["-a", applicationPath, targetPath]);
  return "opened";
}

async function openWithOnWindows(
  targetPath: string,
  deps: OpenWithDeps,
): Promise<OpenWithOutcome> {
  // System "Open with" dialog; cancel is handled inside the OS UI.
  await deps.execFile("rundll32.exe", [
    "shell32.dll,OpenAs_RunDLL",
    targetPath,
  ]);
  return "opened";
}
