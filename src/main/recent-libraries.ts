import {
  chmodSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  RECENT_LIBRARIES_LIMIT,
  recentLibraryEntrySchema,
  type RecentLibraryEntry,
} from '../shared/recent-libraries';

/**
 * Recent libraries store (`<userData>/recent-library.json`).
 *
 * Schema v2: `{ version: 2, activePath, libraries: [{ path, name, lastOpenedAt }] }`.
 * - `libraries` is most-recent-first, deduped by path, capped at 8 entries.
 * - `activePath` records the last successful open for diagnostics and the
 *   explicit restore path used by isolated E2E runs. Production startup does
 *   not open it automatically: the user always gets a live library switcher.
 *
 * Schema v1 files (`{ version: 1, libraryPath, updatedAt }`) are migrated
 * transparently on read: the single library becomes the first entry (name from
 * the path basename until the next open re-stamps it with the display name) and
 * stays the active-path hint, because a v1 file only existed while that
 * library was open at quit.
 *
 * This module is Electron-free so vitest can exercise it directly; callers pass
 * the absolute store file path.
 */

const recentLibraryFileV1Schema = z.strictObject({
  version: z.literal(1),
  libraryPath: z.string(),
  updatedAt: z.string(),
});

const recentLibraryFileV2Schema = z.strictObject({
  version: z.literal(2),
  activePath: z.string().nullable(),
  libraries: z.array(recentLibraryEntrySchema),
});

type RecentLibraryFileV2 = z.infer<typeof recentLibraryFileV2Schema>;

type ErrorSink = ((error: unknown) => void) | undefined;

export function recentLibraryPersistenceEnabled(): boolean {
  return (
    process.env.SERPENT_E2E !== '1' ||
    process.env.SERPENT_E2E_RESTORE_RECENT === '1'
  );
}

/**
 * Automatic restore is deliberately opt-in for isolated lifecycle tests. A
 * broken, disconnected, or incompatible library must never block the normal
 * startup surface before the user can choose another library.
 */
export function recentLibraryAutoOpenEnabled(): boolean {
  return process.env.SERPENT_E2E === '1' && process.env.SERPENT_E2E_RESTORE_RECENT === '1';
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function migrateV1(parsed: z.infer<typeof recentLibraryFileV1Schema>): RecentLibraryFileV2 {
  if (!path.isAbsolute(parsed.libraryPath)) {
    return { version: 2, activePath: null, libraries: [] };
  }
  return {
    version: 2,
    activePath: parsed.libraryPath,
    libraries: [
      {
        path: parsed.libraryPath,
        name: path.basename(parsed.libraryPath),
        lastOpenedAt: parsed.updatedAt,
      },
    ],
  };
}

function parseRecentLibraryFile(raw: string): RecentLibraryFileV2 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const v2 = recentLibraryFileV2Schema.safeParse(parsed);
  if (v2.success) {
    return {
      version: 2,
      activePath:
        v2.data.activePath && path.isAbsolute(v2.data.activePath)
          ? v2.data.activePath
          : null,
      libraries: v2.data.libraries
        .filter((entry) => path.isAbsolute(entry.path))
        .slice(0, RECENT_LIBRARIES_LIMIT),
    };
  }
  const v1 = recentLibraryFileV1Schema.safeParse(parsed);
  return v1.success ? migrateV1(v1.data) : null;
}

function readRecentLibraryFile(
  filePath: string,
  onError?: ErrorSink,
): RecentLibraryFileV2 | null {
  try {
    return parseRecentLibraryFile(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (!isNotFound(error)) onError?.(error);
    return null;
  }
}

function writeRecentLibraryFile(
  filePath: string,
  data: RecentLibraryFileV2,
  onError?: ErrorSink,
): boolean {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(data), {
      encoding: 'utf8',
      mode: 0o600,
      flush: true,
    });
    renameSync(temporary, filePath);
    chmodSync(filePath, 0o600);
    return true;
  } catch (error) {
    onError?.(error);
    try {
      unlinkSync(temporary);
    } catch {
      // Best-effort cleanup; the original write failure is already reported.
    }
    return false;
  }
}

function upsertEntry(
  entries: RecentLibraryEntry[],
  entry: RecentLibraryEntry,
): RecentLibraryEntry[] {
  return [
    entry,
    ...entries.filter((existing) => existing.path !== entry.path),
  ].slice(0, RECENT_LIBRARIES_LIMIT);
}

/** Lists the known libraries, most recently opened first. */
export function readRecentLibraryEntries(
  filePath: string,
  onError?: ErrorSink,
): RecentLibraryEntry[] {
  if (!recentLibraryPersistenceEnabled()) return [];
  return readRecentLibraryFile(filePath, onError)?.libraries ?? [];
}

/** Returns the stored active-path hint, or null. */
export function readActiveLibraryPath(
  filePath: string,
  onError?: ErrorSink,
): string | null {
  if (!recentLibraryPersistenceEnabled()) return null;
  return readRecentLibraryFile(filePath, onError)?.activePath ?? null;
}

/**
 * Records a successful library open: bumps the entry to the front (deduped by
 * path, re-stamped name + timestamp), caps the list, and marks it as the
 * active-path hint. Returns the persisted list (empty when persistence is
 * gated off or the write failed).
 */
export function rememberRecentLibrary(
  filePath: string,
  entry: { path: string; name: string; libraryId?: string },
  options?: { now?: Date; onError?: ErrorSink },
): RecentLibraryEntry[] {
  if (!recentLibraryPersistenceEnabled()) return [];
  const next: RecentLibraryEntry = {
    ...(entry.libraryId === undefined ? {} : { libraryId: entry.libraryId }),
    path: entry.path,
    name: entry.name,
    lastOpenedAt: (options?.now ?? new Date()).toISOString(),
  };
  const current = readRecentLibraryFile(filePath, options?.onError) ?? {
    version: 2 as const,
    activePath: null,
    libraries: [],
  };
  const libraries = upsertEntry(current.libraries, next);
  if (
    !writeRecentLibraryFile(
      filePath,
      { version: 2, activePath: entry.path, libraries },
      options?.onError,
    )
  ) {
    return [];
  }
  return libraries;
}

/**
 * Clears the restart-restore target on explicit library close while keeping
 * the library in the recent list so it stays reachable from 其他资源库.
 */
export function clearActiveRecentLibrary(
  filePath: string,
  onError?: ErrorSink,
): void {
  if (!recentLibraryPersistenceEnabled()) return;
  const current = readRecentLibraryFile(filePath, onError);
  if (!current) return;
  writeRecentLibraryFile(filePath, { ...current, activePath: null }, onError);
}

/**
 * Removes a library path from the recent list after disk deletion (Serpent-9i8).
 * Also clears activePath when it pointed at the deleted library.
 */
export function removeRecentLibrary(
  filePath: string,
  libraryPath: string,
  onError?: ErrorSink,
): void {
  if (!recentLibraryPersistenceEnabled()) return;
  const current = readRecentLibraryFile(filePath, onError);
  if (!current) return;
  const libraries = current.libraries.filter((entry) => entry.path !== libraryPath);
  const activePath =
    current.activePath === libraryPath ? null : current.activePath;
  writeRecentLibraryFile(
    filePath,
    { version: 2, activePath, libraries },
    onError,
  );
}
