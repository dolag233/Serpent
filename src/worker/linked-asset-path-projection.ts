import { countLinkedDirectoryAssets, type LinkedDirectoryAssetCounts } from '../shared/linked-folder-tree';

/** Keyset pages bound both SQLite materialization and JS aggregation slices. */
export async function collectLinkedAssetPaths(
  readPage: (after: string | null, limit: number) => string[],
  checkpoint: () => Promise<void>,
): Promise<{ paths: string[]; counts: Map<string, LinkedDirectoryAssetCounts> }> {
  const paths: string[] = [];
  const counts = new Map<string, LinkedDirectoryAssetCounts>();
  const pageSize = 2_048;
  let after: string | null = null;
  for (;;) {
    const page = readPage(after, pageSize);
    for (const [directory, delta] of countLinkedDirectoryAssets(page)) {
      const count = counts.get(directory) ?? { direct: 0, recursive: 0 };
      count.direct += delta.direct;
      count.recursive += delta.recursive;
      counts.set(directory, count);
    }
    paths.push(...page);
    await checkpoint();
    if (page.length < pageSize) return { paths, counts };
    after = page.at(-1)!;
  }
}
