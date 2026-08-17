import { existsSync } from "node:fs";
import path from "node:path";

import { app, nativeImage, type NativeImage } from "electron";

import { resolveAppIconCandidates } from "./app-icon-paths";

export function appIconImage(): NativeImage | undefined {
  const candidates = resolveAppIconCandidates({
    cwd: process.cwd(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    resourcesPath: process.resourcesPath,
  }).map((candidate) => path.normalize(candidate));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image;
  }
  return undefined;
}

export function applyDevAppIcon(): void {
  const image = appIconImage();
  if (!image) return;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(image);
  }
}
