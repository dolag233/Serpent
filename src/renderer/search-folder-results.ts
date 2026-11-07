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
  SearchExpressionNode,
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
 * Non-folder fields are ignored as candidates: they act like true inside AND
 * (so `name:hero tag:red` still suggests Hero), false inside OR (so
 * `name:maps | tag:red` does not surface every folder), and stay inapplicable
 * through NOT rather than becoming a positive folder match.
 */
export function folderSearchTerms(query: SearchQuery): string[] {
  const terms: string[] = [];
  const expression = query.expression?.root;
  const collectExpression = (node: SearchExpressionNode | null, negated = false): void => {
    if (!node) return;
    if (node.kind === "NOT") return collectExpression(node.child, !negated);
    if (node.kind === "TERM") {
      if (!negated && (node.field === null || node.field === "filename" || node.field === "folder_path")) {
        pushNormalized(terms, [node.value]);
      }
      return;
    }
    node.children.forEach((child) => collectExpression(child, negated));
  };
  if (expression) {
    collectExpression(expression);
    return [...new Set(terms)];
  }
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

function matchesFolderExpression(
  node: SearchExpressionNode | null,
  name: string,
  path: string,
): boolean | null {
  if (!node) return null;
  if (node.kind === "NOT") {
    const child = matchesFolderExpression(node.child, name, path);
    return child === null ? null : !child;
  }
  if (node.kind === "TERM") {
    const term = normalize(node.value).trim();
    const supported = node.field === null || node.field === "filename" || node.field === "folder_path";
    if (!supported) return null;
    return node.field === "folder_path"
      ? normalize(path).includes(term)
      : node.field === "filename"
        ? normalize(name).includes(term)
        : normalize(name).includes(term) || normalize(path).includes(term);
  }
  const applicable = node.children
    .map((child) => matchesFolderExpression(child, name, path))
    .filter((value): value is boolean => value !== null);
  if (applicable.length === 0) return null;
  return node.kind === "AND"
    ? applicable.every(Boolean)
    : applicable.some(Boolean);
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
  const expressionRoot = options.query.expression?.root ?? null;
  const matches = (name: string, relativePath: string) => expressionRoot
    ? matchesFolderExpression(expressionRoot, name, relativePath) === true
    : matchesAnyTerm(terms, name, relativePath);

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
    if (matches(folder.name, folder.relativePath)) {
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
    if (matches(folder.displayName, folder.relativePath ?? "")) {
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
