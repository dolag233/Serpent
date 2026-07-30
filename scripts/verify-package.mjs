import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  currentPlatformKey,
  verifyBundle,
  verifyReleaseProvenance,
} from './media-binaries-lib.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

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

const asarPath = path.join(resourcesPath, 'app.asar');
const asarFiles = asar.listPackage(asarPath);
const requiredAsarEntries = [
  'plugin_standard_host.js',
  'plugin_trusted_host.js',
  'script_runtime_utility.js',
];
const missingAsarEntries = requiredAsarEntries.filter((entry) => {
  const normalized = entry.replaceAll('\\', '/');
  return !asarFiles.some((candidate) => {
    const file = String(candidate).replaceAll('\\', '/').replace(/^\.\//u, '');
    return file === normalized || file.endsWith(`/${normalized}`);
  });
});
if (missingAsarEntries.length > 0) {
  throw new Error(
    `Package ASAR is missing plugin/script Host utilities:\n${missingAsarEntries.join('\n')}`,
  );
}

const mediaResourcesPath = path.join(resourcesPath, 'resources');
const mediaPlatform = currentPlatformKey();
verifyBundle({ root: mediaResourcesPath, platform: mediaPlatform });
if (process.env.SERPENT_MEDIA_SKIP_PROVENANCE === '1') {
  console.warn(
    'Skipping packaged release provenance check (SERPENT_MEDIA_SKIP_PROVENANCE=1). ' +
      'This is only valid for local build trials, not production release.',
  );
} else {
  verifyReleaseProvenance({ root: mediaResourcesPath, platform: mediaPlatform });
}

console.log(`Verified packaged runtime files in ${resourcesPath}`);
console.log(`Verified Host utilities in ASAR: ${requiredAsarEntries.join(', ')}`);
