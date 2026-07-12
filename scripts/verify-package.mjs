import { existsSync } from 'node:fs';
import path from 'node:path';

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

const missingPaths = requiredPaths.filter((requiredPath) => !existsSync(requiredPath));
if (missingPaths.length > 0) {
  throw new Error(`Package is missing required runtime files:\n${missingPaths.join('\n')}`);
}

console.log(`Verified packaged runtime files in ${resourcesPath}`);
