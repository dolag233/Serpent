import { describe, expect, it } from 'vitest';

import {
  classifyLibraryStorage,
  isNetworkStoragePath,
  isWindowsNetworkPath,
} from '../../src/worker/network-storage';

describe('network storage detection', () => {
  it('recognizes a macOS SMB mount and prefers the longest matching mount point', () => {
    const mountOutput = [
      '/dev/disk3s1 on / (apfs, local, journaled)',
      '//nas/shared on /Volumes/Working (smbfs, nodev, nosuid)',
      '//nas/shared on /Volumes/Working/Project (smbfs, nodev, nosuid)',
    ].join('\n');

    expect(classifyLibraryStorage('/Volumes/Working/Project/.serpent/library.db', {
      platform: 'darwin',
      mountOutput,
    })).toBe('network');
    expect(isNetworkStoragePath('/Volumes/Working/assets/file.png', {
      platform: 'darwin',
      mountOutput,
    })).toBe(true);
    expect(classifyLibraryStorage('/Users/test/library/.serpent/library.db', {
      platform: 'darwin',
      mountOutput,
    })).toBe('local');
  });

  it('unescapes mount points containing spaces', () => {
    expect(classifyLibraryStorage('/Volumes/NAS Work/Library/.serpent/library.db', {
      platform: 'darwin',
      mountOutput: '//nas/shared on /Volumes/NAS\\040Work (smbfs, nodev)',
    })).toBe('network');
  });

  it('recognizes Linux mount entries with an explicit type token', () => {
    const mountOutput = [
      '/dev/nvme0n1p2 on / type ext4 (rw,relatime)',
      'nas.example:/assets on /mnt/assets type nfs4 (rw,relatime,vers=4.2)',
    ].join('\n');

    expect(classifyLibraryStorage('/mnt/assets/Library/.serpent/library.db', {
      platform: 'linux',
      mountOutput,
    })).toBe('network');
    expect(classifyLibraryStorage('/var/lib/serpent/library/.serpent/library.db', {
      platform: 'linux',
      mountOutput,
    })).toBe('local');
  });

  it('recognizes Windows UNC and extended UNC paths', () => {
    expect(isWindowsNetworkPath('\\\\server\\share\\Library')).toBe(true);
    expect(isWindowsNetworkPath('\\\\?\\UNC\\server\\share\\Library')).toBe(true);
    expect(classifyLibraryStorage('\\\\server\\share\\Library\\.serpent\\library.db', {
      platform: 'win32',
    })).toBe('network');
  });

  it('recognizes mapped Windows network drives through GetDriveTypeW', () => {
    expect(classifyLibraryStorage('Z:\\Library\\.serpent\\library.db', {
      platform: 'win32',
      getDriveType: (rootPath) => rootPath === 'Z:\\' ? 4 : 3,
    })).toBe('network');
    expect(classifyLibraryStorage('C:\\Library\\.serpent\\library.db', {
      platform: 'win32',
      getDriveType: (rootPath) => rootPath === 'C:\\' ? 3 : 4,
    })).toBe('local');
  });
});
