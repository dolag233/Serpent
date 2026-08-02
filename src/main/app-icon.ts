import { existsSync } from "node:fs";
import path from "node:path";

import { app, nativeImage, type NativeImage } from "electron";

export function appIconImage(): NativeImage | undefined {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "app.png"),
        path.join(process.resourcesPath, "app.ico"),
      ]
    : [path.join(process.cwd(), "assets", "icons", "app.png")];
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
