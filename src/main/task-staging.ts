import { lstat, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { errorHasCode, probeFreeBytes } from './disk-free-space';

export async function checkStagingSpace(
  root: string,
  requiredBytes: number,
  probe = probeFreeBytes,
): Promise<void> {
  const freeBytes = await probe(root);
  if (freeBytes !== undefined && freeBytes < requiredBytes) {
    throw Object.assign(new Error('Insufficient disk space for temporary files.'), { code: 'ENOSPC' });
  }
}

export async function removeTaskStaging(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

// Use a private root owned by the application profile. The caller decides
// which task names and ages are safe after startup.
export async function reapTaskStaging(
  root: string,
  name: RegExp,
  isAbandoned: (directory: string, modifiedAtMs: number) => boolean | Promise<boolean>,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    if (!(await lstat(root)).isDirectory()) return;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !name.test(entry.name)) continue;
      const target = path.join(root, entry.name);
      try {
        const stats = await lstat(target);
        if (stats.isDirectory() && await isAbandoned(target, stats.mtimeMs)) await removeTaskStaging(target);
      } catch (error) {
        if (!errorHasCode(error, 'ENOENT')) onError(error);
      }
    }
  } catch (error) {
    if (!errorHasCode(error, 'ENOENT')) onError(error);
  }
}
