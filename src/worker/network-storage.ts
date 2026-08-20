import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type * as Koffi from 'koffi';

type KoffiModule = typeof Koffi;

/**
 * The storage classification is deliberately conservative. Only a confirmed
 * local file system keeps SQLite's WAL defaults; confirmed network and
 * unknown volumes use rollback journaling because an unrecognized mount must
 * not silently opt into WAL's network-file-system assumptions.
 */
export type LibraryStorageKind = 'local' | 'network' | 'unknown';

export interface LibraryStorageDetectionOptions {
  /** Pure-function seam for platform coverage on a non-native test host. */
  platform?: NodeJS.Platform;
  /** Supplied mount table; production reads the platform mount command. */
  mountOutput?: string;
  /** Pure-function seam for Windows GetDriveTypeW. */
  getDriveType?: (rootPath: string) => number | null;
}

const WINDOWS_REMOTE_DRIVE_TYPE = 4;
const NETWORK_FILE_SYSTEM_TYPES = new Set([
  '9p',
  'afp',
  'cifs',
  'davfs',
  'fuse.sshfs',
  'nfs',
  'nfs4',
  'smbfs',
  'sshfs',
  'webdav',
]);
const LOCAL_FILE_SYSTEM_TYPES = new Set([
  'apfs',
  'btrfs',
  'exfat',
  'ext2',
  'ext3',
  'ext4',
  'fat',
  'hfs',
  'hfs+',
  'msdos',
  'ntfs',
  'overlay',
  'tmpfs',
  'ufs',
  'xfs',
]);

let windowsDriveTypeReader: ((rootPath: string) => number | null) | null | undefined;

function stripWindowsExtendedPrefix(input: string): string {
  const normalized = input.replaceAll('/', '\\');
  if (/^\\\\\?\\unc\\/iu.test(normalized)) {
    return `\\\\${normalized.slice('\\\\?\\UNC\\'.length)}`;
  }
  if (/^\\\\\?\\/u.test(normalized)) {
    return normalized.slice('\\\\?\\'.length);
  }
  return normalized;
}

/** UNC paths are network paths even before the target is mounted or opened. */
export function isWindowsNetworkPath(input: string): boolean {
  const normalized = stripWindowsExtendedPrefix(input);
  return /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(normalized);
}

function windowsDriveRoot(input: string): string | null {
  const normalized = stripWindowsExtendedPrefix(input);
  const root = path.win32.parse(normalized).root;
  return /^[A-Za-z]:\\$/u.test(root) ? root : null;
}

function loadWindowsDriveTypeReader(): ((rootPath: string) => number | null) | null {
  if (windowsDriveTypeReader !== undefined) return windowsDriveTypeReader;
  if (process.platform !== 'win32') {
    windowsDriveTypeReader = null;
    return null;
  }
  try {
    // Koffi is already an externalized, pure-NAPI dependency used by the
    // Windows Main process. Keep the import lazy so macOS never loads Win32.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as KoffiModule;
    const kernel32 = koffi.load('kernel32.dll');
    const getDriveType = kernel32.func(
      'uint32 GetDriveTypeW(str16 lpRootPathName)',
    ) as unknown as (rootPath: string) => number;
    windowsDriveTypeReader = (rootPath) => {
      try {
        return getDriveType(rootPath);
      } catch {
        return null;
      }
    };
  } catch {
    windowsDriveTypeReader = null;
  }
  return windowsDriveTypeReader;
}

function readMountOutput(platform: NodeJS.Platform): string | null {
  const command = platform === 'darwin' ? '/sbin/mount' : '/bin/mount';
  try {
    return execFileSync(command, [], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 750,
    });
  } catch {
    return null;
  }
}

function unescapeMountPath(input: string): string {
  return input.replace(/\\([0-7]{3})/gu, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)));
}

function pathIsWithinMount(pathname: string, mountPoint: string): boolean {
  const candidate = path.normalize(pathname);
  const mount = path.normalize(mountPoint);
  const relative = path.relative(mount, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Parse the human-readable macOS/Linux mount formats:
 * `source on /mount/point (smbfs, nodev, ...)` (macOS) and
 * `source on /mount/point type nfs4 (rw, ...)` (Linux).
 * The longest matching mount point wins for nested mounts.
 */
function classifyMount(pathname: string, mountOutput: string): LibraryStorageKind {
  const matches: Array<{ mountPoint: string; fileSystemType: string }> = [];
  for (const line of mountOutput.split(/\r?\n/u)) {
    const match = /^.+?\s+on\s+(.+?)(?:\s+type\s+([^\s(]+))?\s+\(([^,\s)]+)/u.exec(line);
    if (!match) continue;
    matches.push({
      mountPoint: unescapeMountPath(match[1]!),
      fileSystemType: (match[2] ?? match[3]!).toLowerCase(),
    });
  }
  matches.sort((left, right) => right.mountPoint.length - left.mountPoint.length);
  const matchingMount = matches.find(({ mountPoint }) =>
    pathIsWithinMount(pathname, mountPoint));
  if (matchingMount === undefined) return 'unknown';
  if (NETWORK_FILE_SYSTEM_TYPES.has(matchingMount.fileSystemType)) return 'network';
  if (LOCAL_FILE_SYSTEM_TYPES.has(matchingMount.fileSystemType)) return 'local';
  return 'unknown';
}

/**
 * Classify a library path without touching its contents. This is used before
 * the database is opened, so it also works for a new library's temporary
 * creation directory on an already-mounted NAS volume.
 */
export function classifyLibraryStorage(
  pathname: string,
  options: LibraryStorageDetectionOptions = {},
): LibraryStorageKind {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    if (isWindowsNetworkPath(pathname)) return 'network';
    const root = windowsDriveRoot(pathname);
    if (!root) return 'unknown';
    const driveType = options.getDriveType?.(root)
      ?? loadWindowsDriveTypeReader()?.(root);
    if (driveType === WINDOWS_REMOTE_DRIVE_TYPE) return 'network';
    if (driveType === 2 || driveType === 3 || driveType === 5 || driveType === 6) {
      return 'local';
    }
    return 'unknown';
  }

  if (platform === 'darwin' || platform === 'linux') {
    const mountOutput = options.mountOutput ?? readMountOutput(platform);
    return mountOutput === null ? 'unknown' : classifyMount(pathname, mountOutput);
  }

  return 'unknown';
}

export function isNetworkStoragePath(
  pathname: string,
  options: LibraryStorageDetectionOptions = {},
): boolean {
  return classifyLibraryStorage(pathname, options) === 'network';
}
