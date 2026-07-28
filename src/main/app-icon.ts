import { existsSync } from "node:fs";
import path from "node:path";

import { app, nativeImage, type NativeImage } from "electron";

export function appIconImage(): NativeImage | undefined {
  if (app.isPackaged) return undefined;
  const png = path.join(process.cwd(), "assets", "icon.png");
  if (!existsSync(png)) return undefined;
  const image = nativeImage.createFromPath(png);
  return image.isEmpty() ? undefined : image;
}

export function applyDevAppIcon(): void {
  const image = appIconImage();
  if (!image) return;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(image);
  }
}
