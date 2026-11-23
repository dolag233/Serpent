/** Frozen v61 migration text. Future changes require a new migration. */
const V61_MEDIA_KINDS_SQL = `'generate_thumbnail', 'generate_video_poster', 'extract_metadata',
  'generate_contact_sheet', 'generate_webm_proxy', 'generate_audio_proxy', 'extract_palette'`;

export const MEDIA_QUEUE_CONTROL_SCHEMA_SQL = `
ALTER TABLE library ADD COLUMN media_queue_paused INTEGER NOT NULL DEFAULT 0
  CHECK (media_queue_paused IN (0, 1));
ALTER TABLE jobs ADD COLUMN media_admission_origin TEXT NOT NULL DEFAULT 'automatic'
  CHECK (media_admission_origin IN ('automatic', 'explicit'));
CREATE INDEX jobs_explicit_media_queue ON jobs(library_id, status)
  WHERE media_admission_origin = 'explicit';

CREATE TRIGGER media_pause_blocks_automatic_insert
BEFORE INSERT ON jobs
WHEN NEW.kind IN (${V61_MEDIA_KINDS_SQL})
  AND NEW.status IN ('queued', 'running')
  AND NEW.media_admission_origin = 'automatic'
  AND EXISTS (SELECT 1 FROM library WHERE library_id = NEW.library_id AND media_queue_paused = 1)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER media_pause_blocks_automatic_requeue
BEFORE UPDATE OF status, media_admission_origin ON jobs
WHEN NEW.kind IN (${V61_MEDIA_KINDS_SQL})
  AND NEW.status IN ('queued', 'running')
  AND NEW.media_admission_origin = 'automatic'
  AND EXISTS (SELECT 1 FROM library WHERE library_id = NEW.library_id AND media_queue_paused = 1)
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TRIGGER media_terminal_revokes_explicit_admission
AFTER UPDATE OF status ON jobs
WHEN NEW.kind IN (${V61_MEDIA_KINDS_SQL})
  AND NEW.status IN ('succeeded', 'failed', 'cancelled')
  AND NEW.media_admission_origin = 'explicit'
BEGIN
  UPDATE jobs SET media_admission_origin = 'automatic' WHERE job_id = NEW.job_id;
END;
`;

type QueueConnection = {
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number };
  };
  transaction<T>(operation: () => T): () => T;
};

/** Replayed additive tails may already contain the two current columns. */
export function ensureMediaQueueControlSchema(connection: QueueConnection & { exec(sql: string): void }): void {
  // These are the first two statements of the frozen v61 SQL, not a general
  // SQL parser. Deriving them keeps canonical history/checksums unchanged.
  const firstEnd = MEDIA_QUEUE_CONTROL_SCHEMA_SQL.indexOf(';');
  const secondEnd = MEDIA_QUEUE_CONTROL_SCHEMA_SQL.indexOf(';', firstEnd + 1);
  const hasColumn = (table: 'library' | 'jobs', column: string) => connection
    .prepare(`PRAGMA table_info(${table})`).all().some(row => (row as { name: string }).name === column);
  if (!hasColumn('library', 'media_queue_paused')) {
    connection.exec(MEDIA_QUEUE_CONTROL_SCHEMA_SQL.slice(0, firstEnd + 1));
  }
  if (!hasColumn('jobs', 'media_admission_origin')) {
    connection.exec(MEDIA_QUEUE_CONTROL_SCHEMA_SQL.slice(firstEnd + 1, secondEnd + 1));
  }
  connection.exec(MEDIA_QUEUE_CONTROL_SCHEMA_SQL.slice(secondEnd + 1)
    .replaceAll('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
    .replaceAll('CREATE TRIGGER ', 'CREATE TRIGGER IF NOT EXISTS '));
}

/** One control per open handle; only the Library Worker writes this mode. */
export class MediaQueueControl {
  #paused: boolean;

  constructor(
    private readonly connection: QueueConnection,
    private readonly libraryId: string,
    readonly supported: boolean,
  ) {
    this.#paused = supported && (connection.prepare(
      'SELECT media_queue_paused FROM library WHERE library_id = ?',
    ).get(libraryId) as { media_queue_paused: number } | undefined)?.media_queue_paused === 1;
  }

  isPaused(): boolean { return this.#paused; }

  /** Publish the mode only after both the flag and row changes commit. */
  change<T>(paused: boolean, updateJobs: () => T): T {
    const result = this.connection.transaction(() => {
      if (this.supported) {
        this.connection.prepare(
          'UPDATE library SET media_queue_paused = ? WHERE library_id = ?',
        ).run(paused ? 1 : 0, this.libraryId);
      }
      return updateJobs();
    })();
    this.#paused = this.supported && paused;
    return result;
  }
}
