import { describe, expect, it } from "vitest";

import {
  applyRendererPlatform,
  resolveRendererPlatform,
} from "../../src/renderer/renderer-platform";

describe("renderer platform marker", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      "macos",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", "other"],
  ] as const)("maps %s to %s", (userAgent, expected) => {
    expect(resolveRendererPlatform(userAgent)).toBe(expected);
  });

  it("writes the resolved platform before application render", () => {
    const root = { dataset: {} as DOMStringMap };

    expect(applyRendererPlatform(root, "Windows NT 10.0; Win64; x64")).toBe(
      "windows",
    );
    expect(root.dataset.platform).toBe("windows");
  });
});
