import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Canonical icon sources and generated app bundles live here. */
export const iconAssetsDir = path.join(projectRoot, 'assets', 'icons');

/** Source artwork checked into the repo (do not edit generated files by hand). */
export const iconSources = {
  app: path.join(iconAssetsDir, 'source-app.png'),
  extensionActive: path.join(iconAssetsDir, 'source-extension-active.png'),
  extensionInactive: path.join(iconAssetsDir, 'source-extension-inactive.png'),
};

/** Electron / dev-runtime icon outputs produced by `npm run icons:generate`. */
export const generatedAppIcons = {
  png: path.join(iconAssetsDir, 'app.png'),
  icns: path.join(iconAssetsDir, 'app.icns'),
  ico: path.join(iconAssetsDir, 'app.ico'),
  /** Path without extension for electron-packager (`app.icns` / `app.ico`). */
  packagerBase: path.join(iconAssetsDir, 'app'),
};

/** Browser extension toolbar / manifest raster sizes. */
export const extensionIconSizes = [32, 48, 64, 128];
