import { describe, expect, it } from "vitest";

import { applyImportPrepareResult } from "../../src/renderer/apply-import-prepare-result";
import type {
  ImportCompletion,
  ImportConflictPlan,
  ImportSourceFailurePlan,
  ImageSequenceImportOffer,
} from "../../src/shared/protocol/responses";

const completion: ImportCompletion = {
  importedCount: 1,
  fileCount: 1,
  assetCount: 1,
  skippedCount: 0,
  replacedCount: 0,
  assets: [],
};

const conflicts: ImportConflictPlan = {
  importId: "imp_c",
  fileCount: 2,
  totalBytes: 10,
  suspectedDuplicateCount: 1,
  libraryDuplicateCount: 0,
  nameConflictCount: 0,
  examples: [],
};

const sourceFailure: ImportSourceFailurePlan = {
  importId: "imp_sf",
  failedCount: 1,
  remainingCount: 3,
  examples: [{ displayName: "locked.png" }],
};

const sequenceOffer: ImageSequenceImportOffer = {
  defaultFps: 30,
  libraryId: "lib_1",
  selectedPaths: [],
  sequences: [],
};

describe("applyImportPrepareResult", () => {
  it("returns the completion when no dialog is needed", () => {
    const seen: string[] = [];
    expect(
      applyImportPrepareResult(completion, {
        onConflicts: () => seen.push("conflicts"),
        onSourceFailure: () => seen.push("source-failure"),
        onSequenceOffer: () => seen.push("sequence"),
      }),
    ).toEqual(completion);
    expect(seen).toEqual([]);
  });

  it("routes source-failure before treating importId as a conflict plan", () => {
    const seen: string[] = [];
    expect(
      applyImportPrepareResult(sourceFailure, {
        onConflicts: () => seen.push("conflicts"),
        onSourceFailure: () => seen.push("source-failure"),
        onSequenceOffer: () => seen.push("sequence"),
      }),
    ).toBeNull();
    expect(seen).toEqual(["source-failure"]);
  });

  it("routes conflict and sequence offers to their dialogs", () => {
    const seen: string[] = [];
    expect(
      applyImportPrepareResult(conflicts, {
        onConflicts: () => seen.push("conflicts"),
        onSourceFailure: () => seen.push("source-failure"),
        onSequenceOffer: () => seen.push("sequence"),
      }),
    ).toBeNull();
    expect(
      applyImportPrepareResult(sequenceOffer, {
        onConflicts: () => seen.push("conflicts"),
        onSourceFailure: () => seen.push("source-failure"),
        onSequenceOffer: () => seen.push("sequence"),
      }),
    ).toBeNull();
    expect(seen).toEqual(["conflicts", "sequence"]);
  });
});
