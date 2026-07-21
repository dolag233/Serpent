/**
 * REQ-MENU-004 / Serpent-guq: classify a multi-asset context-menu selection
 * into process vs skip counts with stable reason codes, and format a concise
 * menu footer (e.g. "将处理 3 / 跳过 2（回收站）").
 *
 * Serpent-koy: folder cards in a mixed selection participate in trash /
 * disk-delete; asset-only actions (move, tags, …) skip folders with reason
 * "folder".
 *
 * Eligibility mirrors drag-drop / file-op gates: move needs managed + available
 * + not trashed; trash needs managed + not trashed. Linked, unavailable,
 * unresolved, and trashed assets become skip buckets rather than silent gaps.
 */

import {
  DEFAULT_LOCALE,
  translateForLocale,
  type AppLocale,
} from "./i18n";

export type MenuSkipReasonCode =
  | "linked"
  | "unavailable"
  | "unresolved"
  | "trashed"
  | "folder";

export type MenuSkipAssetSnapshot = {
  readonly assetId: string;
  readonly locationKind: "managed" | "linked";
  readonly availability: "available" | "missing";
  readonly deletedAt: string | null;
};

export type MenuActionKind = "move" | "trash";

export type MenuSkipBucket = {
  readonly reason: MenuSkipReasonCode;
  readonly count: number;
};

export type MenuActionSkipScope = {
  readonly action: MenuActionKind;
  readonly processCount: number;
  readonly skipCount: number;
  readonly skips: readonly MenuSkipBucket[];
  readonly processAssetIds: readonly string[];
  readonly processFolderIds: readonly string[];
};

export type MultiAssetMenuSkipReport = {
  readonly selectionCount: number;
  readonly allTrashed: boolean;
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly linkedCount: number;
  readonly unavailableManagedCount: number;
  readonly trashedCount: number;
  readonly folderCount: number;
  readonly move: MenuActionSkipScope;
  readonly trash: MenuActionSkipScope;
};

function pushSkip(
  buckets: Map<MenuSkipReasonCode, number>,
  reason: MenuSkipReasonCode,
  count = 1,
): void {
  if (count <= 0) return;
  buckets.set(reason, (buckets.get(reason) ?? 0) + count);
}

function bucketsToList(
  buckets: Map<MenuSkipReasonCode, number>,
): MenuSkipBucket[] {
  const order: MenuSkipReasonCode[] = [
    "linked",
    "unavailable",
    "trashed",
    "unresolved",
    "folder",
  ];
  return order
    .filter((reason) => (buckets.get(reason) ?? 0) > 0)
    .map((reason) => ({ reason, count: buckets.get(reason)! }));
}

function buildScope(
  action: MenuActionKind,
  processAssetIds: readonly string[],
  processFolderIds: readonly string[],
  skips: Map<MenuSkipReasonCode, number>,
): MenuActionSkipScope {
  const skipList = bucketsToList(skips);
  return {
    action,
    processCount: processAssetIds.length + processFolderIds.length,
    skipCount: skipList.reduce((sum, item) => sum + item.count, 0),
    skips: skipList,
    processAssetIds,
    processFolderIds,
  };
}

/**
 * Classify the multi-select snapshot into move/trash process sets and skip
 * reason buckets. `assets` is the currently loaded scope; ids present in
 * `selectedAssetIds` but missing from `assets` count as unresolved.
 * Canvas folder cards are managed folders and join trash/disk-delete;
 * they are skipped for move (folder batch move is not shipped yet).
 */
export function buildMultiAssetMenuSkipReport(
  selectedAssetIds: readonly string[],
  assets: readonly MenuSkipAssetSnapshot[],
  selectedFolderIds: readonly string[] = [],
): MultiAssetMenuSkipReport {
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
  const resolved: MenuSkipAssetSnapshot[] = [];
  let unresolvedCount = 0;
  for (const assetId of selectedAssetIds) {
    const asset = byId.get(assetId);
    if (!asset) {
      unresolvedCount += 1;
      continue;
    }
    resolved.push(asset);
  }

  const folderIds = [...selectedFolderIds];
  const folderCount = folderIds.length;

  const linkedCount = resolved.filter(
    (asset) => asset.locationKind === "linked",
  ).length;
  const unavailableManagedCount = resolved.filter(
    (asset) =>
      asset.locationKind === "managed" &&
      asset.availability !== "available" &&
      !asset.deletedAt,
  ).length;
  const trashedCount = resolved.filter((asset) =>
    Boolean(asset.deletedAt),
  ).length;
  // Folders on the browse canvas are never "trashed cards"; mixed folder
  // selection always leaves the restore/permanent-delete branch.
  const allTrashed =
    folderCount === 0 &&
    resolved.length > 0 &&
    unresolvedCount === 0 &&
    resolved.every((asset) => Boolean(asset.deletedAt));

  const moveIds: string[] = [];
  const moveSkips = new Map<MenuSkipReasonCode, number>();
  const trashIds: string[] = [];
  const trashSkips = new Map<MenuSkipReasonCode, number>();

  pushSkip(moveSkips, "unresolved", unresolvedCount);
  pushSkip(trashSkips, "unresolved", unresolvedCount);
  // Move does not yet support folders (REQ-MENU-005 / Serpent-vgp).
  pushSkip(moveSkips, "folder", folderCount);

  for (const asset of resolved) {
    if (asset.locationKind === "linked") {
      pushSkip(moveSkips, "linked");
      pushSkip(trashSkips, "linked");
      continue;
    }
    // managed
    if (asset.deletedAt) {
      pushSkip(moveSkips, "trashed");
      pushSkip(trashSkips, "trashed");
      continue;
    }
    if (asset.availability !== "available") {
      pushSkip(moveSkips, "unavailable");
      trashIds.push(asset.assetId);
      continue;
    }
    moveIds.push(asset.assetId);
    trashIds.push(asset.assetId);
  }

  return {
    selectionCount: selectedAssetIds.length + folderCount,
    allTrashed,
    resolvedCount: resolved.length,
    unresolvedCount,
    linkedCount,
    unavailableManagedCount,
    trashedCount,
    folderCount,
    move: buildScope("move", moveIds, [], moveSkips),
    trash: buildScope("trash", trashIds, folderIds, trashSkips),
  };
}

function reasonPhrase(
  reason: MenuSkipReasonCode,
  locale: AppLocale,
): string {
  switch (reason) {
    case "linked":
      return translateForLocale(locale, "menu.skipReasonLinked");
    case "unavailable":
      return translateForLocale(locale, "menu.skipReasonUnavailable");
    case "unresolved":
      return translateForLocale(locale, "menu.skipReasonUnresolved");
    case "trashed":
      return translateForLocale(locale, "menu.skipReasonTrashed");
    case "folder":
      return translateForLocale(locale, "menu.skipReasonFolder");
  }
}

function formatReasons(
  skips: readonly MenuSkipBucket[],
  locale: AppLocale,
): string {
  const join = translateForLocale(locale, "menu.skipReasonJoin");
  return skips
    .map((bucket) => reasonPhrase(bucket.reason, locale))
    .join(join);
}

/**
 * One action line when that action would skip anything; null when fully
 * eligible (no footer noise for uniform managed selections).
 */
export function formatMenuActionSkipLine(
  scope: MenuActionSkipScope,
  locale: AppLocale = DEFAULT_LOCALE,
): string | null {
  if (scope.skipCount === 0) return null;
  const action =
    scope.action === "move"
      ? translateForLocale(locale, "menu.skipReportActionMove")
      : translateForLocale(locale, "menu.skipReportActionTrash");
  return translateForLocale(locale, "menu.skipReportLine", {
    action,
    process: scope.processCount,
    skip: scope.skipCount,
    reasons: formatReasons(scope.skips, locale),
  });
}

/**
 * When folders are mixed in, asset-only ops (tags / collections / AI) skip
 * them — surface a concise note so the skip is not silent.
 */
export function formatMixedSelectionAssetOnlyNote(
  folderCount: number,
  locale: AppLocale = DEFAULT_LOCALE,
): string | null {
  if (folderCount <= 0) return null;
  return translateForLocale(locale, "menu.skipReportAssetOnlyFolders", {
    count: folderCount,
  });
}

/**
 * Concise multi-asset menu footer. Null when every file-op is fully eligible
 * or the menu is on the all-trashed restore/delete branch.
 */
export function formatMultiAssetMenuSkipFooter(
  report: MultiAssetMenuSkipReport,
  locale: AppLocale = DEFAULT_LOCALE,
): string | null {
  if (report.allTrashed) return null;
  // Folder-only multi menus hide move; don't emit a move skip line there.
  const scopes =
    report.selectionCount > report.folderCount
      ? [report.move, report.trash]
      : [report.trash];
  const lines = scopes
    .map((scope) => formatMenuActionSkipLine(scope, locale))
    .filter((line): line is string => line !== null);
  const assetOnly = formatMixedSelectionAssetOnlyNote(
    report.folderCount > 0 &&
      report.selectionCount > report.folderCount
      ? report.folderCount
      : 0,
    locale,
  );
  if (assetOnly) lines.push(assetOnly);
  if (lines.length === 0) return null;
  const join = translateForLocale(locale, "menu.skipReportJoin");
  return lines.join(join);
}
