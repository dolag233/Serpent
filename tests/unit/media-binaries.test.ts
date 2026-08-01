import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createPackage } from '@electron/asar';

import { afterEach, describe, expect, it } from 'vitest';
import forgeConfig from '../../forge.config';
import {
  assertWindowsSystemDependencies,
  peImportsFromBuffer,
} from '../../scripts/media-build/pe-dependencies.mjs';

const roots: string[] = [];
const projectRoot = path.resolve(import.meta.dirname, '../..');
const mediaScript = path.join(projectRoot, 'scripts', 'media-binaries.mjs');
const packageVerifier = path.join(projectRoot, 'scripts', 'verify-package.mjs');

function run(root: string, command: 'manifest' | 'verify') {
  return spawnSync(process.execPath, [mediaScript, command, '--platform', 'darwin-arm64', '--root', root], {
    encoding: 'utf8',
  });
}

function writeExecutable(filePath: string, body: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `#!/bin/sh\n${body}\n`, 'utf8');
  chmodSync(filePath, 0o755);
}

function writeFixtureFile(filePath: string, contents = 'fixture'): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function createFixture(gpl = false): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-media-test-'));
  roots.push(root);
  mkdirSync(path.join(root, 'media-binaries'), { recursive: true });
  cpSync(
    path.join(projectRoot, 'resources', 'media-binaries', 'source-lock.json'),
    path.join(root, 'media-binaries', 'source-lock.json'),
  );

  const config = gpl
    ? '--disable-nonfree --enable-gpl --enable-libx264 --enable-libvpx --enable-libopus --enable-libfreetype --enable-libharfbuzz --enable-zlib'
    : '--disable-gpl --disable-nonfree --enable-libvpx --enable-libopus --enable-libfreetype --enable-libharfbuzz --enable-zlib';
  writeExecutable(
    path.join(root, 'ffmpeg', 'darwin-arm64', 'ffmpeg'),
    `case "$*" in
      *-version*) echo "ffmpeg version 8.1" ;;
      *-buildconf*) echo "${config}" ;;
      *-encoders*) echo " V..... libvpx-vp9"; echo " A..... libopus"; echo " V..... png" ;;
      *-filters*) echo " ... drawtext"; echo " ... fps"; echo " ... scale"; echo " ... thumbnail"; echo " ... tile"; echo " ... aformat"; echo " ... compand"; echo " ... showwavespic" ;;
      *) exit 2 ;;
    esac`,
  );
  writeExecutable(
    path.join(root, 'ffmpeg', 'darwin-arm64', 'ffprobe'),
    'echo "ffprobe version 8.1"',
  );
  writeExecutable(
    path.join(root, 'oiio', 'darwin-arm64', 'oiiotool'),
    `case "$*" in
      *--version*) echo "3.1.12.0" ;;
      *--help*) echo "oiiotool -- simple OpenImageIO operations"; echo "--ociodisplay --colorconfiginfo" ;;
      *) exit 2 ;;
    esac`,
  );

  const licenseDirectory = path.join(root, 'media-binaries', 'darwin-arm64', 'licenses');
  mkdirSync(licenseDirectory, { recursive: true });
  for (const name of [
    'FFmpeg-LICENSE.md',
    'COPYING.LGPLv2.1',
    'OpenImageIO-LICENSE.md',
    'OpenImageIO-THIRD-PARTY.md',
    'Build-Dependency-NOTICES.txt',
  ]) {
    writeFileSync(path.join(licenseDirectory, name), `fixture notice for ${name}\n`);
  }
  return root;
}

function promoteFixture(root: string, overrides: Record<string, unknown> = {}): void {
  const platform = 'darwin-arm64';
  const manifestPath = path.join(root, 'media-binaries', platform, 'manifest.json');
  const manifestSha256 = createHash('sha256').update(
    readFileSync(manifestPath),
  ).digest('hex');
  const bundle = {
    status: 'ready',
    url: 'https://downloads.example.test/serpent-media-darwin-arm64.zip',
    sha256: 'a'.repeat(64),
    manifestSha256,
    ...overrides,
  };
  writeFileSync(
    path.join(root, 'media-binaries', 'bundle-lock.json'),
    `${JSON.stringify({ schemaVersion: 1, bundles: { [platform]: bundle } }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(root, 'media-binaries', platform, 'acquisition.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        platform,
        url: bundle.url,
        archiveSha256: bundle.sha256,
        manifestSha256: bundle.manifestSha256,
      },
      null,
      2,
    )}\n`,
  );
}

function syntheticPe(delayImport = 'KERNEL32.dll'): Buffer {
  const data = Buffer.alloc(0x900);
  data.write('MZ', 0, 'ascii');
  data.writeUInt32LE(0x80, 0x3c);
  data.write('PE\0\0', 0x80, 'ascii');
  data.writeUInt16LE(0x8664, 0x84);
  data.writeUInt16LE(1, 0x86);
  data.writeUInt16LE(0xf0, 0x94);
  const optional = 0x98;
  data.writeUInt16LE(0x20b, optional);
  data.writeUInt32LE(16, optional + 108);
  data.writeUInt32LE(0x1000, optional + 112 + 8);
  data.writeUInt32LE(40, optional + 116 + 8);
  data.writeUInt32LE(0x1100, optional + 112 + 13 * 8);
  data.writeUInt32LE(64, optional + 116 + 13 * 8);
  const section = optional + 0xf0;
  data.writeUInt32LE(0x700, section + 8);
  data.writeUInt32LE(0x1000, section + 12);
  data.writeUInt32LE(0x700, section + 16);
  data.writeUInt32LE(0x200, section + 20);
  data.writeUInt32LE(0x1300, 0x200 + 12);
  data.writeUInt32LE(1, 0x300);
  data.writeUInt32LE(0x1320, 0x304);
  data.write('KERNEL32.dll\0', 0x500, 'ascii');
  data.write(`${delayImport}\0`, 0x520, 'ascii');
  return data;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('media binary release gate', () => {
  it('generates and verifies a hash-locked compliant bundle manifest', () => {
    const root = createFixture();
    const generated = run(root, 'manifest');
    expect(generated.status, generated.stderr).toBe(0);
    promoteFixture(root);

    const verified = run(root, 'verify');
    expect(verified.status, verified.stderr).toBe(0);

    writeFileSync(path.join(root, 'ffmpeg', 'darwin-arm64', 'ffprobe'), 'tampered');
    const tampered = run(root, 'verify');
    expect(tampered.status).not.toBe(0);
    expect(tampered.stderr).toContain('SHA-256 mismatch');
  }, 15_000);

  it('rejects a GPL-enabled FFmpeg before writing a manifest', () => {
    const root = createFixture(true);
    const result = run(root, 'manifest');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('forbidden build marker: --enable-gpl');
  }, 15_000);

  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')(
    're-verifies the copied media bundle in a packaged app',
    async () => {
      const root = createFixture();
      expect(run(root, 'manifest').status).toBe(0);
      promoteFixture(root);
      const packageRoot = mkdtempSync(path.join(tmpdir(), 'serpent-package-test-'));
      roots.push(packageRoot);
      const packagedResources = path.join(
        packageRoot,
        'Serpent.app',
        'Contents',
        'Resources',
      );
      const asarSource = path.join(packageRoot, 'asar-source');
      writeFixtureFile(path.join(asarSource, 'package.json'), '{"name":"fixture"}\n');
      writeFixtureFile(
        path.join(asarSource, '.vite', 'build', 'main.js'),
        'const AUTOMATION_API_VERSION = 1;\n',
      );
      for (const utility of [
        'plugin_standard_host.js',
        'plugin_trusted_host.js',
        'script_runtime_utility.js',
      ]) {
        writeFixtureFile(path.join(asarSource, utility), '// packaged utility fixture\n');
      }
      await createPackage(asarSource, path.join(packagedResources, 'app.asar'));
      writeFixtureFile(path.join(
        packagedResources,
        'app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      ));
      writeFixtureFile(path.join(
        packagedResources,
        'app.asar.unpacked/node_modules/trash/lib/macos-trash',
      ));
      cpSync(root, path.join(packagedResources, 'resources'), { recursive: true });

      const result = spawnSync(process.execPath, [packageVerifier], {
        encoding: 'utf8',
        env: { ...process.env, SERPENT_PACKAGE_ROOT: packageRoot },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Verified packaged runtime files');

      const packagedReceipt = path.join(
        packagedResources,
        'resources/media-binaries/darwin-arm64/acquisition.json',
      );
      const receipt = JSON.parse(readFileSync(packagedReceipt, 'utf8')) as Record<string, unknown>;
      writeFileSync(
        packagedReceipt,
        `${JSON.stringify({ ...receipt, archiveSha256: 'f'.repeat(64) }, null, 2)}\n`,
      );
      const substituted = spawnSync(process.execPath, [packageVerifier], {
        encoding: 'utf8',
        env: { ...process.env, SERPENT_PACKAGE_ROOT: packageRoot },
      });
      expect(substituted.status).not.toBe(0);
      expect(substituted.stderr).toContain('receipt archiveSha256');
    },
    30_000,
  );

  it('binds the installed manifest and acquisition receipt to bundle-lock.json', () => {
    const root = createFixture();
    expect(run(root, 'manifest').status).toBe(0);
    promoteFixture(root);
    expect(run(root, 'verify').status).toBe(0);

    promoteFixture(root, { sha256: 'b'.repeat(64) });
    writeFileSync(
      path.join(root, 'media-binaries', 'darwin-arm64', 'acquisition.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        platform: 'darwin-arm64',
        url: 'https://downloads.example.test/serpent-media-darwin-arm64.zip',
        archiveSha256: 'a'.repeat(64),
        manifestSha256: createHash('sha256')
          .update(readFileSync(path.join(root, 'media-binaries/darwin-arm64/manifest.json')))
          .digest('hex'),
      }, null, 2)}\n`,
    );
    const wrongReceipt = run(root, 'verify');
    expect(wrongReceipt.status).not.toBe(0);
    expect(wrongReceipt.stderr).toContain('receipt archiveSha256');

    promoteFixture(root);
    writeFileSync(
      path.join(root, 'media-binaries', 'darwin-arm64', 'manifest.json'),
      `${readFileSync(path.join(root, 'media-binaries/darwin-arm64/manifest.json'), 'utf8')} `,
    );
    const wrongManifest = run(root, 'verify');
    expect(wrongManifest.status).not.toBe(0);
    expect(wrongManifest.stderr).toContain('manifest is not the manifest promoted');
  }, 15_000);

});

it('rejects non-x64 PE files and non-allowlisted delay-import DLLs', () => {
  const delayed = syntheticPe('vendor-runtime.dll');
  expect(peImportsFromBuffer(delayed)).toEqual(['KERNEL32.dll', 'vendor-runtime.dll']);
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-pe-test-'));
  roots.push(root);
  const executable = path.join(root, 'ffmpeg.exe');
  writeFileSync(executable, delayed);
  expect(() => assertWindowsSystemDependencies(executable)).toThrow(
    /non-allowlisted DLLs.*vendor-runtime\.dll/s,
  );

  const wrongArchitecture = syntheticPe();
  wrongArchitecture.writeUInt16LE(0x14c, 0x84);
  expect(() => peImportsFromBuffer(wrongArchitecture)).toThrow(/not Windows x64/);
});

it('installs media validation inside Forge package and make lifecycles', () => {
  expect(forgeConfig.hooks?.prePackage).toBeTypeOf('function');
  expect(forgeConfig.hooks?.postPackage).toBeTypeOf('function');
  expect(forgeConfig.hooks?.preMake).toBeTypeOf('function');
});

it('marks the custom macOS triplet as Darwin for vcpkg dependency resolution', () => {
  const triplet = readFileSync(
    path.join(
      projectRoot,
      'resources/media-binaries/vcpkg/triplets/serpent-arm64-osx-static.cmake',
    ),
    'utf8',
  );
  expect(triplet).toMatch(/^set\(VCPKG_CMAKE_SYSTEM_NAME Darwin\)$/m);
});

it('uses one LibRaw- and zlib-enabled media manifest for macOS and Windows builds', () => {
  const manifest = JSON.parse(readFileSync(
    path.join(projectRoot, 'resources/media-binaries/vcpkg/vcpkg.json'),
    'utf8',
  )) as {
    dependencies: Array<{ name: string; features?: string[] }>;
  };
  const oiio = manifest.dependencies.find((dependency) => dependency.name === 'openimageio');
  expect(oiio?.features).toEqual(expect.arrayContaining(['libraw', 'opencolorio', 'tools']));
  const ffmpeg = manifest.dependencies.find((dependency) => dependency.name === 'ffmpeg');
  expect(ffmpeg?.features).toEqual(expect.arrayContaining(['zlib']));

  const macScript = readFileSync(
    path.join(projectRoot, 'scripts/media-build/darwin-arm64.sh'),
    'utf8',
  );
  const windowsScript = readFileSync(
    path.join(projectRoot, 'scripts/media-build/win32-x64.ps1'),
    'utf8',
  );
  expect(macScript).toContain('MANIFEST_ROOT="$ROOT/resources/media-binaries/vcpkg"');
  expect(windowsScript).toContain("$ManifestRoot = Join-Path $Root 'resources/media-binaries/vcpkg'");
  expect(macScript).toContain('export VCPKG_ROOT');
  expect(windowsScript).toContain('$env:VCPKG_ROOT = $VcpkgRoot');
  expect(windowsScript).toContain("Join-Path $env:LOCALAPPDATA 'Serpent\\media-build\\win32-x64'");
});

it('keeps the PNG encoder required for audio waveform thumbnails in the FFmpeg overlay', () => {
  const overlayBuilder = readFileSync(
    path.join(projectRoot, 'scripts/media-build/prepare-vcpkg-overlay.mjs'),
    'utf8',
  );
  expect(overlayBuilder).toContain('--enable-encoder=png');
});

it('checksum-verifies the pinned Windows vcpkg tool instead of weakening integrity checks', () => {
  const sourceLock = JSON.parse(readFileSync(
    path.join(projectRoot, 'resources/media-binaries/source-lock.json'),
    'utf8',
  )) as {
    vcpkgTool?: { releaseTag?: string; windowsX64?: { url?: string; sha256?: string } };
  };
  expect(sourceLock.vcpkgTool).toMatchObject({
    releaseTag: '2026-04-08',
    windowsX64: {
      url: 'https://github.com/microsoft/vcpkg-tool/releases/download/2026-04-08/vcpkg.exe',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  });

  const windowsScript = readFileSync(
    path.join(projectRoot, 'scripts/media-build/win32-x64.ps1'),
    'utf8',
  );
  expect(windowsScript).toContain('Get-FileHash -LiteralPath $DownloadPath -Algorithm SHA256');
  expect(windowsScript).toContain('Pinned Windows vcpkg tool checksum does not match source-lock.json.');
  expect(windowsScript).not.toContain('bootstrap-vcpkg.bat');
  expect(windowsScript).toContain("'^.+-windows\\.partial\\.\\d+$'");
  expect(windowsScript).toContain("-Filter '*.exe' -File");
  expect(windowsScript).toContain('Recovered completed vcpkg tool extraction');
  expect(windowsScript).toContain('$Attempt -le 5');
  expect(windowsScript).toContain('Retrying vcpkg media dependency build after a failed attempt');
  expect(windowsScript).toContain("Start-Sleep -Seconds $Attempt");
  expect(windowsScript).toContain('$PSNativeCommandUseErrorActionPreference = $false');
  expect(windowsScript).toContain('$PSNativeCommandUseErrorActionPreference = $PreviousNativeErrorPreference');
});

it('keeps checksum-locked source archives available for license staging', () => {
  const macScript = readFileSync(
    path.join(projectRoot, 'scripts/media-build/darwin-arm64.sh'),
    'utf8',
  );
  const windowsScript = readFileSync(
    path.join(projectRoot, 'scripts/media-build/win32-x64.ps1'),
    'utf8',
  );

  expect(macScript).not.toContain('--clean-after-build');
  expect(windowsScript).not.toContain('--clean-after-build');
});

it('bootstraps a pinned host pkgconf instead of depending on Homebrew', () => {
  const macScript = readFileSync(
    path.join(projectRoot, 'scripts/media-build/darwin-arm64.sh'),
    'utf8',
  );

  expect(macScript).toContain('install pkgconf:arm64-osx');
  expect(macScript).toContain('export PKG_CONFIG="$HOST_TOOLS_ROOT/arm64-osx/tools/pkgconf/pkgconf"');
  expect(macScript).not.toMatch(/\bbrew\b/);
});
