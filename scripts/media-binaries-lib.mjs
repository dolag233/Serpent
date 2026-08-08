import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const SUPPORTED_PLATFORMS = new Set(['darwin-arm64', 'win32-x64']);

const FORBIDDEN_FFMPEG_MARKERS = [
  '--enable-gpl',
  '--enable-nonfree',
  '--enable-libx264',
  '--enable-libx265',
  '--enable-libfdk-aac',
];

// LGPL 合规由 FORBIDDEN_FFMPEG_MARKERS（无 --enable-gpl/nonfree/x264/x265/
// fdk-aac）保证；显式 --disable-gpl/--disable-nonfree 是 vcpkg 自建的自证
// 标记，外部 LGPL build（BtbN 等）不包含，因此不作硬性要求。
const REQUIRED_FFMPEG_CONFIG = [
  '--enable-libvpx',
  '--enable-libopus',
  '--enable-libfreetype',
  '--enable-libharfbuzz',
  '--enable-zlib',
];

const REQUIRED_ENCODERS = ['libvpx-vp9', 'libopus', 'png'];
const REQUIRED_FILTERS = [
  'drawtext', 'fps', 'scale', 'thumbnail', 'tile',
  'aformat', 'compand', 'showwavespic',
];

export function currentPlatformKey() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'darwin-arm64';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'win32-x64';
  }
  throw new Error(
    `Media release bundles are unsupported on ${process.platform}-${process.arch}; ` +
      'supported targets are darwin-arm64 and win32-x64.',
  );
}

export function assertPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(
      `Unsupported media platform ${JSON.stringify(platform)}; expected darwin-arm64 or win32-x64.`,
    );
  }
}

export function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${filePath}: ${error.message}`, { cause: error });
  }
}

export function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function assertSha256(value, description) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${description} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function releaseBundleEntry(root, platform, lockPath) {
  const resolvedLockPath = lockPath ?? path.join(root, 'media-binaries', 'bundle-lock.json');
  const lock = readJson(resolvedLockPath);
  const bundle = lock.bundles?.[platform];
  if (!bundle || bundle.status !== 'ready') {
    throw new Error(
      `Media bundle ${platform} is not promoted for release: ${bundle?.reason ?? 'ready bundle metadata is missing'}`,
    );
  }
  if (typeof bundle.url !== 'string' || !bundle.url.startsWith('https://')) {
    throw new Error(`Media bundle ${platform} release URL must use HTTPS.`);
  }
  return {
    lockPath: resolvedLockPath,
    bundle,
    archiveSha256: assertSha256(bundle.sha256, `Media bundle ${platform} archive sha256`),
    manifestSha256: assertSha256(
      bundle.manifestSha256,
      `Media bundle ${platform} manifestSha256`,
    ),
  };
}

export function writeAcquisitionReceipt({
  root,
  platform,
  archiveSha256,
  manifestSha256,
  url,
}) {
  assertPlatform(platform);
  const receiptPath = path.join(root, 'media-binaries', platform, 'acquisition.json');
  writeFileSync(
    receiptPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        platform,
        url,
        archiveSha256: assertSha256(archiveSha256, 'Acquisition archiveSha256'),
        manifestSha256: assertSha256(manifestSha256, 'Acquisition manifestSha256'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return receiptPath;
}

export function verifyReleaseProvenance({ root, platform, lockPath }) {
  assertPlatform(platform);
  const release = releaseBundleEntry(root, platform, lockPath);
  const manifestPath = path.join(root, 'media-binaries', platform, 'manifest.json');
  const receiptPath = path.join(root, 'media-binaries', platform, 'acquisition.json');
  const actualManifestSha256 = sha256File(manifestPath);
  if (actualManifestSha256 !== release.manifestSha256) {
    throw new Error(
      `Media bundle ${platform} manifest is not the manifest promoted by bundle-lock.json.`,
    );
  }
  const receipt = readJson(receiptPath);
  const expected = {
    schemaVersion: 1,
    platform,
    url: release.bundle.url,
    archiveSha256: release.archiveSha256,
    manifestSha256: release.manifestSha256,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (receipt[field] !== value) {
      throw new Error(`Media acquisition receipt ${field} does not match bundle-lock.json.`);
    }
  }
  return { receipt, receiptPath, release };
}

export function platformFileNames(platform) {
  assertPlatform(platform);
  const suffix = platform.startsWith('win32-') ? '.exe' : '';
  return {
    ffmpeg: `ffmpeg${suffix}`,
    ffprobe: `ffprobe${suffix}`,
    oiiotool: `oiiotool${suffix}`,
  };
}

export function requiredBundleFiles(platform) {
  const names = platformFileNames(platform);
  const licenseRoot = `media-binaries/${platform}/licenses`;
  return [
    { path: `ffmpeg/${platform}/${names.ffmpeg}`, role: 'executable', component: 'ffmpeg' },
    { path: `ffmpeg/${platform}/${names.ffprobe}`, role: 'executable', component: 'ffmpeg' },
    { path: `oiio/${platform}/${names.oiiotool}`, role: 'executable', component: 'openimageio' },
    { path: `${licenseRoot}/FFmpeg-LICENSE.md`, role: 'license', component: 'ffmpeg' },
    { path: `${licenseRoot}/COPYING.LGPLv2.1`, role: 'license', component: 'ffmpeg' },
    { path: `${licenseRoot}/OpenImageIO-LICENSE.md`, role: 'license', component: 'openimageio' },
    {
      path: `${licenseRoot}/OpenImageIO-THIRD-PARTY.md`,
      role: 'license',
      component: 'openimageio',
    },
    {
      path: `${licenseRoot}/Build-Dependency-NOTICES.txt`,
      role: 'license',
      component: 'build-dependencies',
    },
  ];
}

function runBinary(binaryPath, args) {
  const result = spawnSync(binaryPath, args, {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    shell: false,
  });
  if (result.error) {
    throw new Error(
      `Cannot execute ${binaryPath} ${args.join(' ')}: ${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim().slice(-2_000);
    throw new Error(
      `${binaryPath} ${args.join(' ')} exited with ${String(result.status)}${detail ? `:\n${detail}` : ''}`,
    );
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}

export function assertFfmpegCompliance(buildConfiguration, encoders, filters) {
  const normalizedConfig = buildConfiguration.toLowerCase();
  for (const marker of FORBIDDEN_FFMPEG_MARKERS) {
    if (normalizedConfig.includes(marker)) {
      throw new Error(`FFmpeg compliance rejected forbidden build marker: ${marker}`);
    }
  }
  for (const marker of REQUIRED_FFMPEG_CONFIG) {
    if (!normalizedConfig.includes(marker)) {
      throw new Error(`FFmpeg compliance is missing required build marker: ${marker}`);
    }
  }
  for (const encoder of REQUIRED_ENCODERS) {
    if (!encoders.includes(encoder)) {
      throw new Error(`FFmpeg runtime capability is missing required encoder: ${encoder}`);
    }
  }
  for (const filter of REQUIRED_FILTERS) {
    const filterPattern = new RegExp(`(?:^|\\s)${filter}(?:\\s|$)`, 'm');
    if (!filterPattern.test(filters)) {
      throw new Error(`FFmpeg runtime capability is missing required filter: ${filter}`);
    }
  }
}

export function inspectBinaries(root, platform) {
  const names = platformFileNames(platform);
  const ffmpegPath = path.join(root, 'ffmpeg', platform, names.ffmpeg);
  const ffprobePath = path.join(root, 'ffmpeg', platform, names.ffprobe);
  const oiiotoolPath = path.join(root, 'oiio', platform, names.oiiotool);

  const ffmpegVersion = runBinary(ffmpegPath, ['-hide_banner', '-version']);
  const ffprobeVersion = runBinary(ffprobePath, ['-hide_banner', '-version']);
  const oiiotoolVersion = runBinary(oiiotoolPath, ['--version']);
  const oiiotoolHelp = runBinary(oiiotoolPath, ['--help']);
  const buildConfiguration = runBinary(ffmpegPath, ['-hide_banner', '-buildconf']);
  const encoders = runBinary(ffmpegPath, ['-hide_banner', '-encoders']);
  const filters = runBinary(ffmpegPath, ['-hide_banner', '-filters']);

  assertFfmpegCompliance(buildConfiguration, encoders, filters);
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/m.test(oiiotoolVersion)) {
    throw new Error('oiiotool --version did not return a valid OpenImageIO version.');
  }
  if (!/oiiotool|openimageio/i.test(oiiotoolHelp)) {
    throw new Error('oiiotool --help did not identify OpenImageIO/oiiotool.');
  }
  for (const operation of ['--ociodisplay', '--colorconfiginfo']) {
    if (!oiiotoolHelp.includes(operation)) {
      throw new Error(`oiiotool is missing required OpenColorIO operation: ${operation}`);
    }
  }

  return {
    ffmpegVersion: ffmpegVersion.split(/\r?\n/, 1)[0],
    ffprobeVersion: ffprobeVersion.split(/\r?\n/, 1)[0],
    oiiotoolVersion: oiiotoolVersion.split(/\r?\n/, 1)[0],
    buildConfiguration,
  };
}

function validateManifestShape(manifest, platform, sourceLock) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error('Media manifest schemaVersion must be 1.');
  }
  if (manifest.platform !== platform) {
    throw new Error(`Media manifest platform ${String(manifest.platform)} does not match ${platform}.`);
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('Media manifest files must be an array.');
  }
  for (const component of ['ffmpeg', 'openimageio']) {
    const expected = sourceLock.components?.[component];
    const actual = manifest.components?.[component];
    if (!expected || !actual) {
      throw new Error(`Media manifest is missing component metadata for ${component}.`);
    }
    for (const field of ['version', 'sourceUrl', 'sha256', 'license']) {
      if (actual[field] !== expected[field]) {
        throw new Error(
          `Media manifest ${component}.${field} does not match source-lock.json.`,
        );
      }
    }
  }
}

function assertRegularRequiredFile(root, file, platform) {
  const absolutePath = path.resolve(root, file.path);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  if (!absolutePath.startsWith(rootPrefix)) {
    throw new Error(`Media manifest path escapes resource root: ${file.path}`);
  }
  accessSync(absolutePath, constants.F_OK);
  const stat = statSync(absolutePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Media bundle file is not a non-empty regular file: ${absolutePath}`);
  }
  if (file.role === 'executable' && !platform.startsWith('win32-')) {
    accessSync(absolutePath, constants.X_OK);
  }
  const actualHash = sha256File(absolutePath);
  if (!/^[a-f0-9]{64}$/.test(file.sha256) || actualHash !== file.sha256) {
    throw new Error(`Media bundle SHA-256 mismatch: ${absolutePath}`);
  }
}

export function verifyBundle({ root, platform, execute = true }) {
  assertPlatform(platform);
  const sourceLock = readJson(path.join(root, 'media-binaries', 'source-lock.json'));
  const manifestPath = path.join(root, 'media-binaries', platform, 'manifest.json');
  if (!existsSync(manifestPath)) {
    const bundleLockPath = path.join(root, 'media-binaries', 'bundle-lock.json');
    const bundleLock = existsSync(bundleLockPath) ? readJson(bundleLockPath) : undefined;
    const reason = bundleLock?.bundles?.[platform]?.reason;
    throw new Error(
      `Media bundle ${platform} is not installed; missing ${manifestPath}.` +
        (reason ? ` Release blocker: ${reason}` : ''),
    );
  }
  const manifest = readJson(manifestPath);
  validateManifestShape(manifest, platform, sourceLock);

  const required = requiredBundleFiles(platform);
  const entriesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  for (const expected of required) {
    const actual = entriesByPath.get(expected.path);
    if (!actual || actual.role !== expected.role || actual.component !== expected.component) {
      throw new Error(`Media manifest is missing required ${expected.role}: ${expected.path}`);
    }
    assertRegularRequiredFile(root, actual, platform);
  }

  let inspection;
  if (execute) {
    inspection = inspectBinaries(root, platform);
    const expectedVersions = sourceLock.components;
    if (!inspection.ffmpegVersion.includes(expectedVersions.ffmpeg.version)) {
      throw new Error(`FFmpeg version does not contain ${expectedVersions.ffmpeg.version}.`);
    }
    if (!inspection.ffprobeVersion.includes(expectedVersions.ffmpeg.version)) {
      throw new Error(`ffprobe version does not contain ${expectedVersions.ffmpeg.version}.`);
    }
    if (!inspection.oiiotoolVersion.includes(expectedVersions.openimageio.version)) {
      throw new Error(`oiiotool version does not contain ${expectedVersions.openimageio.version}.`);
    }
    for (const [field, value] of Object.entries(manifest.reportedVersions ?? {})) {
      if (inspection[field] !== value) {
        throw new Error(`Media manifest reportedVersions.${field} does not match executable output.`);
      }
    }
  }

  return { manifest, manifestPath, inspection };
}

export function generateManifest({ root, platform }) {
  assertPlatform(platform);
  const sourceLock = readJson(path.join(root, 'media-binaries', 'source-lock.json'));
  const required = requiredBundleFiles(platform);
  for (const file of required) {
    const absolutePath = path.join(root, file.path);
    if (!existsSync(absolutePath)) {
      throw new Error(`Cannot generate media manifest; required file is missing: ${absolutePath}`);
    }
    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Cannot generate media manifest; invalid file: ${absolutePath}`);
    }
    if (file.role === 'executable' && !platform.startsWith('win32-')) {
      accessSync(absolutePath, constants.X_OK);
    }
  }

  const inspection = inspectBinaries(root, platform);
  if (!inspection.ffmpegVersion.includes(sourceLock.components.ffmpeg.version)) {
    throw new Error(`FFmpeg is not locked version ${sourceLock.components.ffmpeg.version}.`);
  }
  if (!inspection.ffprobeVersion.includes(sourceLock.components.ffmpeg.version)) {
    throw new Error(`ffprobe is not locked version ${sourceLock.components.ffmpeg.version}.`);
  }
  if (!inspection.oiiotoolVersion.includes(sourceLock.components.openimageio.version)) {
    throw new Error(`oiiotool is not locked version ${sourceLock.components.openimageio.version}.`);
  }

  const manifest = {
    schemaVersion: 1,
    platform,
    generatedAt: new Date().toISOString(),
    components: sourceLock.components,
    reportedVersions: {
      ffmpegVersion: inspection.ffmpegVersion,
      ffprobeVersion: inspection.ffprobeVersion,
      oiiotoolVersion: inspection.oiiotoolVersion,
    },
    files: required.map((file) => ({
      ...file,
      sha256: sha256File(path.join(root, file.path)),
    })),
  };

  const manifestPath = path.join(root, 'media-binaries', platform, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { manifest, manifestPath };
}
