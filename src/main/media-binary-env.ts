import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";

import { app } from "electron";

/**
 * Absolute paths for media CLIs so the Library Worker (UtilityProcess) does
 * not depend on a minimal GUI PATH. Mirrors worker `binary-resolver` roots
 * but can use `app.getAppPath()` from Main.
 */
function platformBinaryName(baseName: string): string {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function platformDirectory(): string {
  if (process.platform === "win32") return "win32-x64";
  return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
}

function isRunnable(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (process.platform !== "win32") {
      accessSync(filePath, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function firstRunnable(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (isRunnable(candidate)) return candidate;
  }
  return undefined;
}

function resourceCandidates(toolDir: string, binaryName: string): string[] {
  const relative = path.join(
    toolDir,
    platformDirectory(),
    platformBinaryName(binaryName),
  );
  const roots = [
    path.join(process.resourcesPath, "resources"),
    process.resourcesPath,
    path.join(app.getAppPath(), "resources"),
    path.join(process.cwd(), "resources"),
  ];
  return roots.map((root) => path.join(root, relative));
}

/** Env overrides passed into `utilityProcess.fork` for the Library Worker. */
export function mediaBinaryWorkerEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  if (!env.SERPENT_FFMPEG_PATH) {
    const ffmpeg = firstRunnable(resourceCandidates("ffmpeg", "ffmpeg"));
    if (ffmpeg) env.SERPENT_FFMPEG_PATH = ffmpeg;
  }
  if (!env.SERPENT_OIIO_PATH) {
    const oiiotool = firstRunnable(resourceCandidates("oiio", "oiiotool"));
    if (oiiotool) env.SERPENT_OIIO_PATH = oiiotool;
  }
  // Ensure worker can still find sibling tools next to an env override.
  if (env.SERPENT_FFMPEG_PATH && existsSync(env.SERPENT_FFMPEG_PATH)) {
    const dir = path.dirname(env.SERPENT_FFMPEG_PATH);
    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const current = env[pathKey] ?? env.PATH ?? "";
    if (!current.split(path.delimiter).includes(dir)) {
      env[pathKey] = `${dir}${path.delimiter}${current}`;
    }
  }
  return env;
}
