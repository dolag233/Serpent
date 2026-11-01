import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const targetPlatform = process.env.SERPENT_PACKAGE_PLATFORM
  ?? path.basename(process.env.SERPENT_PACKAGE_ROOT ?? path.resolve('out', `Serpent-${process.platform}-${process.arch}`))
    .replace(/^Serpent-/u, '');
const targetSeparator = targetPlatform.lastIndexOf('-');
const packagePlatform = targetPlatform.slice(0, targetSeparator);
const packageArch = targetPlatform.slice(targetSeparator + 1);
if (targetSeparator <= 0 || !packageArch) {
  throw new Error('Set SERPENT_PACKAGE_PLATFORM or use a Serpent-<platform>-<arch> package directory.');
}
if (packagePlatform !== process.platform || packageArch !== process.arch) {
  throw new Error(`Package verification requires a matching host; target is ${packagePlatform}-${packageArch}, host is ${process.platform}-${process.arch}.`);
}
const platformDirectory = `Serpent-${packagePlatform}-${packageArch}`;
const packageRoot = process.env.SERPENT_PACKAGE_ROOT ?? path.resolve('out', platformDirectory);
const resourcesPath =
  packagePlatform === 'darwin'
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

const sqliteVecPackage = packagePlatform === 'darwin'
  ? `sqlite-vec-darwin-${packageArch}`
  : packagePlatform === 'win32'
    ? `sqlite-vec-windows-${packageArch}`
    : packagePlatform === 'linux'
      ? `sqlite-vec-linux-${packageArch}`
      : null;
const sqliteVecExtension = packagePlatform === 'darwin' ? 'dylib' : packagePlatform === 'win32' ? 'dll' : 'so';
if (sqliteVecPackage) {
  requiredPaths.push(path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', sqliteVecPackage,
    `vec0.${sqliteVecExtension}`));
}

// 2026-09-15：链接资产/文件夹的删除改为永久删除源文件，产品不再使用系统回收站，
// 因此不再校验 `trash` 的本地 helper 是否随包解包。
const missingPaths = requiredPaths.filter((requiredPath) => !existsSync(requiredPath));
if (missingPaths.length > 0) {
  throw new Error(`Package is missing required runtime files:\n${missingPaths.join('\n')}`);
}

if (sqliteVecPackage) {
  const integrity = JSON.parse(readFileSync(path.join(projectRoot, 'scripts', 'sqlite-vec-integrity.json'), 'utf8'));
  const packageManifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  if (packageManifest.dependencies?.['sqlite-vec'] !== integrity.version) {
    throw new Error('Packaged sqlite-vec version does not match its pinned binary integrity manifest.');
  }
  const extensionPath = requiredPaths.find((entry) => entry.includes(sqliteVecPackage) && entry.includes('vec0.'));
  if (!extensionPath) throw new Error('Could not locate the packaged sqlite-vec extension.');
  const actualHash = createHash('sha256').update(readFileSync(extensionPath)).digest('hex');
  const expectedHash = integrity.sha256?.[`${packagePlatform}-${packageArch}`];
  if (!expectedHash || actualHash !== expectedHash) {
    throw new Error(`Packaged sqlite-vec binary integrity check failed for ${packagePlatform}-${packageArch}.`);
  }
}

// Serpent Windows 事故（2026-08-21）：vcpkg 用户级 MSBuild 集成会把
// better-sqlite3 的静态 sqlite3 错解析为动态 sqlite3.dll，打包产物 .node
// 依赖缺失 DLL（Worker 加载失败 → 所有资源库打不开）。校验：
// 1) .node 体积下限（受控静态编译产物 ~1.9MB，坏编译产物仅 ~230KB）；
// 2) PE 导入表不得包含 sqlite3.dll（二进制扫描导入名）。
const sqliteNodePath = path.join(
  resourcesPath,
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);
if (existsSync(sqliteNodePath)) {
  const nodeBytes = readFileSync(sqliteNodePath);
  if (nodeBytes.length < 500 * 1024) {
    throw new Error(
      `Packaged better_sqlite3.node is suspiciously small (${nodeBytes.length} bytes); ` +
        'it was likely compiled against the vcpkg sqlite3.dll. Rebuild with ' +
        'VcpkgEnabled=false (scripts/rebuild-native.mjs) before packaging.',
    );
  }
  if (nodeBytes.includes(Buffer.from('sqlite3.dll', 'utf8'))) {
    throw new Error(
      'Packaged better_sqlite3.node dynamically links sqlite3.dll (vcpkg pollution); ' +
        'the DLL is not shipped, so every library would fail to open. Rebuild with ' +
        'VcpkgEnabled=false before packaging.',
    );
  }
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

// linux-x64 and linux-arm64 ship the same ffmpeg / oiiotool contract as
// macOS and Windows. linux-arm64 stays fail-closed until bundle-lock is ready.
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

if (packagePlatform === 'darwin') {
  const appPath = path.join(packageRoot, 'Serpent.app');
  const codeResources = path.join(appPath, 'Contents', '_CodeSignature', 'CodeResources');
  if (!existsSync(codeResources)) {
    throw new Error(
      'macOS package has no bundle signature (Contents/_CodeSignature/CodeResources). ' +
        'A linker-signed executable is reported as damaged after quarantine. ' +
        'Ad-hoc signing must run during packaging.',
    );
  }
  const signature = spawnSync('codesign', ['--verify', '--strict', '--verbose=2', appPath], {
    encoding: 'utf8',
  });
  if (signature.status !== 0) {
    const detail = `${signature.stdout ?? ''}${signature.stderr ?? ''}`.trim();
    throw new Error(`macOS package failed codesign --verify --strict:\n${detail}`);
  }
}

console.log(`Verified packaged runtime files in ${resourcesPath}`);
console.log(`Verified Host utilities in ASAR: ${requiredAsarEntries.join(', ')}`);
