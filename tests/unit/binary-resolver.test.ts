import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveFfmpegPath,
  resolveFfprobePath,
  resolveOiiotoolPath,
} from '../../src/worker/binary-resolver';

const roots: string[] = [];
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

function platformName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function platformDirectory(): string {
  if (process.platform === 'win32') return 'win32-x64';
  return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
}

function setResourcesPath(resourcesPath: string): void {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: resourcesPath,
  });
}

function makeExecutable(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, 'test binary');
  chmodSync(filePath, 0o755);
}

afterEach(() => {
  delete process.env['SERPENT_FFMPEG_PATH'];
  delete process.env['SERPENT_OIIO_PATH'];
  if (originalResourcesPath) {
    Object.defineProperty(process, 'resourcesPath', originalResourcesPath);
  } else {
    Reflect.deleteProperty(process, 'resourcesPath');
  }
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('media binary resolver', () => {
  it('prefers explicit environment overrides', () => {
    process.env['SERPENT_FFMPEG_PATH'] = path.join('/custom', platformName('ffmpeg'));
    process.env['SERPENT_OIIO_PATH'] = path.join('/custom', platformName('oiiotool'));

    expect(resolveFfmpegPath()).toBe(process.env['SERPENT_FFMPEG_PATH']);
    expect(resolveFfprobePath()).toBe(path.join('/custom', platformName('ffprobe')));
    expect(resolveOiiotoolPath()).toBe(process.env['SERPENT_OIIO_PATH']);
  });

  it('uses bundled binaries only when they exist and are executable', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-binaries-'));
    roots.push(root);
    setResourcesPath(root);
    const platform = platformDirectory();
    const ffmpeg = path.join(root, 'resources', 'ffmpeg', platform, platformName('ffmpeg'));
    const ffprobe = path.join(root, 'resources', 'ffmpeg', platform, platformName('ffprobe'));
    const oiiotool = path.join(root, 'resources', 'oiio', platform, platformName('oiiotool'));
    makeExecutable(ffmpeg);
    makeExecutable(ffprobe);
    makeExecutable(oiiotool);

    expect(resolveFfmpegPath()).toBe(ffmpeg);
    expect(resolveFfprobePath()).toBe(ffprobe);
    expect(resolveOiiotoolPath()).toBe(oiiotool);
  });

  it('falls back to PATH names for missing or non-executable bundled files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-binaries-'));
    roots.push(root);
    setResourcesPath(root);
    const ffmpeg = path.join(
      root,
      'resources',
      'ffmpeg',
      platformDirectory(),
      platformName('ffmpeg'),
    );
    mkdirSync(path.dirname(ffmpeg), { recursive: true });
    writeFileSync(ffmpeg, 'not executable');
    chmodSync(ffmpeg, 0o644);

    expect(resolveFfmpegPath()).toBe(platformName('ffmpeg'));
    expect(resolveFfprobePath()).toBe(platformName('ffprobe'));
    expect(resolveOiiotoolPath()).toBe(platformName('oiiotool'));
  });
});
