import { LibraryServiceError, type LibraryService } from './library-service';

/** A destructive command must not proceed with an unverified safety snapshot. */
export async function requireVerifiedDestructiveBackup(
  service: LibraryService,
  libraryId: string,
): Promise<void> {
  if (!await service.createDatabaseBackup(libraryId)) {
    throw new LibraryServiceError('LIBRARY_BACKUP_FAILED');
  }
}

/**
 * Keep cooperating writers out between the snapshot and a destructive
 * command. The backup yields to the event loop, so its lease needs a heartbeat.
 */
export async function runWithVerifiedDestructiveBackup<T>(
  service: LibraryService,
  libraryId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lease = await service.acquireWriteLease(libraryId);
  let heartbeat: ReturnType<typeof lease.startHeartbeat> | undefined;
  try {
    heartbeat = lease.startHeartbeat();
    await requireVerifiedDestructiveBackup(service, libraryId);
    if (heartbeat.error) throw heartbeat.error;
    lease.assertCurrent();
    return await operation();
  } finally {
    heartbeat?.stop();
    try {
      lease.release();
    } catch (error) {
      service.reportDiagnostic('destructive-backup.lease-release', error, { libraryId });
    }
  }
}
