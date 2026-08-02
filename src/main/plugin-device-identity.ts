import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Kept in userData only; library sync must never carry this identity. */
export const PLUGIN_DEVICE_ID_FILE_NAME = 'plugin-device-id';

const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Returns a stable identifier for this local Serpent profile. A corrupt or
 * missing value gets replaced, intentionally invalidating local trust rather
 * than sharing it through a resource library.
 */
export async function loadOrCreatePluginDeviceId(userDataDirectory: string): Promise<string> {
  const filePath = path.join(userDataDirectory, PLUGIN_DEVICE_ID_FILE_NAME);
  try {
    const existing = (await readFile(filePath, 'utf8')).trim();
    if (DEVICE_ID_PATTERN.test(existing)) return existing.toLowerCase();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const deviceId = randomUUID();
  const stagingPath = `${filePath}.staging-${randomUUID()}`;
  await mkdir(userDataDirectory, { recursive: true });
  try {
    await writeFile(stagingPath, `${deviceId}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(stagingPath, filePath);
  } finally {
    await rm(stagingPath, { force: true });
  }
  return deviceId;
}
