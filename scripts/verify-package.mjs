import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  currentPlatformKey,
  verifyBundle,
  verifyReleaseProvenance,
} from './media-binaries-lib.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
// fileURLToPath（而非 URL.pathname）保证 Windows 上盘符不丢失：
// file:///E:/repo/scripts/verify-package.mjs → E:\repo\scripts\verify-package.mjs
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const registrySource = readFileSync(
  path.join(projectRoot, 'src', 'automation', 'command-registry.ts'),
  'utf8',
);
const apiVersionMatch = registrySource.match(
  /export const AUTOMATION_API_VERSION = (\d+) as const;/u,
);
if (!apiVersionMatch) {
  throw new Error('Could not determine AUTOMATION_API_VERSION from the Registry source.');
}
const apiVersion = Number(apiVersionMatch[1]);
const declarationPath = path.join(
  projectRoot,
  'docs',
  'internal',
  'skills',
  'serpent-automation',
  'automation-api.d.ts',
);
if (!existsSync(declarationPath)) {
  throw new Error(`Workspace is missing generated automation declarations: ${declarationPath}`);
}
const declaration = readFileSync(declarationPath, 'utf8');
const declarationVersion = declaration.match(
  /AUTOMATION_API_VERSION:\s*(\d+)|AUTOMATION_API_VERSION\s*=\s*(\d+)/u,
);
if (!declarationVersion || Number(declarationVersion[1] ?? declarationVersion[2]) !== apiVersion) {
  throw new Error(
    `Automation declaration API version does not match Registry (expected ${apiVersion}).`,
  );
}
const commandIds = [
  ...registrySource.matchAll(/^\s*commandId:\s*'([^']+)'/gmu),
].map((match) => match[1]);
const missingDeclarationCommands = commandIds.filter(
  (commandId) => !declaration.includes(`'${commandId}'`),
);
if (missingDeclarationCommands.length > 0) {
  throw new Error(
    `Automation declaration is missing Registry commands:\n${missingDeclarationCommands.join('\n')}`,
  );
}

const packageManifest = JSON.parse(
  readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
);
if (packageManifest.scripts?.mcp !== 'node scripts/run-mcp.mjs') {
  throw new Error('Package manifest must retain the protocol-only `npm run mcp` launcher.');
}
const launcherPath = path.join(projectRoot, 'scripts', 'run-mcp.mjs');
if (!existsSync(launcherPath)) {
  throw new Error(`Workspace is missing the MCP protocol launcher: ${launcherPath}`);
}

const mainEntry = asarFiles.find((entry) => {
  const normalized = String(entry).replaceAll('\\', '/').replace(/^\.\//u, '');
  return normalized.endsWith('/main.js') || normalized === 'main.js';
});
if (!mainEntry) {
  throw new Error('Package ASAR is missing the Main process entry.');
}
// @electron/asar 的 listPackage 返回 path.join 风格的条目：Windows 上为
// `\.vite\build\main.js`（反斜杠+前导分隔符），macOS 上为 `/.vite/build/main.js`；
// 其内部遍历按 path.sep 分割，因此 extractFile 需要去掉前导分隔符、保留平台分隔符。
const mainSource = asar
  .extractFile(asarPath, mainEntry.replace(/^[\\/]+/u, ''))
  .toString('utf8');
if (!mainSource.includes(`AUTOMATION_API_VERSION`) || !mainSource.includes(String(apiVersion))) {
  throw new Error(
    `Packaged Main does not contain the Registry API version marker (expected ${apiVersion}).`,
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
