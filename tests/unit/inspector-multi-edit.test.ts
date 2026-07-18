import { describe, expect, it } from "vitest";

import {
  buildInspectorMultiEdit,
  intersectAssetTags,
  isEditableScalar,
  pickInspectorStackAssets,
  resolveScalarField,
  type MultiEditMetadataSlice,
} from "../../src/renderer/inspector-multi-edit";

describe("resolveScalarField", () => {
  it("returns null for an empty list", () => {
    expect(resolveScalarField([])).toBeNull();
  });

  it("treats identical values as uniform (including all empty strings)", () => {
    expect(resolveScalarField(["", ""])).toEqual({ kind: "uniform", value: "" });
    expect(resolveScalarField([3, 3, 3])).toEqual({ kind: "uniform", value: 3 });
    expect(resolveScalarField([true, true])).toEqual({
      kind: "uniform",
      value: true,
    });
  });

  it("marks disagreement as mixed", () => {
    expect(resolveScalarField(["a", "b"])).toEqual({ kind: "mixed" });
    expect(resolveScalarField([0, 1, 0])).toEqual({ kind: "mixed" });
    expect(resolveScalarField([false, true])).toEqual({ kind: "mixed" });
  });

  it("uses a custom equality comparator when provided", () => {
    expect(
      resolveScalarField(
        [
          ["#AA0000"],
          ["#AA0000"],
        ],
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
    ).toEqual({ kind: "uniform", value: ["#AA0000"] });
    expect(
      resolveScalarField(
        [["#AA0000"], ["#BB0000"]],
        (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
      ),
    ).toEqual({ kind: "mixed" });
  });
});

describe("intersectAssetTags", () => {
  it("returns empty for empty input", () => {
    expect(intersectAssetTags([])).toEqual([]);
  });

  it("keeps only tags present on every asset", () => {
    expect(
      intersectAssetTags([
        [
          { id: "t1", name: "Shared", source: "user" },
          { id: "t2", name: "OnlyA", source: "user" },
        ],
        [
          { id: "t1", name: "Shared", source: "user" },
          { id: "t3", name: "OnlyB", source: "user" },
        ],
      ]),
    ).toEqual([{ id: "t1", name: "Shared", source: "user" }]);
  });

  it("marks source as user only when every asset has it as user", () => {
    expect(
      intersectAssetTags([
        [{ id: "t1", name: "Mixed", source: "user" }],
        [{ id: "t1", name: "Mixed", source: "ai" }],
      ]),
    ).toEqual([{ id: "t1", name: "Mixed", source: "ai" }]);
  });

  it("returns empty intersection when no overlap", () => {
    expect(
      intersectAssetTags([
        [{ id: "t1", name: "A", source: "user" }],
        [{ id: "t2", name: "B", source: "user" }],
      ]),
    ).toEqual([]);
  });
});

describe("buildInspectorMultiEdit", () => {
  const base = (overrides: Partial<MultiEditMetadataSlice>): MultiEditMetadataSlice => ({
    description: null,
    rating: 0,
    favorite: false,
    sourcePageUrl: null,
    palette: [],
    tags: [],
    ...overrides,
  });

  it("returns null for fewer than two slices", () => {
    expect(buildInspectorMultiEdit([])).toBeNull();
    expect(buildInspectorMultiEdit([base({})])).toBeNull();
  });

  it("builds uniform scalars and intersecting tags", () => {
    const model = buildInspectorMultiEdit([
      base({
        description: "same",
        rating: 4,
        favorite: true,
        sourcePageUrl: "https://example.com",
        palette: ["#111111"],
        tags: [
          { id: "shared", name: "Shared", source: "user" },
          { id: "a-only", name: "A", source: "user" },
        ],
      }),
      base({
        description: "same",
        rating: 4,
        favorite: true,
        sourcePageUrl: "https://example.com",
        palette: ["#111111"],
        tags: [
          { id: "shared", name: "Shared", source: "user" },
          { id: "b-only", name: "B", source: "user" },
        ],
      }),
    ]);

    expect(model).toEqual({
      selectionCount: 2,
      description: { kind: "uniform", value: "same" },
      rating: { kind: "uniform", value: 4 },
      favorite: { kind: "uniform", value: true },
      sourceUrl: { kind: "uniform", value: "https://example.com" },
      palette: { kind: "uniform", value: ["#111111"] },
      tags: [{ id: "shared", name: "Shared", source: "user" }],
    });
    expect(isEditableScalar(model!.description)).toBe(true);
  });

  it("marks mismatched scalars as mixed while still exposing tag intersection", () => {
    const model = buildInspectorMultiEdit([
      base({
        description: "a",
        rating: 1,
        favorite: false,
        tags: [{ id: "t", name: "T", source: "user" }],
      }),
      base({
        description: "b",
        rating: 2,
        favorite: true,
        tags: [{ id: "t", name: "T", source: "user" }],
      }),
    ]);

    expect(model?.description).toEqual({ kind: "mixed" });
    expect(model?.rating).toEqual({ kind: "mixed" });
    expect(model?.favorite).toEqual({ kind: "mixed" });
    expect(model?.tags).toEqual([{ id: "t", name: "T", source: "user" }]);
    expect(isEditableScalar(model!.description)).toBe(false);
  });

  it("treats null and empty description as the same empty value", () => {
    const model = buildInspectorMultiEdit([
      base({ description: null }),
      base({ description: "" }),
    ]);
    expect(model?.description).toEqual({ kind: "uniform", value: "" });
  });
});

describe("pickInspectorStackAssets", () => {
  it("puts the primary asset first and caps visible layers", () => {
    const primary = { assetId: "a" };
    const selected = [
      { assetId: "b" },
      { assetId: "a" },
      { assetId: "c" },
      { assetId: "d" },
    ];
    expect(pickInspectorStackAssets(primary, selected, 3)).toEqual([
      { assetId: "a" },
      { assetId: "b" },
      { assetId: "c" },
    ]);
  });

  it("returns only the primary when nothing else is selected", () => {
    const primary = { assetId: "a" };
    expect(pickInspectorStackAssets(primary, [primary], 3)).toEqual([primary]);
  });
});
