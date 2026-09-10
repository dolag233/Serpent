import { describe, expect, it } from "vitest";

import {
  canBeginImportDecisionSubmit,
  shouldSuppressImportContinueError,
} from "../../src/renderer/import-conflict-submit";

describe("import-conflict-submit", () => {
  it("rejects a second confirm while the first resolve is in flight", () => {
    expect(canBeginImportDecisionSubmit(false)).toBe(true);
    expect(canBeginImportDecisionSubmit(true)).toBe(false);
  });

  it("hides IMPORT_NOT_FOUND after the same import already completed", () => {
    expect(
      shouldSuppressImportContinueError({
        code: "IMPORT_NOT_FOUND",
        importId: "imp_1",
        completedImportId: "imp_1",
        isInFlightRequest: true,
      }),
    ).toBe(true);
  });

  it("hides IMPORT_NOT_FOUND from a stale duplicate click", () => {
    expect(
      shouldSuppressImportContinueError({
        code: "IMPORT_NOT_FOUND",
        importId: "imp_1",
        completedImportId: null,
        isInFlightRequest: false,
      }),
    ).toBe(true);
  });

  it("still surfaces IMPORT_NOT_FOUND when the in-flight request truly missed the token", () => {
    expect(
      shouldSuppressImportContinueError({
        code: "IMPORT_NOT_FOUND",
        importId: "imp_1",
        completedImportId: null,
        isInFlightRequest: true,
      }),
    ).toBe(false);
  });

  it("does not hide unrelated continue errors", () => {
    expect(
      shouldSuppressImportContinueError({
        code: "IMPORT_APPLY_FAILED",
        importId: "imp_1",
        completedImportId: "imp_1",
        isInFlightRequest: true,
      }),
    ).toBe(false);
  });
});
