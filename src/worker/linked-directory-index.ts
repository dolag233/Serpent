import { randomUUID } from 'node:crypto';

import { hasTable } from './lenient-columns';
import { normalizeRelativeAssetPath, portablePathIdentity } from './library-rules';

export const LINKED_DIRECTORY_INDEX_SQL = `
  CREATE TABLE linked_directory_membership_versions (
    linked_folder_id TEXT PRIMARY KEY REFERENCES linked_folders(folder_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO linked_directory_membership_versions(linked_folder_id) SELECT folder_id FROM linked_folders;
  CREATE TRIGGER linked_directory_root_insert AFTER INSERT ON linked_folders BEGIN
    INSERT INTO linked_directory_membership_versions(linked_folder_id) VALUES (NEW.folder_id);
  END;
  CREATE TRIGGER linked_directory_asset_insert AFTER INSERT ON assets WHEN NEW.location_kind = 'linked' BEGIN
    UPDATE linked_directory_membership_versions SET sequence = sequence + 1 WHERE linked_folder_id = NEW.linked_folder_id;
  END;
  CREATE TRIGGER linked_directory_asset_delete AFTER DELETE ON assets WHEN OLD.location_kind = 'linked' BEGIN
    UPDATE linked_directory_membership_versions SET sequence = sequence + 1 WHERE linked_folder_id = OLD.linked_folder_id;
  END;
  CREATE TRIGGER linked_directory_asset_update
    AFTER UPDATE OF relative_file_path, linked_folder_id, deleted_at, availability ON assets
    WHEN OLD.relative_file_path IS NOT NEW.relative_file_path OR OLD.linked_folder_id IS NOT NEW.linked_folder_id
      OR OLD.deleted_at IS NOT NEW.deleted_at OR OLD.availability IS NOT NEW.availability BEGIN
    UPDATE linked_directory_membership_versions SET sequence = sequence + 1 WHERE linked_folder_id IN (OLD.linked_folder_id, NEW.linked_folder_id);
  END;
  CREATE TABLE linked_directory_snapshots (
    linked_folder_id TEXT PRIMARY KEY REFERENCES linked_folders(folder_id) ON DELETE CASCADE,
    generation TEXT NOT NULL
  );
  CREATE TABLE linked_directory_entries (
    linked_folder_id TEXT NOT NULL REFERENCES linked_folders(folder_id) ON DELETE CASCADE,
    generation TEXT NOT NULL,
    path_identity TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    parent_identity TEXT NOT NULL,
    PRIMARY KEY (linked_folder_id, generation, path_identity)
  ) WITHOUT ROWID;
  CREATE INDEX linked_directory_parent_idx
    ON linked_directory_entries(linked_folder_id, generation, parent_identity);
  CREATE TRIGGER linked_directory_snapshot_insert AFTER INSERT ON linked_directory_snapshots BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
    UPDATE browse_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER linked_directory_snapshot_update AFTER UPDATE ON linked_directory_snapshots
    WHEN NEW.generation <> OLD.generation BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
    UPDATE browse_change_sequence SET sequence = sequence + 1;
  END;
  CREATE TRIGGER linked_directory_snapshot_delete AFTER DELETE ON linked_directory_snapshots BEGIN
    UPDATE library_change_sequence SET sequence = sequence + 1;
    UPDATE browse_change_sequence SET sequence = sequence + 1;
  END;
` + ['INSERT', 'UPDATE', 'DELETE'].map((event) => {
  const sources = event === 'INSERT' ? ['NEW'] : event === 'DELETE' ? ['OLD'] : ['OLD', 'NEW'];
  const assetRoots = () => sources.map((source) => `
    UPDATE linked_directory_membership_versions SET sequence = sequence + 1
     WHERE linked_folder_id = (SELECT linked_folder_id FROM assets WHERE asset_id = ${source}.asset_id);
  `).join('');
  return `
    CREATE TRIGGER linked_directory_ignored_${event.toLowerCase()} AFTER ${event} ON linked_ignored_assets BEGIN
      ${assetRoots()}
    END;
    CREATE TRIGGER linked_directory_sequence_${event.toLowerCase()} AFTER ${event} ON asset_sequence_frames BEGIN
      ${assetRoots()}
    END;
    CREATE TRIGGER linked_directory_explicit_${event.toLowerCase()} AFTER ${event} ON explicit_ignored_paths BEGIN
      ${sources.map((source) => `
        UPDATE linked_directory_membership_versions SET sequence = sequence + 1
         WHERE linked_folder_id = ${source}.linked_folder_id AND ${source}.location_kind = 'linked';
      `).join('')}
    END;
  `;
}).join('');

interface DirectoryConnection {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number };
  };
  transaction<T>(operation: () => T): () => T;
}

function normalizedDirectories(paths: readonly string[]): string[] {
  const byIdentity = new Map<string, string>();
  for (const value of paths) {
    const normalized = normalizeRelativeAssetPath(value);
    byIdentity.set(portablePathIdentity(normalized), normalized);
  }
  return [...byIdentity.values()].sort();
}

/** A complete snapshot is published only after its entire scan succeeds. */
export class LinkedDirectoryIndex {
  private readonly cache = new Map<string, { generation: string; paths: string[] }>();
  private readonly versions = new Map<string, number>();
  private readonly staging = new Set<string>();

  constructor(private readonly connection: () => DirectoryConnection) {}

  version(rootId: string): number {
    return this.versions.get(rootId) ?? 0;
  }

  /** Allocate before enumeration: the newest started scan owns publication. */
  beginScan(rootId: string): number {
    const version = this.version(rootId) + 1;
    this.versions.set(rootId, version);
    return version;
  }

  async prepare(rootId: string, checkpoint: () => Promise<void>): Promise<void> {
    const database = this.connection();
    if (!hasTable(database, 'linked_directory_snapshots')) return;
    const snapshot = database.prepare('SELECT generation FROM linked_directory_snapshots WHERE linked_folder_id = ?')
      .get(rootId) as { generation: string } | undefined;
    if (!snapshot || this.cache.get(rootId)?.generation === snapshot.generation) return;
    const paths: string[] = [];
    let after = '';
    for (;;) {
      const rows = database.prepare(`SELECT path_identity, relative_path FROM linked_directory_entries
        WHERE linked_folder_id = ? AND generation = ? AND path_identity > ? ORDER BY path_identity LIMIT 512`)
        .all(rootId, snapshot.generation, after) as Array<{ path_identity: string; relative_path: string }>;
      paths.push(...rows.map((row) => row.relative_path));
      await checkpoint();
      if (rows.length < 512) break;
      after = rows[rows.length - 1]!.path_identity;
    }
    // A concurrent publication must not be overwritten with an old generation.
    const current = database.prepare('SELECT generation FROM linked_directory_snapshots WHERE linked_folder_id = ?')
      .get(rootId) as { generation: string } | undefined;
    if (current?.generation === snapshot.generation) this.cache.set(rootId, { generation: snapshot.generation, paths: paths.sort() });
  }

  children(rootId: string, parent: string): string[] {
    const database = this.connection();
    if (!hasTable(database, 'linked_directory_snapshots')) {
      const identity = parent ? portablePathIdentity(parent) : '';
      return this.paths(rootId).filter((value) => {
        const slash = value.lastIndexOf('/');
        return (slash < 0 ? '' : portablePathIdentity(value.slice(0, slash))) === identity;
      });
    }
    return (database.prepare(`SELECT entry.relative_path FROM linked_directory_entries entry
      JOIN linked_directory_snapshots snapshot USING (linked_folder_id, generation)
      WHERE entry.linked_folder_id = ? AND entry.parent_identity = ? ORDER BY entry.relative_path`)
      .all(rootId, parent ? portablePathIdentity(parent) : '') as Array<{ relative_path: string }>)
      .map((row) => row.relative_path);
  }

  childrenByParent(rootId: string, parents: readonly string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const database = this.connection();
    if (!hasTable(database, 'linked_directory_snapshots')) {
      for (const parent of parents) result.set(parent, this.children(rootId, parent));
      return result;
    }
    for (let offset = 0; offset < parents.length; offset += 512) {
      const batch = parents.slice(offset, offset + 512);
      const identities = new Map(batch.map((parent) => [portablePathIdentity(parent), parent]));
      const rows = database.prepare(`SELECT entry.parent_identity, entry.relative_path FROM linked_directory_entries entry
        JOIN linked_directory_snapshots snapshot USING (linked_folder_id, generation)
        WHERE entry.linked_folder_id = ? AND entry.parent_identity IN (${batch.map(() => '?').join(',')})`)
        .all(rootId, ...identities.keys()) as Array<{ parent_identity: string; relative_path: string }>;
      for (const row of rows) {
        const parent = identities.get(row.parent_identity)!;
        const children = result.get(parent) ?? [];
        children.push(row.relative_path);
        result.set(parent, children);
      }
    }
    return result;
  }

  forget(rootId: string): void {
    this.cache.delete(rootId);
    this.versions.set(rootId, this.version(rootId) + 1);
  }

  membershipVersion(rootId: string): number | undefined {
    const database = this.connection();
    if (!hasTable(database, 'linked_directory_membership_versions')) return undefined;
    const row = database.prepare(
      'SELECT sequence FROM linked_directory_membership_versions WHERE linked_folder_id = ?',
    ).get(rootId) as { sequence: number } | undefined;
    return row?.sequence;
  }

  async recover(checkpoint: () => Promise<void>): Promise<void> {
    await checkpoint();
    const database = this.connection();
    if (!hasTable(database, 'linked_directory_snapshots')) return;
    const roots = database.prepare(`
      SELECT DISTINCT entry.linked_folder_id FROM linked_directory_entries entry
       LEFT JOIN linked_directory_snapshots snapshot ON snapshot.linked_folder_id = entry.linked_folder_id
       WHERE entry.generation <> COALESCE(snapshot.generation, '')
    `).all() as Array<{ linked_folder_id: string }>;
    for (const root of roots) await this.cleanup(root.linked_folder_id, checkpoint);
  }

  paths(rootId: string): readonly string[] {
    const database = this.connection();
    if (!hasTable(database, 'linked_directory_snapshots')) return this.cache.get(rootId)?.paths ?? [];
    const snapshot = database.prepare(
      'SELECT generation FROM linked_directory_snapshots WHERE linked_folder_id = ?',
    ).get(rootId) as { generation: string } | undefined;
    if (!snapshot) return [];
    const cached = this.cache.get(rootId);
    if (cached?.generation === snapshot.generation) return cached.paths;
    const rows = database.prepare(`
      SELECT relative_path FROM linked_directory_entries
       WHERE linked_folder_id = ? AND generation = ? ORDER BY relative_path
    `).all(rootId, snapshot.generation) as Array<{ relative_path: string }>;
    const paths = rows.map((row) => row.relative_path).sort();
    this.cache.set(rootId, { generation: snapshot.generation, paths });
    return paths;
  }

  /** Used inside already synchronous filesystem mutations/import transactions. */
  replace(rootId: string, paths: readonly string[]): boolean {
    const normalized = normalizedDirectories(paths);
    this.versions.set(rootId, this.version(rootId) + 1);
    if (this.same(rootId, normalized)) return false;
    const database = this.connection();
    const generation = randomUUID();
    if (hasTable(database, 'linked_directory_snapshots')) {
      database.transaction(() => {
        this.write(rootId, generation, normalized);
        this.activate(rootId, generation);
        database.prepare('DELETE FROM linked_directory_entries WHERE linked_folder_id = ? AND generation <> ?')
          .run(rootId, generation);
      })();
    }
    this.cache.set(rootId, { generation, paths: normalized });
    return true;
  }

  /** Bounded writes, fenced against an in-app mutation during discovery. */
  async publish(
    rootId: string,
    paths: readonly string[],
    expectedVersion: number,
    checkpoint: () => Promise<void>,
  ): Promise<boolean> {
    await checkpoint();
    if (this.version(rootId) !== expectedVersion) return false;
    const normalized = normalizedDirectories(paths);
    if (this.same(rootId, normalized)) {
      await this.cleanup(rootId, checkpoint);
      return false;
    }
    const database = this.connection();
    if (!hasTable(database, 'linked_directory_snapshots')) return this.replace(rootId, normalized);
    const generation = randomUUID();
    this.staging.add(generation);
    try {
      for (let offset = 0; offset < normalized.length; offset += 512) {
        database.transaction(() => this.write(rootId, generation, normalized.slice(offset, offset + 512)))();
        await checkpoint();
        if (this.version(rootId) !== expectedVersion) return false;
      }
      // No await between the last lifecycle/version check and publication.
      database.transaction(() => this.activate(rootId, generation))();
      this.versions.set(rootId, expectedVersion + 1);
      this.cache.set(rootId, { generation, paths: normalized });
      return true;
    } finally {
      this.staging.delete(generation);
      // A cancelled/closed owner leaves only disposable rows. The next scan's
      // cleanup recovers those without touching the last complete snapshot.
      await this.cleanup(rootId, checkpoint);
    }
  }

  add(rootId: string, relativePath: string): void {
    const paths = new Set(this.paths(rootId));
    let cursor = normalizeRelativeAssetPath(relativePath);
    while (cursor) {
      paths.add(cursor);
      const slash = cursor.lastIndexOf('/');
      cursor = slash < 0 ? '' : cursor.slice(0, slash);
    }
    this.replace(rootId, [...paths]);
  }

  rename(rootId: string, from: string, to: string): void {
    const identity = portablePathIdentity(from);
    this.replace(rootId, this.paths(rootId).map((value) => {
      const candidate = portablePathIdentity(value);
      return candidate === identity || candidate.startsWith(`${identity}/`)
        ? to + value.slice(from.length)
        : value;
    }));
  }

  remove(rootId: string, relativePath: string): void {
    const identity = portablePathIdentity(relativePath);
    this.replace(rootId, this.paths(rootId).filter((value) => {
      const candidate = portablePathIdentity(value);
      return candidate !== identity && !candidate.startsWith(`${identity}/`);
    }));
  }

  private same(rootId: string, paths: readonly string[]): boolean {
    const previous = this.paths(rootId);
    return previous.length === paths.length && previous.every((value, index) => value === paths[index]);
  }

  private write(rootId: string, generation: string, paths: readonly string[]): void {
    const insert = this.connection().prepare(`
      INSERT INTO linked_directory_entries(linked_folder_id, generation, path_identity, relative_path, parent_identity)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const relativePath of paths) {
      const slash = relativePath.lastIndexOf('/');
      const parent = slash < 0 ? '' : relativePath.slice(0, slash);
      insert.run(rootId, generation, portablePathIdentity(relativePath), relativePath, parent ? portablePathIdentity(parent) : '');
    }
  }

  private activate(rootId: string, generation: string): void {
    this.connection().prepare(`
      INSERT INTO linked_directory_snapshots(linked_folder_id, generation) VALUES (?, ?)
      ON CONFLICT(linked_folder_id) DO UPDATE SET generation = excluded.generation
    `).run(rootId, generation);
  }

  private async cleanup(rootId: string, checkpoint: () => Promise<void>): Promise<void> {
    await checkpoint();
    const database = this.connection();
    if (!hasTable(database, 'linked_directory_snapshots')) return;
    for (;;) {
      const protectedGenerations = [...this.staging];
      const removed = database.prepare(`
        DELETE FROM linked_directory_entries
         WHERE (linked_folder_id, generation, path_identity) IN (
           SELECT entry.linked_folder_id, entry.generation, entry.path_identity
             FROM linked_directory_entries entry
            WHERE entry.linked_folder_id = ?
              ${protectedGenerations.length ? `AND entry.generation NOT IN (${protectedGenerations.map(() => '?').join(',')})` : ''}
              AND entry.generation <> COALESCE((
                SELECT generation FROM linked_directory_snapshots WHERE linked_folder_id = ?
              ), '') LIMIT 512
         )
      `).run(rootId, ...protectedGenerations, rootId).changes;
      if (removed === 0) return;
      await checkpoint();
    }
  }
}
