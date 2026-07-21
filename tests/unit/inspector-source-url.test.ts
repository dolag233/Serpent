import { describe, expect, it } from "vitest";

import { isValidInspectorSourceUrl } from "../../src/renderer/inspector-source-url";

describe("isValidInspectorSourceUrl", () => {
  it("allows empty string (clear source)", () => {
    expect(isValidInspectorSourceUrl("")).toBe(true);
  });

  it("accepts plain http(s) URLs without credentials", () => {
    expect(isValidInspectorSourceUrl("https://example.com/path")).toBe(true);
    expect(isValidInspectorSourceUrl("http://example.com")).toBe(true);
  });

  it("rejects whitespace, credentials, and non-http schemes", () => {
    expect(isValidInspectorSourceUrl(" https://example.com")).toBe(false);
    expect(isValidInspectorSourceUrl("https://user:pass@example.com")).toBe(
      false,
    );
    expect(isValidInspectorSourceUrl("ftp://example.com")).toBe(false);
    expect(isValidInspectorSourceUrl("not-a-url")).toBe(false);
  });
});
