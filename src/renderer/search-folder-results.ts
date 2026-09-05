// ---------------------------------------------------------------------------
// Search folder results (Serpent-f74e48)
//
// Global text search surfaces a "Folders" section alongside asset results.
// Folders are matched renderer-side over the already-loaded navigation tree
// (ManagedFolderSummary / LinkedFolderSummary) — no extra Worker query — by
// folder name or relative path, using the same plain-text / name / path terms
// the user typed into the search box. Results are returned as FolderBrowseEntry
// so the section can reuse the exact FolderCard used by the asset browser.
// Clicking a result enters the folder via the existing chooseFolder path.
// ---------------------------------------------------------------------------

import type {
  FolderBrowseEntry,
  LinkedFolderSummary,
  ManagedFolderSummary,
  SearchQuery,
} from "../shared/asset-types";

export type FolderSearchResult = FolderBrowseEntry;

export const MAX_SEARCH_FOLDER_RESULTS = 8;

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function pushNormalized(terms: string[], values: readonly string[]): void {
  for (const value of values) {
    const term = normalize(value).trim();
    if (term) terms.push(term);
  }
}

/**
 * Positive plain-text / name / path terms that narrow the folder-name search.
 * Tag/description/author clauses and negations are ignored: searching a tag
 * name should not surface a coincidentally-matching folder.
 */
export function folderSearchTerms(query: SearchQuery): string[] {
  const terms: string[] = [];
  const clauseLists = query.groups ?? [query.clauses];
  for (const clauses of clauseLists) {
    for (const clause of clauses) {
      if (clause.exclude) continue;
      if (
        clause.field === null ||
        clause.field === "filename" ||
        clause.field === "folder_path"
      ) {
        pushNormalized(terms, clause.values);
      }
    }
  }
  return [...new Set(terms)];
}

function matchesAnyTerm(
  terms: readonly string[],
  name: string,
  path: string,
): boolean {
  const normalizedName = normalize(name);
  const normalizedPath = normalize(path);
  return terms.some(
    (term) =>
      normalizedName.includes(term) ||
      (normalizedPath !== "" && normalizedPath.includes(term)),
  );
}

export interface ResolveSearchFolderResultsOptions {
  readonly query: SearchQuery;
  readonly folders: readonly ManagedFolderSummary[];
  readonly linkedFolders: readonly LinkedFolderSummary[];
  readonly limit?: number;
}

export function resolveSearchFolderResults(
  options: ResolveSearchFolderResultsOptions,
): FolderSearchResult[] {
  const limit = options.limit ?? MAX_SEARCH_FOLDER_RESULTS;
  const terms = folderSearchTerms(options.query);
  if (terms.length === 0) return [];

  // Direct child folders of a linked folder are derived (virtual subdirs);
  // count them so the search card shows a plausible child-folder count.
  const linkedChildren = new Map<string, number>();
  for (const folder of options.linkedFolders) {
    const parent = folder.parentFolderId ?? null;
    if (parent === null) continue;
    linkedChildren.set(parent, (linkedChildren.get(parent) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const results: FolderSearchResult[] = [];

  const push = (entry: FolderSearchResult): void => {
    if (seen.has(entry.folderId)) return;
    seen.add(entry.folderId);
    results.push(entry);
  };

  for (const folder of options.folders) {
    if (matchesAnyTerm(terms, folder.name, folder.relativePath)) {
      push({
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId,
        locationKind: "managed",
        name: folder.name,
        relativePath: folder.relativePath,
        status: "available",
        directAssetCount: folder.directAssetCount,
        recursiveAssetCount: folder.directAssetCount,
        childFolderCount: folder.childFolderCount,
        coverArtifactIds: [],
        coverAssetIds: [],
      });
    }
    if (results.length >= limit) return results;
  }

  for (const folder of options.linkedFolders) {
    if (matchesAnyTerm(terms, folder.displayName, folder.relativePath ?? "")) {
      const assetCount = folder.assetCount;
      push({
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId ?? null,
        locationKind: "linked",
        name: folder.displayName,
        relativePath: folder.relativePath ?? "",
        status: folder.status,
        directAssetCount: assetCount,
        recursiveAssetCount: assetCount,
        childFolderCount: linkedChildren.get(folder.folderId) ?? 0,
        coverArtifactIds: [],
        coverAssetIds: [],
        linkedFolderId: folder.linkedFolderId ?? folder.folderId,
      });
    }
    if (results.length >= limit) return results;
  }

  return results;
}