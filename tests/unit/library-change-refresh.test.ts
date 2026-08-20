import { describe, expect, it } from "vitest";

import { shouldRefreshContentForLibraryChange } from "../../src/renderer/library-change-refresh";

describe("library change content refresh policy", () => {
  it("refreshes a NAS library when another instance commits a change", () => {
    expect(
      shouldRefreshContentForLibraryChange({
        networkStorage: true,
        importing: false,
      }),
    ).toBe(true);
  });

  it("keeps local change-sequence bumps from forcing a full reload", () => {
    expect(
      shouldRefreshContentForLibraryChange({
        networkStorage: false,
        importing: false,
      }),
    ).toBe(false);
    expect(
      shouldRefreshContentForLibraryChange({ importing: false }),
    ).toBe(false);
  });

  it("preserves the in-app import refresh path", () => {
    expect(
      shouldRefreshContentForLibraryChange({
        networkStorage: false,
        importing: true,
      }),
    ).toBe(true);
  });
});
