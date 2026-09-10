import { describe, expect, it } from "vitest";

import {
  isBatchAbortingImportSourceFailure,
  isSkippableImportSourceFailure,
  skippedImportSourceFromError,
  toImportSourceFailurePlan,
} from "../../src/worker/import-source-failure";
import { LibraryServiceError } from "../../src/worker/library-service";

describe("import-source-failure", () => {
  it("treats unreadable single-file errors as skippable", () => {
    expect(
      isSkippableImportSourceFailure(
        new LibraryServiceError("INVALID_IMPORT_SOURCE", {
          reason: "SYMBOLIC_LINK_NOT_ALLOWED",
        }),
      ),
    ).toBe(true);
    expect(isSkippableImportSourceFailure({ code: "ENOENT" })).toBe(true);
    expect(isSkippableImportSourceFailure({ code: "EACCES" })).toBe(true);
  });

  it("keeps disk-full, root, and cancel failures as batch-aborting", () => {
    expect(
      isBatchAbortingImportSourceFailure(
        new LibraryServiceError("INVALID_IMPORT_SOURCE", { reason: "ROOT_NOT_ALLOWED" }),
      ),
    ).toBe(true);
    expect(
      isSkippableImportSourceFailure(
        new LibraryServiceError("INVALID_IMPORT_SOURCE", { reason: "DISK_FULL" }),
      ),
    ).toBe(false);
    expect(isSkippableImportSourceFailure({ code: "CANCELLED" })).toBe(false);
    expect(isSkippableImportSourceFailure({ code: "ENAMETOOLONG" })).toBe(false);
  });

  it("builds a skip plan with examples and remaining files", () => {
    const failed = skippedImportSourceFromError(
      new LibraryServiceError("INVALID_IMPORT_SOURCE", {
        reason: "SYMBOLIC_LINK_NOT_ALLOWED",
      }),
      "C:\\inbox\\locked.png",
    );
    expect(failed).toMatchObject({
      displayName: "locked.png",
      reason: "SYMBOLIC_LINK_NOT_ALLOWED",
    });
    expect(
      toImportSourceFailurePlan({
        importId: "imp_1",
        failed: [failed],
        remainingCount: 4,
      }),
    ).toEqual({
      importId: "imp_1",
      failedCount: 1,
      remainingCount: 4,
      examples: [
        { displayName: "locked.png", reason: "SYMBOLIC_LINK_NOT_ALLOWED" },
      ],
    });
  });
});
