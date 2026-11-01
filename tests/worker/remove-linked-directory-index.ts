interface FixtureConnection {
  exec(sql: string): void;
  prepare(sql: string): { all(...parameters: unknown[]): unknown };
}

/** Raw historical-schema fixtures must remove objects introduced by v60. */
export function removeLinkedDirectoryIndexFixture(database: FixtureConnection): void {
  const triggers = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'linked_directory_%'",
  ).all() as Array<{ name: string }>;
  for (const { name } of triggers) {
    if (!/^linked_directory_[a-z_]+$/u.test(name)) throw new Error('Unexpected fixture trigger name.');
    database.exec(`DROP TRIGGER "${name}"`);
  }
  database.exec(`
    DROP TABLE IF EXISTS linked_directory_entries;
    DROP TABLE IF EXISTS linked_directory_snapshots;
    DROP TABLE IF EXISTS linked_directory_membership_versions;
  `);
}
