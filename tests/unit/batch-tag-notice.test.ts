import { describe, expect, it } from "vitest";

import { formatBatchTagNotice } from "../../src/renderer/batch-tag-notice";
import type { TagOperationSkip } from "../../src/shared/protocol/responses";

describe("formatBatchTagNotice", () => {
  it("keeps the all-success wording unchanged", () => {
    expect(formatBatchTagNotice("assign", 3, [])).toBe("已为 3 项资产添加标签。");
    expect(formatBatchTagNotice("remove", 2, [])).toBe("已为 2 项资产移除标签。");
  });

  it("appends skip counts and reasons to a partial success", () => {
    expect(
      formatBatchTagNotice("assign", 8, [
        { assetId: "asset-01", reason: "asset_not_found" },
        { assetId: "asset-02", reason: "asset_not_found" },
      ]),
    ).toBe("已为 8 项资产添加标签；跳过 2 项（资产不存在）。");
    expect(
      formatBatchTagNotice("remove", 4, [
        { assetId: "asset-01", reason: "asset_not_found" },
      ]),
    ).toBe("已为 4 项资产移除标签；跳过 1 项（资产不存在）。");
  });

  it("avoids claiming success when every asset was skipped", () => {
    expect(
      formatBatchTagNotice("assign", 0, [
        { assetId: "asset-01", reason: "asset_not_found" },
        { assetId: "asset-02", reason: "asset_not_found" },
        { assetId: "asset-03", reason: "asset_not_found" },
      ]),
    ).toBe("未能为任何资产添加标签；跳过 3 项（资产不存在）。");
    expect(
      formatBatchTagNotice("remove", 0, [
        { assetId: "asset-01", reason: "asset_not_found" },
      ]),
    ).toBe("未能为任何资产移除标签；跳过 1 项（资产不存在）。");
  });

  it("groups skip counts by reason and falls back to the raw code for unknown reasons", () => {
    // Future reason codes surface verbatim until a phrase is added.
    const skipped = [
      { assetId: "asset-01", reason: "asset_not_found" },
      { assetId: "asset-02", reason: "asset_trashed" },
      { assetId: "asset-03", reason: "asset_not_found" },
    ] as unknown as TagOperationSkip[];
    expect(formatBatchTagNotice("assign", 1, skipped)).toBe(
      "已为 1 项资产添加标签；跳过 2 项（资产不存在）、1 项（asset_trashed）。",
    );
  });
});
