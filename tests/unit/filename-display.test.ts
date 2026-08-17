import { describe, expect, it } from "vitest";

import { splitFilenameForDisplay } from "../../src/renderer/filename-display";

describe("splitFilenameForDisplay", () => {
  it("keeps the extension and final stem characters available for ellipsis", () => {
    expect(splitFilenameForDisplay("asdfghjklwertyuizxcvbnm.png")).toEqual({
      prefix: "asdfghjklwertyuizxcv",
      tail: "bnm",
      extension: ".png",
    });
  });

  it("handles names without an extension", () => {
    expect(splitFilenameForDisplay("abcdefghijkl")).toEqual({
      prefix: "abcdefghi",
      tail: "jkl",
      extension: "",
    });
  });

  it("does not invent an ellipsis for short names", () => {
    expect(splitFilenameForDisplay("a.png")).toEqual({
      prefix: "a",
      tail: "",
      extension: ".png",
    });
  });
});
