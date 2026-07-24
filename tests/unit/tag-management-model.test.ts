import { describe, expect, it } from "vitest";

import type { TagSummary } from "../../src/shared/asset-types";
import {
  applyTagSelectionClick,
  filterTagsByQuery,
  resolveTagMenuTargetIds,
  sortTags,
} from "../../src/renderer/tag-management-model";

function tag(tagId: string, name: string, assetCount: number): TagSummary {
  return { tagId, name, assetCount };
}

describe("sortTags", () => {
  const tags = [
    tag("1", "beta", 5),
    tag("2", "Alpha", 12),
    tag("3", "delta", 12),
    tag("4", "charlie", 0),
  ];

  it("sorts by name ascending case-insensitively", () => {
    expect(sortTags(tags, "name", "asc").map((t) => t.name)).toEqual([
      "Alpha",
      "beta",
      "charlie",
      "delta",
    ]);
  });

  it("sorts by name descending", () => {
    expect(sortTags(tags, "name", "desc").map((t) => t.name)).toEqual([
      "delta",
      "charlie",
      "beta",
      "Alpha",
    ]);
  });

  it("sorts by count with A→Z name tiebreak that survives direction", () => {
    expect(sortTags(tags, "count", "desc").map((t) => t.name)).toEqual([
      "Alpha",
      "delta",
      "beta",
      "charlie",
    ]);
    expect(sortTags(tags, "count", "asc").map((t) => t.name)).toEqual([
      "charlie",
      "beta",
      "Alpha",
      "delta",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [tag("1", "b", 1), tag("2", "a", 2)];
    sortTags(input, "name", "asc");
    expect(input.map((t) => t.name)).toEqual(["b", "a"]);
  });
});

describe("filterTagsByQuery", () => {
  const tags = [tag("1", "概念设计", 3), tag("2", "Concept Art", 2)];

  it("returns all tags for a blank query", () => {
    expect(filterTagsByQuery(tags, "   ")).toHaveLength(2);
  });

  it("matches case-insensitively by substring", () => {
    expect(filterTagsByQuery(tags, "concept")).toEqual([tags[1]]);
    expect(filterTagsByQuery(tags, "概念")).toEqual([tags[0]]);
  });
});

describe("applyTagSelectionClick", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("plain click selects only the target and re-anchors", () => {
    const next = applyTagSelectionClick(
      { selectedIds: ["a", "b"], anchorId: "a" },
      "d",
      order,
      { toggle: false, range: false },
    );
    expect(next).toEqual({ selectedIds: ["d"], anchorId: "d" });
  });

  it("toggle click adds and removes the target", () => {
    const added = applyTagSelectionClick(
      { selectedIds: ["a"], anchorId: "a" },
      "c",
      order,
      { toggle: true, range: false },
    );
    expect(added.selectedIds).toEqual(["a", "c"]);
    expect(added.anchorId).toBe("c");
    const removed = applyTagSelectionClick(added, "a", order, {
      toggle: true,
      range: false,
    });
    expect(removed.selectedIds).toEqual(["c"]);
  });

  it("range click replaces selection with the anchor→target range", () => {
    const next = applyTagSelectionClick(
      { selectedIds: ["e"], anchorId: "b" },
      "d",
      order,
      { toggle: false, range: true },
    );
    expect(next.selectedIds).toEqual(["b", "c", "d"]);
    expect(next.anchorId).toBe("b");
  });

  it("range click works upwards", () => {
    const next = applyTagSelectionClick(
      { selectedIds: [], anchorId: "d" },
      "a",
      order,
      { toggle: false, range: true },
    );
    expect(next.selectedIds).toEqual(["a", "b", "c", "d"]);
  });

  it("toggle+range appends the range to the current selection", () => {
    const next = applyTagSelectionClick(
      { selectedIds: ["e"], anchorId: "a" },
      "b",
      order,
      { toggle: true, range: true },
    );
    expect(next.selectedIds).toEqual(["e", "a", "b"]);
  });

  it("range click without a usable anchor degrades to a plain click", () => {
    const next = applyTagSelectionClick(
      { selectedIds: ["c"], anchorId: "zzz" },
      "d",
      order,
      { toggle: false, range: true },
    );
    expect(next).toEqual({ selectedIds: ["d"], anchorId: "d" });
  });
});

describe("resolveTagMenuTargetIds", () => {
  it("keeps the selection when the chip is inside it", () => {
    expect(resolveTagMenuTargetIds(["a", "b"], "b")).toEqual(["a", "b"]);
  });

  it("collapses to the chip when it is outside the selection", () => {
    expect(resolveTagMenuTargetIds(["a", "b"], "c")).toEqual(["c"]);
  });
});
