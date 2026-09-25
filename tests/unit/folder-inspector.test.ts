import { describe, expect, it } from "vitest";

import { folderInspectorPathLabel } from "../../src/renderer/folder-inspector";

describe("folder inspector", () => {
  it("shows one path and hides paths that differ", () => {
    expect(folderInspectorPathLabel([
      { relativePath: "Art/Boards" },
    ], "根目录")).toBe("/根目录/Art/Boards");
    expect(folderInspectorPathLabel([
      { relativePath: "" },
    ], "根目录")).toBe("/根目录");
    expect(folderInspectorPathLabel([
      { relativePath: "Art/Boards" },
      { relativePath: "Art/Refs" },
    ], "根目录")).toBeNull();
  });
});
