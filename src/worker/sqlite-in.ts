/**
 * SQLite bind parameters are limited per statement. Keep a little headroom
 * below the engine limit so an IN query can still bind fixed parameters for
 * joins, predicates, and ordering without becoming driver-dependent.
 */
export const SQLITE_IN_BIND_LIMIT = 900;

interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): { changes: number };
}

interface SqliteConnection {
  prepare(sql: string): SqliteStatement;
}

export function sqliteInChunks<T>(
  values: readonly T[],
  limit = SQLITE_IN_BIND_LIMIT,
): T[][] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('SQLite IN chunk limit must be a positive integer.');
  }
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += limit) {
    chunks.push([...values.slice(offset, offset + limit)]);
  }
  return chunks;
}

export function sqliteInPlaceholders(values: readonly unknown[]): string {
  if (values.length === 0) throw new RangeError('SQLite IN values must not be empty.');
  return values.map(() => '?').join(',');
}

export function sqliteAllInChunks<T, R>(input: {
  connection: SqliteConnection;
  values: readonly T[];
  buildSql: (placeholders: string) => string;
  bind?: (chunk: readonly T[]) => readonly unknown[];
}): R[] {
  const rows: R[] = [];
  const bind = input.bind ?? ((chunk: readonly T[]) => chunk);
  for (const chunk of sqliteInChunks(input.values)) {
    const placeholders = sqliteInPlaceholders(chunk);
    rows.push(
      ...(input.connection.prepare(input.buildSql(placeholders)).all(...bind(chunk)) as R[]),
    );
  }
  return rows;
}

export function sqliteRunInChunks<T>(input: {
  connection: SqliteConnection;
  values: readonly T[];
  buildSql: (placeholders: string) => string;
  bind?: (chunk: readonly T[]) => readonly unknown[];
}): number {
  let changes = 0;
  const bind = input.bind ?? ((chunk: readonly T[]) => chunk);
  for (const chunk of sqliteInChunks(input.values)) {
    const placeholders = sqliteInPlaceholders(chunk);
    changes += input.connection.prepare(input.buildSql(placeholders)).run(...bind(chunk)).changes;
  }
  return changes;
}

/**
 * Build an IN predicate for a single statement. Lists larger than the bind
 * limit are not inlined — callers must use `withSqliteInPredicate` so the
 * values live in a TEMP table instead of one giant parameter list.
 */
export function sqliteInPredicate(
  columnSql: string,
  values: readonly unknown[],
): { sql: string; params: unknown[] } {
  if (values.length === 0) return { sql: '0', params: [] };
  if (values.length > SQLITE_IN_BIND_LIMIT) {
    throw new RangeError(
      `SQLite IN lists above ${SQLITE_IN_BIND_LIMIT} values must use withSqliteInPredicate.`,
    );
  }
  return {
    sql: `${columnSql} IN (${sqliteInPlaceholders(values)})`,
    params: [...values],
  };
}

let sqliteInTableSeq = 0;

function sqliteTempTableName(): string {
  sqliteInTableSeq += 1;
  return `_serpent_in_${sqliteInTableSeq}`;
}

/**
 * Run a query whose IN list may exceed the per-statement bind limit.
 * Small lists stay inline; large lists are inserted into a TEMP table.
 */
export function withSqliteInPredicate<R>(
  connection: SqliteConnection,
  columnSql: string,
  values: readonly unknown[],
  execute: (predicateSql: string, params: unknown[]) => R,
  options?: { forceTable?: boolean },
): R {
  if (values.length === 0) return execute('0', []);
  if (values.length <= SQLITE_IN_BIND_LIMIT && options?.forceTable !== true) {
    return execute(`${columnSql} IN (${sqliteInPlaceholders(values)})`, [...values]);
  }
  const tableName = sqliteTempTableName();
  connection.prepare(
    `CREATE TEMP TABLE ${tableName} (id TEXT NOT NULL PRIMARY KEY)`,
  ).run();
  try {
    for (const chunk of sqliteInChunks(values)) {
      connection.prepare(
        `INSERT OR IGNORE INTO ${tableName} (id) VALUES ${chunk.map(() => '(?)').join(',')}`,
      ).run(...chunk);
    }
    return execute(`${columnSql} IN (SELECT id FROM ${tableName})`, []);
  } finally {
    connection.prepare(`DROP TABLE IF EXISTS ${tableName}`).run();
  }
}
