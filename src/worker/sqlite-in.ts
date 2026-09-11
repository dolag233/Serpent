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
