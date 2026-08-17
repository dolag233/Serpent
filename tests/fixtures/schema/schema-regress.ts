/**
 * Serpent-verg.6 — schema regression helpers (0031 §3).
 *
 * Downgrade chain: a v33 library (with seed data) is structurally rewound to
 * a key version by reversing every object the later migrations added
 * (columns, tables, indexes, triggers), then reopened by the current build —
 * which must read it leniently (0031 §1) — and migrated back to latest with
 * the seed data intact.
 *
 * Table-rebuild migrations (v4/v6/v7/v14/v32) recreate a table in place; a
 * literal rewind would drop the table and its data, which the compatibility
 * guarantee forbids. For those boundaries the rewind keeps the rebuilt
 * structure and only reverses objects added AFTER the rebuild, so the test
 * still proves the incremental rewind path end-to-end.
 */
interface BetterSqlite3Database {
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): { run(...params: unknown[]): unknown };
}

interface MigrationObject {
  /** Reverse DDL executed last-first (indexes/triggers before columns/tables). */
  reverse: string[];
}

const CREATE_TABLE_RE = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
const CREATE_INDEX_RE = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
const CREATE_TRIGGER_RE = /CREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
const ALTER_ADD_COLUMN_RE = /ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+COLUMN\s+`?([A-Za-z0-9_]+)`?/gi;
const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;

/** Parse one migration's SQL into reverse-DROP statements. */
export function reverseMigrationObjects(sql: string): MigrationObject {
  const reverse: string[] = [];
  const tables: string[] = [];
  const indexes: string[] = [];
  const triggers: string[] = [];
  const addedColumns: Array<[string, string]> = [];
  // Tables a migration rebuilds in place (DROP+CREATE of the same name):
  // rewinding must NOT drop them (that would destroy their data) — the
  // re-upgrade re-runs the rebuild and recreates the table anyway.
  const rebuiltTables = new Set<string>();

  for (const match of sql.matchAll(CREATE_TABLE_RE)) {
    const table = match[1]!;
    if (!tables.includes(table)) tables.push(table);
  }
  for (const match of sql.matchAll(DROP_TABLE_RE)) rebuiltTables.add(match[1]!);
  for (const match of sql.matchAll(CREATE_INDEX_RE)) indexes.push(match[1]!);
  for (const match of sql.matchAll(CREATE_TRIGGER_RE)) triggers.push(match[1]!);
  for (const match of sql.matchAll(ALTER_ADD_COLUMN_RE)) {
    addedColumns.push([match[1]!, match[2]!]);
  }

  // Reverse order: drop indexes and triggers first, then columns, then tables.
  for (const name of indexes) reverse.push(`DROP INDEX IF EXISTS ${name}`);
  for (const name of triggers) reverse.push(`DROP TRIGGER IF EXISTS ${name}`);
  for (const [table, column] of addedColumns) {
    reverse.push(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  for (const table of tables) {
    if (!rebuiltTables.has(table)) reverse.push(`DROP TABLE IF EXISTS ${table}`);
  }
  return { reverse };
}

/**
 * Rewind `db` from `fromVersion` down to `targetVersion` by reversing every
 * migration above the target. Table-rebuild migrations are handled as
 * described in the header: their own objects are not dropped (that would
 * destroy data); only objects added afterwards are reversed.
 */
export function rewindSchema(
  db: BetterSqlite3Database,
  migrations: ReadonlyArray<{ version: number; sql: string }>,
  fromVersion: number,
  targetVersion: number,
): void {
  if (targetVersion >= fromVersion) return;
  const reverseStatements: string[] = [];
  // Reverse newest-first: objects added by later migrations must be dropped
  // before earlier migrations' columns/tables can be dropped.
  for (const migration of migrations.slice(targetVersion, fromVersion).reverse()) {
    const { reverse } = reverseMigrationObjects(migration.sql);
    reverseStatements.push(...reverse);
  }
  db.pragma('foreign_keys = OFF');
  for (const statement of reverseStatements) db.exec(statement);
  db.pragma('foreign_keys = ON');
  db.pragma(`user_version = ${targetVersion}`);
  db.prepare('DELETE FROM schema_migrations WHERE version > ?').run(targetVersion);
}
