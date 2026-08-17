import path from "node:path";

export type AppIconPathOptions = {
  readonly cwd: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly resourcesPath: string;
};

/**
 * macOS Dock receives a padded PNG at runtime because Electron's
 * nativeImage.createFromPath does not decode the repository's ICNS container
 * on this runtime. Windows keeps its existing PNG/ICO fallback order.
 */
export function resolveAppIconCandidates({
  cwd,
  isPackaged,
  platform,
  resourcesPath,
}: AppIconPathOptions): string[] {
  const root = isPackaged
    ? resourcesPath
    : path.join(cwd, "assets", "icons");
  if (platform === "darwin") {
    return [path.join(root, "app-dock.png"), path.join(root, "app.png")];
  }
  if (isPackaged) {
    return [path.join(root, "app.png"), path.join(root, "app.ico")];
  }
  return [path.join(root, "app.png")];
}
