import { describe, expect, it } from "vitest";

import {
  importOverlayDetail,
  importOverlayTitle,
  isBlockingImportOverlayVisible,
} from "../../src/renderer/import-progress-copy";
import type { ImportProgressEvent } from "../../src/shared/protocol/responses";

function progress(
  patch: Partial<ImportProgressEvent> = {},
): ImportProgressEvent {
  return {
    type: "import.progress",
    importId: "import-1",
    phase: "copy",
    cancelable: true,
    filesProcessed: 3,
    totalFiles: 10,
    bytesProcessed: 1024,
    totalBytes: 4096,
    ...patch,
  };
}

describe("import overlay copy", () => {
  it("does not cover the workspace until the worker sends a progress event", () => {
    expect(isBlockingImportOverlayVisible("importing", null)).toBe(false);
    expect(isBlockingImportOverlayVisible("ready", null)).toBe(false);
  });

  it("keeps the overlay up while copy/validate events are in flight", () => {
    expect(isBlockingImportOverlayVisible("ready", progress())).toBe(true);
    expect(
      isBlockingImportOverlayVisible("ready", progress({ phase: "complete" })),
    ).toBe(false);
  });

  it("uses an import title for file transfers and open titles for library conversion", () => {
    expect(importOverlayTitle("import")).toEqual({ key: "progress.importingAssets" });
    expect(importOverlayTitle("open").key).toBe("progress.openingLibrary");
  });

  it("shows counted copy progress instead of a generic registering phrase", () => {
    expect(importOverlayDetail(progress(), (bytes) => `${bytes}B`)).toEqual({
      key: "progress.copyingFiles",
      params: {
        processed: 3,
        total: 10,
        bytesProcessed: "1024B",
        bytesTotal: "4096B",
      },
    });
    expect(importOverlayDetail(null, () => "")).toEqual({
      key: "progress.importingStarted",
    });
  });
});
