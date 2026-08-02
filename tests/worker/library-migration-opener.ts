import { existsSync } from 'node:fs';

import { LibraryService } from '../../src/worker/library-service';

const libraryPath = process.env.SERPENT_MIGRATION_LIBRARY_PATH;
const childId = process.env.SERPENT_MIGRATION_CHILD_ID;
const releasePath = process.env.SERPENT_MIGRATION_RELEASE_PATH;

if (!libraryPath || !childId || !releasePath) {
  throw new Error('Migration opener test environment is incomplete.');
}
const migrationReleasePath = releasePath;
const migrationLibraryPath = libraryPath;

function emit(type: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ type, ...extra })}\n`);
}

function waitForRelease(): void {
  const waitState = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(migrationReleasePath)) Atomics.wait(waitState, 0, 0, 10);
}

const service = new LibraryService({
  afterSchemaMigrationTransactionBegin: () => {
    emit('entered');
    if (childId === 'first') waitForRelease();
  },
  beforeSchemaMigrationTransaction: () => emit('pre'),
  sqliteBusyTimeoutMsForTests: 5_000,
});

try {
  const summary = service.openLibrary(migrationLibraryPath);
  emit('success', { libraryId: summary.libraryId });
} catch (error) {
  emit('failure', {
    code: typeof error === 'object' && error !== null && 'code' in error &&
        typeof error.code === 'string' ? error.code : 'UNKNOWN',
    name: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
} finally {
  service.closeAll();
}
