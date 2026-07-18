/**
 * REQ-MENU-004 / Serpent-guq: classify a multi-asset context-menu selection
 * into process vs skip counts with stable reason codes, and format a concise
 * menu footer (e.g. "将处理 3 / 跳过 2（回收站）").
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
  | "trashed";

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
};

export type MultiAssetMenuSkipReport = {
  readonly selectionCount: number;
  readonly allTrashed: boolean;
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly linkedCount: number;
  readonly unavailableManagedCount: number;
  readonly trashedCount: number;
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
  ];
  return order
    .filter((reason) => (buckets.get(reason) ?? 0) > 0)
    .map((reason) => ({ reason, count: buckets.get(reason)! }));
}

function buildScope(
  action: MenuActionKind,
  processAssetIds: readonly string[],
  skips: Map<MenuSkipReasonCode, number>,
): MenuActionSkipScope {
  const skipList = bucketsToList(skips);
  return {
    action,
    processCount: processAssetIds.length,
    skipCount: skipList.reduce((sum, item) => sum + item.count, 0),
    skips: skipList,
    processAssetIds,
  };
}

/**
 * Classify the multi-select snapshot into move/trash process sets and skip
 * reason buckets. `assets` is the currently loaded scope; ids present in
 * `selectedAssetIds` but missing from `assets` count as unresolved.
 */
export function buildMultiAssetMenuSkipReport(
  selectedAssetIds: readonly string[],
  assets: readonly MenuSkipAssetSnapshot[],
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
  const allTrashed =
    resolved.length > 0 &&
    unresolvedCount === 0 &&
    resolved.every((asset) => Boolean(asset.deletedAt));

  const moveIds: string[] = [];
  const moveSkips = new Map<MenuSkipReasonCode, number>();
  const trashIds: string[] = [];
  const trashSkips = new Map<MenuSkipReasonCode, number>();

  pushSkip(moveSkips, "unresolved", unresolvedCount);
  pushSkip(trashSkips, "unresolved", unresolvedCount);

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
    selectionCount: selectedAssetIds.length,
    allTrashed,
    resolvedCount: resolved.length,
    unresolvedCount,
    linkedCount,
    unavailableManagedCount,
    trashedCount,
    move: buildScope("move", moveIds, moveSkips),
    trash: buildScope("trash", trashIds, trashSkips),
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
 * Concise multi-asset menu footer. Null when every file-op is fully eligible
 * or the menu is on the all-trashed restore/delete branch.
 */
export function formatMultiAssetMenuSkipFooter(
  report: MultiAssetMenuSkipReport,
  locale: AppLocale = DEFAULT_LOCALE,
): string | null {
  if (report.allTrashed) return null;
  const lines = [report.move, report.trash]
    .map((scope) => formatMenuActionSkipLine(scope, locale))
    .filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  const join = translateForLocale(locale, "menu.skipReportJoin");
  return lines.join(join);
}
