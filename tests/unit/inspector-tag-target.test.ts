import { describe, expect, it } from "vitest";

import { resolveInspectorTagTarget } from "../../src/renderer/inspector-tag-target";

describe("resolveInspectorTagTarget", () => {
  it("routes to the batch path when two or more assets are selected", () => {
    expect(resolveInspectorTagTarget(["a", "b", "c"], "a")).toEqual({
      kind: "batch",
      assetIds: ["a", "b", "c"],
    });
    expect(resolveInspectorTagTarget(["a", "b"], "b")).toEqual({
      kind: "batch",
      assetIds: ["a", "b"],
    });
  });

  it("dedupes the selection before deciding", () => {
    expect(resolveInspectorTagTarget(["a", "a", "b"], "a")).toEqual({
      kind: "batch",
      assetIds: ["a", "b"],
    });
    expect(resolveInspectorTagTarget(["a", "a"], "a")).toEqual({
      kind: "single",
      assetId: "a",
    });
  });

  it("keeps the single-asset path at exactly one selected asset", () => {
    expect(resolveInspectorTagTarget(["a"], "a")).toEqual({
      kind: "single",
      assetId: "a",
    });
  });

  it("prefers the primary selection id for the single-asset path", () => {
    expect(resolveInspectorTagTarget([], "primary")).toEqual({
      kind: "single",
      assetId: "primary",
    });
  });

  it("falls back to the lone selection id when no primary is set", () => {
    expect(resolveInspectorTagTarget(["a"], undefined)).toEqual({
      kind: "single",
      assetId: "a",
    });
  });

  it("returns null when nothing is selected", () => {
    expect(resolveInspectorTagTarget([], undefined)).toBeNull();
  });
});
