import { describe, expect, it } from "vitest";
import { summarizeHeapSnapshot, type HeapSnapshot } from "../e2e/heap-snapshot-summary";

function fixture(): HeapSnapshot {
  return {
    snapshot: { meta: {
      node_fields: ["type", "name", "self_size", "edge_count"],
      node_types: [["synthetic", "object", "array", "string"]],
      edge_fields: ["type", "name_or_index", "to_node"],
      edge_types: [["internal", "weak"]],
    } },
    // root -> Map -> table -> private string; root weak -> unreachable array.
    nodes: [0, 0, 0, 2, 1, 1, 32, 1, 2, 2, 1200, 1, 3, 3, 800, 0, 2, 2, 2000, 0],
    edges: [0, 0, 4, 1, 0, 16, 0, 0, 8, 0, 0, 12],
    strings: ["root", "Map", "private-source-name", "private-source-content"],
  };
}

describe("anonymous heap summary", () => {
  it("derives strong root paths from metadata and excludes weak-only reachability", () => {
    const result = summarizeHeapSnapshot(fixture());
    expect(result.nodeCount).toBe(5);
    expect(result.strongReachableCount).toBe(4);
    expect(result.largestShallowAllocations[0]).toMatchObject({ kind: "array", selfBytes: 2000, rootDistance: null });
    expect(result.largestShallowAllocations[1]?.rootPath).toEqual(["synthetic", "object:Map", "array"]);
  });

  it("never includes source strings, private node names, or edge names", () => {
    const result = JSON.stringify(summarizeHeapSnapshot(fixture()));
    expect(result).not.toContain("private-source");
    expect(result).not.toContain("root\"");
    expect(result).toContain('"name":"Map"');
  });

  it("rejects invalid graph counts instead of attributing false retainers", () => {
    const data = fixture();
    data.nodes[3] = 100;
    expect(() => summarizeHeapSnapshot(data)).toThrow("Invalid heap snapshot edge counts.");
  });
});
