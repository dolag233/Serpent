import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  currentPlatformKey,
  verifyBundle,
  verifyReleaseProvenance,
} from './media-binaries-lib.mjs';

const platformDirectory = `Serpent-${process.platform}-${process.arch}`;
const packageRoot = process.env.SERPENT_PACKAGE_ROOT ?? path.resolve('out', platformDirectory);
const resourcesPath =
  process.platform === 'darwin'
    ? path.join(packageRoot, 'Serpent.app', 'Contents', 'Resources')
    : path.join(packageRoot, 'resources');

const requiredPaths = [
  path.join(resourcesPath, 'app.asar'),
  path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  ),
];

const systemTrashBinary = process.platform === 'darwin'
  ? 'macos-trash'
  : process.platform === 'win32'
    ? 'windows-trash.exe'
    : undefined;

if (!systemTrashBinary) {
  throw new Error(`Packaged system trash is not supported on ${process.platform}.`);
}

requiredPaths.push(path.join(
  resourcesPath,
  'app.asar.unpacked',
  'node_modules',
  'trash',
  'lib',
  systemTrashBinary,
));

const missingPaths = requiredPaths.filter((requiredPath) => !existsSync(requiredPath));
if (missingPaths.length > 0) {
  throw new Error(`Package is missing required runtime files:\n${missingPaths.join('\n')}`);
}

const mediaResourcesPath = path.join(resourcesPath, 'resources');
const mediaPlatform = currentPlatformKey();
verifyBundle({ root: mediaResourcesPath, platform: mediaPlatform });
verifyReleaseProvenance({ root: mediaResourcesPath, platform: mediaPlatform });

console.log(`Verified packaged runtime files in ${resourcesPath}`);
