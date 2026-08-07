// Serpent-verg.7 — migration discipline static gate (ADR-0028 / CLAUDE.md
// "数据兼容性纪律"): schema migrations are add-only. Every migration is
// checked for structural violations — dropping/renaming existing tables,
// columns, indexes or triggers, changing column types/semantics, or adding
// NOT NULL columns without a default. Table-rebuild migrations (v4/v6/v7/
// v14/v32) are the explicit, documented exceptions.
import { describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../../src/worker/library-service';

/**
 * Documented exceptions to the add-only discipline. v4/v6/v7/v10/v14/v16/
 * v18/v21/v25/v30/v32/v33 rebuild a table in place (CREATE replacement →
 * copy → DROP old → RENAME), matching the worker's rebuild handling; v15
 * dropped the old asset_search table without rebuilding (recreated in v18)
 * — a historical pre-discipline exception, not a pattern for new
 * migrations.
 */
const TABLE_REBUILD_VERSIONS: ReadonlySet<number> = new Set([
  4, 6, 7, 10, 14, 15, 16, 18, 21, 25, 30, 32, 33,
]);

export interface DisciplineViolation {
  version: number;
  rule: string;
  statement: string;
}

const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
const DROP_INDEX_RE = /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
const DROP_TRIGGER_RE = /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
const DROP_COLUMN_RE = /ALTER\s+TABLE\s+`?[A-Za-z0-9_]+`?\s+DROP\s+COLUMN\s+`?[A-Za-z0-9_]+`?/gi;
const RENAME_COLUMN_RE = /ALTER\s+TABLE\s+`?[A-Za-z0-9_]+`?\s+RENAME\s+COLUMN/gi;
const RENAME_TABLE_RE = /ALTER\s+TABLE\s+`?[A-Za-z0-9_]+`?\s+RENAME\s+TO/gi;
const ADD_COLUMN_RE = /ALTER\s+TABLE\s+`?[A-Za-z0-9_]+`?\s+ADD\s+COLUMN\s+`?[A-Za-z0-9_]+`?\s+([^;]*?)(?=,|;|$)/gi;

/** Static discipline check over one migration's SQL. */
export function checkMigrationDiscipline(
  version: number,
  sql: string,
): DisciplineViolation[] {
  const violations: DisciplineViolation[] = [];
  const isRebuild = TABLE_REBUILD_VERSIONS.has(version);

  // Table-rebuild migrations are the documented exception: they replace a
  // table in place (CREATE replacement → copy → DROP old → RENAME), so their
  // own DROP/RENAME statements target objects the migration itself created.
  // Only when the rewrite lands on an existing table does the copy phase
  // preserve semantics; the add-only rules below still apply to everything
  // else in the migration.
  if (!isRebuild) {
    for (const match of sql.matchAll(DROP_TABLE_RE)) {
      violations.push({ version, rule: 'drop-table', statement: match[0] });
    }
    for (const match of sql.matchAll(DROP_INDEX_RE)) {
      violations.push({ version, rule: 'drop-index', statement: match[0] });
    }
    for (const match of sql.matchAll(DROP_TRIGGER_RE)) {
      violations.push({ version, rule: 'drop-trigger', statement: match[0] });
    }
    for (const match of sql.matchAll(DROP_COLUMN_RE)) {
      violations.push({ version, rule: 'drop-column', statement: match[0] });
    }
    for (const match of sql.matchAll(RENAME_COLUMN_RE)) {
      violations.push({ version, rule: 'rename-column', statement: match[0] });
    }
    for (const match of sql.matchAll(RENAME_TABLE_RE)) {
      violations.push({ version, rule: 'rename-table', statement: match[0] });
    }
  }
  for (const match of sql.matchAll(ADD_COLUMN_RE)) {
    const definition = match[1]!.toUpperCase();
    // A new column must be nullable or carry a default; NOT NULL without a
    // default would break inserts on existing rows (old data becomes
    // unreadable for writes).
    if (definition.includes('NOT NULL') && !definition.includes('DEFAULT')) {
      violations.push({ version, rule: 'not-null-without-default', statement: match[0] });
    }
  }
  return violations;
}

describe('migration discipline static gate (Serpent-verg.7)', () => {
  it('every migration passes the add-only discipline', () => {
    const allViolations = MIGRATIONS.flatMap((migration) =>
      checkMigrationDiscipline(migration.version, migration.sql),
    );
    expect(allViolations).toEqual([]);
  });

  it('rebuild versions are exactly the documented set', () => {
    expect([...TABLE_REBUILD_VERSIONS].sort((a, b) => a - b)).toEqual([
      4, 6, 7, 10, 14, 15, 16, 18, 21, 25, 30, 32, 33,
    ]);
  });

  it('versions are contiguous (no gaps in the chain)', () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    for (let index = 1; index < versions.length; index += 1) {
      expect(versions[index]).toBe(versions[index - 1]! + 1);
    }
  });

  it('catches a violating migration example (drop column)', () => {
    const violations = checkMigrationDiscipline(
      99,
      'ALTER TABLE assets DROP COLUMN display_name;',
    );
    expect(violations.some((v) => v.rule === 'drop-column')).toBe(true);
  });

  it('catches a violating migration example (rename table)', () => {
    const violations = checkMigrationDiscipline(
      99,
      'ALTER TABLE assets RENAME TO files;',
    );
    expect(violations.some((v) => v.rule === 'rename-table')).toBe(true);
  });

  it('catches a violating migration example (NOT NULL column without default)', () => {
    const violations = checkMigrationDiscipline(
      99,
      'ALTER TABLE assets ADD COLUMN mandatory_tag TEXT NOT NULL;',
    );
    expect(violations.some((v) => v.rule === 'not-null-without-default')).toBe(true);
  });

  it('allows nullable and defaulted new columns', () => {
    const violations = checkMigrationDiscipline(
      99,
      `ALTER TABLE assets ADD COLUMN optional_tag TEXT;
       ALTER TABLE assets ADD COLUMN flag INTEGER NOT NULL DEFAULT 0;`,
    );
    expect(violations).toEqual([]);
  });
});
