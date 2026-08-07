/**
 * Serpent-verg.1 — lenient-read infrastructure (0031 §1).
 *
 * Read paths must tolerate structural drift between library schema versions:
 * a column a newer build added (or an older build removed) must not make the
 * running build fail to read the library. Every read query that matters is
 * turned into an explicit column whitelist; before executing, the whitelist is
 * intersected with the columns that actually exist (`PRAGMA table_info`,
 * cached per connection) and missing columns are filled with degraded
 * defaults instead of failing.
 *
 * Only read paths use this. Write paths stay strict: they write the columns
 * this build knows, and a structure mismatch surfaces as an explicit error
 * instead of silently writing to an unknown shape (0031 §1.2).
 */

/**
 * Minimal structural subset of the worker's DatabaseConnection. Kept local so
 * this module does not depend on library-service.ts (which imports it).
 */
interface ProbeConnection {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): { get(...parameters: unknown[]): unknown };
}

const EMPTY_COLUMNS: ReadonlySet<string> = new Set();

/**
 * Per-connection column metadata. Keyed by the connection object so several
 * libraries opened at once (tests, multi-instance) never cross-contaminate;
 * a closed connection is collected automatically. Invalidated explicitly
 * after a migration mutates the schema.
 */
let probeCache = new WeakMap<ProbeConnection, Map<string, ReadonlySet<string>>>();
let tableExistsCache = new WeakMap<ProbeConnection, Map<string, boolean>>();

/** Whether the table exists in this connection's schema. */
export function hasTable(connection: ProbeConnection, table: string): boolean {
  let known = tableExistsCache.get(connection);
  if (!known) {
    known = new Map();
    tableExistsCache.set(connection, known);
  }
  if (!known.has(table)) {
    const row = connection
      .prepare(
        'SELECT 1 AS present FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
      )
      .get('table', table) as { present: number } | undefined;
    known.set(table, row !== undefined);
  }
  return known.get(table)!;
}

/**
 * Columns that actually exist on `table` (empty set when the table is
 * missing). Cached per connection until invalidated.
 */
export function columnsFor(
  connection: ProbeConnection,
  table: string,
): ReadonlySet<string> {
  let tables = probeCache.get(connection);
  if (!tables) {
    tables = new Map();
    probeCache.set(connection, tables);
  }
  let columns = tables.get(table);
  if (!columns) {
    const rows = connection.pragma(`table_info(${table})`) as
      | Array<{ name: string }>
      | undefined;
    columns = rows ? new Set(rows.map((row) => row.name)) : EMPTY_COLUMNS;
    tables.set(table, columns);
  }
  return columns;
}

/**
 * The subset of `wanted` that exists on `table`, in `wanted` order. Read
 * queries build their SELECT/WHERE lists from this so missing columns are
 * simply never referenced.
 */
export function selectColumns(
  connection: ProbeConnection,
  table: string,
  wanted: readonly string[],
): string[] {
  const existing = columnsFor(connection, table);
  return wanted.filter((column) => existing.has(column));
}

/** The subset of `wanted` that does NOT exist on `table`. */
export function missingColumns(
  connection: ProbeConnection,
  table: string,
  wanted: readonly string[],
): string[] {
  const existing = columnsFor(connection, table);
  return wanted.filter((column) => !existing.has(column));
}

/**
 * Degraded defaults per column (0031 §1.1): a read result fills missing
 * columns with these so the feature degrades instead of crashing
 * (`asset.byte_size` missing → null → size is not displayed). The default for
 * any unlisted column is null ("unknown"); entries only exist where a
 * non-null default carries the degraded semantics.
 */
export const DEGRADED_COLUMN_DEFAULTS: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
> = {
  assets: {
    byte_size: null,
    display_name: null,
    file_hash: null,
    width: null,
    height: null,
  },
  revisions: {
    byte_size: null,
    width: null,
    height: null,
    duration_ms: null,
  },
  revision_artifacts: {
    kind: '',
    status: '',
    file_path: null,
  },
  tags: {
    color: null,
  },
  collections: {
    cover_asset_id: null,
  },
  smart_collections: {
    query_json: null,
  },
  asset_metadata: {
    value: null,
  },
  ai_content: {
    content: null,
  },
};

/**
 * Build the fill object for `missing` columns on `table` — { column: default }.
 * Unlisted columns degrade to null.
 */
export function degradedDefaults(
  table: string,
  missing: readonly string[],
): Record<string, unknown> {
  const tableDefaults = DEGRADED_COLUMN_DEFAULTS[table];
  const fill: Record<string, unknown> = {};
  for (const column of missing) {
    fill[column] = tableDefaults?.[column] ?? null;
  }
  return fill;
}

/**
 * Forget cached schema metadata for one connection. Call after a migration
 * mutates the schema so the next query re-probes.
 */
export function invalidateColumnProbe(connection: ProbeConnection): void {
  probeCache.delete(connection);
  tableExistsCache.delete(connection);
}

/** Forget all cached metadata (test isolation). */
export function resetColumnProbe(): void {
  probeCache = new WeakMap();
  tableExistsCache = new WeakMap();
}
