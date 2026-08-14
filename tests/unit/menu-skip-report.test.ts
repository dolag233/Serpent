import { describe, expect, it } from "vitest";

import {
  buildMultiAssetMenuSkipReport,
  formatMenuActionSkipLine,
  formatMultiAssetMenuSkipFooter,
  type MenuSkipAssetSnapshot,
} from "../../src/renderer/menu-skip-report";

function asset(
  partial: Partial<MenuSkipAssetSnapshot> & Pick<MenuSkipAssetSnapshot, "assetId">,
): MenuSkipAssetSnapshot {
  return {
    locationKind: "managed",
    availability: "available",
    deletedAt: null,
    ...partial,
  };
}

describe("buildMultiAssetMenuSkipReport", () => {
  it("treats a uniform available managed selection as fully eligible", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["a", "b"],
      [asset({ assetId: "a" }), asset({ assetId: "b" })],
    );
    expect(report.move.processAssetIds).toEqual(["a", "b"]);
    expect(report.trash.processAssetIds).toEqual(["a", "b"]);
    expect(report.move.skipCount).toBe(0);
    expect(report.trash.skipCount).toBe(0);
    expect(report.allTrashed).toBe(false);
  });

  it("skips linked assets for move but includes them in trash", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["m", "l"],
      [
        asset({ assetId: "m" }),
        asset({ assetId: "l", locationKind: "linked" }),
      ],
    );
    expect(report.move.processCount).toBe(1);
    expect(report.trash.processCount).toBe(2);
    expect(report.move.skips).toEqual([{ reason: "linked", count: 1 }]);
    expect(report.trash.skipCount).toBe(0);
    expect(report.linkedCount).toBe(1);
  });

  it("skips unavailable managed assets for move but keeps them for trash", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["ok", "miss"],
      [
        asset({ assetId: "ok" }),
        asset({ assetId: "miss", availability: "missing" }),
      ],
    );
    expect(report.move.processAssetIds).toEqual(["ok"]);
    expect(report.trash.processAssetIds).toEqual(["ok", "miss"]);
    expect(report.move.skips).toEqual([{ reason: "unavailable", count: 1 }]);
    expect(report.trash.skipCount).toBe(0);
  });

  it("counts unresolved ids and skips them for both actions", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["a", "gone"],
      [asset({ assetId: "a" })],
    );
    expect(report.unresolvedCount).toBe(1);
    expect(report.move.skips).toEqual([{ reason: "unresolved", count: 1 }]);
    expect(report.trash.skips).toEqual([{ reason: "unresolved", count: 1 }]);
  });

  it("skips trashed assets and detects the all-trashed branch", () => {
    const mixed = buildMultiAssetMenuSkipReport(
      ["live", "bin"],
      [
        asset({ assetId: "live" }),
        asset({ assetId: "bin", deletedAt: "2026-07-18T00:00:00.000Z" }),
      ],
    );
    expect(mixed.allTrashed).toBe(false);
    expect(mixed.move.processAssetIds).toEqual(["live"]);
    expect(mixed.trash.processAssetIds).toEqual(["live"]);
    expect(mixed.move.skips).toEqual([{ reason: "trashed", count: 1 }]);
    expect(mixed.trash.skips).toEqual([{ reason: "trashed", count: 1 }]);

    const allTrashed = buildMultiAssetMenuSkipReport(
      ["bin1", "bin2"],
      [
        asset({ assetId: "bin1", deletedAt: "2026-07-18T00:00:00.000Z" }),
        asset({ assetId: "bin2", deletedAt: "2026-07-18T00:00:00.000Z" }),
      ],
    );
    expect(allTrashed.allTrashed).toBe(true);
    expect(allTrashed.move.processCount).toBe(0);
    expect(allTrashed.trash.processCount).toBe(0);
  });

  it("accumulates multiple skip reasons in stable order", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["ok", "link", "miss", "gone", "bin"],
      [
        asset({ assetId: "ok" }),
        asset({ assetId: "link", locationKind: "linked" }),
        asset({ assetId: "miss", availability: "missing" }),
        asset({ assetId: "bin", deletedAt: "2026-07-18T00:00:00.000Z" }),
      ],
    );
    expect(report.move.processAssetIds).toEqual(["ok"]);
    expect(report.move.skips).toEqual([
      { reason: "linked", count: 1 },
      { reason: "unavailable", count: 1 },
      { reason: "trashed", count: 1 },
      { reason: "unresolved", count: 1 },
    ]);
    expect(report.trash.processAssetIds).toEqual(["ok", "link", "miss"]);
    expect(report.trash.skips).toEqual([
      { reason: "trashed", count: 1 },
      { reason: "unresolved", count: 1 },
    ]);
  });
  it("includes folders in move and trash process counts", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["a"],
      [asset({ assetId: "a" })],
      ["f1", "f2"],
    );
    expect(report.selectionCount).toBe(3);
    expect(report.folderCount).toBe(2);
    expect(report.allTrashed).toBe(false);
    expect(report.move.processAssetIds).toEqual(["a"]);
    expect(report.move.processFolderIds).toEqual(["f1", "f2"]);
    expect(report.move.processCount).toBe(3);
    expect(report.move.skipCount).toBe(0);
    expect(report.trash.processAssetIds).toEqual(["a"]);
    expect(report.trash.processFolderIds).toEqual(["f1", "f2"]);
    expect(report.trash.processCount).toBe(3);
    expect(report.trash.skipCount).toBe(0);
  });

  it("does not enter the all-trashed branch when folders are selected", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["bin"],
      [asset({ assetId: "bin", deletedAt: "2026-07-18T00:00:00.000Z" })],
      ["f1"],
    );
    expect(report.allTrashed).toBe(false);
    expect(report.trash.processFolderIds).toEqual(["f1"]);
  });
});

describe("formatMenuActionSkipLine / formatMultiAssetMenuSkipFooter", () => {
  it("formats a concise Chinese process/skip line", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["a", "b", "c", "d", "e"],
      [
        asset({ assetId: "a" }),
        asset({ assetId: "b" }),
        asset({ assetId: "c" }),
        asset({ assetId: "d", deletedAt: "2026-07-18T00:00:00.000Z" }),
        asset({ assetId: "e", deletedAt: "2026-07-18T00:00:00.000Z" }),
      ],
    );
    expect(formatMenuActionSkipLine(report.move, "zh-CN")).toBe(
      "移动：将处理 3 / 跳过 2（回收站）",
    );
    expect(formatMenuActionSkipLine(report.trash, "zh-CN")).toBe(
      "回收站：将处理 3 / 跳过 2（回收站）",
    );
  });

  it("joins move and trash lines when both have skips", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["m", "l"],
      [
        asset({ assetId: "m" }),
        asset({ assetId: "l", locationKind: "linked" }),
      ],
    );
    expect(formatMultiAssetMenuSkipFooter(report, "zh-CN")).toBe(
      "移动：将处理 1 / 跳过 1（链接资产）",
    );
    expect(formatMultiAssetMenuSkipFooter(report, "en")).toBe(
      "Move: process 1 / skip 1 (linked)",
    );
  });

  it("returns null when there are no skips or the menu is all-trashed", () => {
    const clean = buildMultiAssetMenuSkipReport(
      ["a"],
      [asset({ assetId: "a" })],
    );
    expect(formatMultiAssetMenuSkipFooter(clean, "zh-CN")).toBeNull();

    const trashed = buildMultiAssetMenuSkipReport(
      ["b"],
      [asset({ assetId: "b", deletedAt: "2026-07-18T00:00:00.000Z" })],
    );
    expect(formatMultiAssetMenuSkipFooter(trashed, "zh-CN")).toBeNull();
  });

  it("omits the move line when only move has no skips", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["ok", "miss"],
      [
        asset({ assetId: "ok" }),
        asset({ assetId: "miss", availability: "missing" }),
      ],
    );
    expect(formatMultiAssetMenuSkipFooter(report, "zh-CN")).toBe(
      "移动：将处理 1 / 跳过 1（不可用）",
    );
  });

  it("reports asset-only folder skips without skipping move in a mixed selection", () => {
    const report = buildMultiAssetMenuSkipReport(
      ["a"],
      [asset({ assetId: "a" })],
      ["f1"],
    );
    expect(formatMultiAssetMenuSkipFooter(report, "zh-CN")).toBe(
      "标签/合集/AI：跳过 1（文件夹）",
    );
    expect(formatMultiAssetMenuSkipFooter(report, "en")).toBe(
      "Tags/collections/AI: skip 1 (folder)",
    );
  });
});
