/**
 * Serpent-verg.5 — migration failure diagnosis and retry (0031 §2.2).
 *
 * A failed migration rolls back (per-migration transaction) leaving the
 * library intact at its previous version, but blindly retrying forever would
 * spin the open path on a library that can never migrate. This module keeps
 * a `.serpent/migration-failed.json` record per library: the open path reads
 * it before migrating, retries with a 3-attempt cap, and after the cap opens
 * the library in read-only degrade mode (lenient read) instead of throwing.
 *
 * verifyMigrationHistory failures (checksum mismatch = damaged history) are
 * NOT recorded here: they stay LIBRARY_CORRUPT and are never retried.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MAX_MIGRATION_ATTEMPTS = 3;

export interface MigrationFailureRecord {
  fromVersion: number;
  toVersion: number;
  /** Public error code of the failure (e.g. LIBRARY_MIGRATION_FAILED). */
  error: string;
  attemptedAt: string;
  attempts: number;
  /**
   * The build's supported schema version when the failure was recorded.
   * The stuck latch only holds while this matches the current build: after a
   * Serpent upgrade the migration is retried once, so a newer build can
   * recover a library the old build could not migrate (0031 §2.2 "失败可恢复").
   */
  supportedSchemaVersion?: number;
}

export function migrationFailurePath(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'migration-failed.json');
}

/** Read the failure record; missing/corrupt files count as no record. */
export function readMigrationFailure(libraryPath: string): MigrationFailureRecord | null {
  const filePath = migrationFailurePath(libraryPath);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<MigrationFailureRecord>;
    if (
      typeof parsed.fromVersion !== 'number' ||
      typeof parsed.toVersion !== 'number' ||
      typeof parsed.error !== 'string' ||
      typeof parsed.attemptedAt !== 'string' ||
      typeof parsed.attempts !== 'number'
    ) {
      return null;
    }
    return parsed as MigrationFailureRecord;
  } catch {
    return null;
  }
}

/** Record (or bump) a migration failure; returns the updated record. */
export function recordMigrationFailure(
  libraryPath: string,
  fromVersion: number,
  toVersion: number,
  error: string,
  now = new Date(),
  supportedSchemaVersion?: number,
): MigrationFailureRecord {
  const previous = readMigrationFailure(libraryPath);
  const record: MigrationFailureRecord = {
    fromVersion,
    toVersion,
    error,
    attemptedAt: now.toISOString(),
    attempts: (previous?.attempts ?? 0) + 1,
    // Records written before the build-version latch existed carry no
    // supportedSchemaVersion; readers treat that as "current build" so the
    // existing latch behaviour is preserved for them.
    supportedSchemaVersion: supportedSchemaVersion ?? previous?.supportedSchemaVersion,
  };
  const filePath = migrationFailurePath(libraryPath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(record, null, 2));
  return record;
}

/** Remove the failure record after a successful migration. */
export function clearMigrationFailure(libraryPath: string): void {
  const filePath = migrationFailurePath(libraryPath);
  if (existsSync(filePath)) rmSync(filePath);
}
