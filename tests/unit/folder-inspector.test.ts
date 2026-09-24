import { describe, expect, it } from "vitest";

import { folderInspectorPathLabel } from "../../src/renderer/folder-inspector";

describe("folder inspector", () => {
  it("shows one path and hides paths that differ", () => {
    expect(folderInspectorPathLabel([
      { relativePath: "Art/Boards" },
    ])).toBe("Art/Boards");
    expect(folderInspectorPathLabel([
      { relativePath: "Art/Boards" },
      { relativePath: "Art/Refs" },
    ])).toBeNull();
    expect(folderInspectorPathLabel([
      { relativePath: "" },
    ])).toBeNull();
  });
});
