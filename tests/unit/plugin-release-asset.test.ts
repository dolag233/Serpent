import { describe, expect, it } from 'vitest';

import {
  currentPluginPlatformToken,
  parsePluginReleaseAssetFileName,
  selectPluginReleaseAsset,
} from '../../src/plugins/plugin-release-asset';
import {
  isGitHubPluginInstallUrl,
  parseGitHubRepositoryUrl,
} from '../../src/shared/plugin-github-url';

describe('plugin release asset naming', () => {
  it('parses normative Release asset file names', () => {
    expect(parsePluginReleaseAssetFileName('com.example.image-upscaler-1.2.0-darwin-arm64.zip')).toEqual({
      pluginId: 'com.example.image-upscaler',
      version: '1.2.0',
      platformToken: 'darwin-arm64',
      fileName: 'com.example.image-upscaler-1.2.0-darwin-arm64.zip',
    });
    expect(parsePluginReleaseAssetFileName('com.example.palette-tools-2.0.1-any.zip')?.platformToken).toBe('any');
    expect(parsePluginReleaseAssetFileName('readme.txt')).toBeUndefined();
  });

  it('prefers exact platform then any', () => {
    const assets = [
      { name: 'com.example.palette-tools-1.0.0-win32-x64.zip' },
      { name: 'com.example.palette-tools-1.0.0-any.zip' },
      { name: 'com.example.palette-tools-1.0.0-darwin-arm64.zip' },
    ];
    expect(selectPluginReleaseAsset(assets, 'darwin-arm64')?.name).toContain('darwin-arm64');
    expect(selectPluginReleaseAsset(assets, 'linux-x64')?.name).toContain('-any.zip');
    expect(selectPluginReleaseAsset([
      { name: 'com.example.palette-tools-1.0.0-win32-x64.zip' },
    ], 'darwin-arm64')).toBeUndefined();
  });

  it('exposes the current host platform token', () => {
    expect(currentPluginPlatformToken('darwin', 'arm64')).toBe('darwin-arm64');
    expect(currentPluginPlatformToken('win32', 'x64')).toBe('win32-x64');
  });
});

describe('GitHub plugin install URLs', () => {
  it('accepts repository and Release page URLs', () => {
    expect(parseGitHubRepositoryUrl('https://github.com/owner/repo')).toMatchObject({
      repository: 'https://github.com/owner/repo',
      preferLatestRelease: true,
    });
    expect(parseGitHubRepositoryUrl('https://github.com/owner/repo/releases/tag/v1.2.0')).toMatchObject({
      preferredTag: 'v1.2.0',
      preferLatestRelease: false,
    });
    expect(isGitHubPluginInstallUrl('https://github.com/owner/repo/releases/latest')).toBe(true);
    expect(isGitHubPluginInstallUrl('https://example.com/owner/repo')).toBe(false);
  });
});
