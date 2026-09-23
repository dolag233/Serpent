import { describe, expect, it } from "vitest";

import { GITIGNORE_PREVIEW_ROW_LIMIT } from "../../src/shared/asset-types";
import {
  buildGitignorePreviewListRows,
  type GitignorePreviewCandidate,
} from "../../src/shared/gitignore-preview";
import { parseGitignore } from "../../src/worker/gitignore";
import { diffGitignoreHits } from "../../src/worker/gitignore-preview";

function candidate(
  relativePath: string,
  pathKind: GitignorePreviewCandidate["pathKind"] = "asset",
): GitignorePreviewCandidate {
  return {
    locationKind: "managed",
    linkedFolderId: null,
    relativePath,
    pathKind,
    displayName: relativePath,
  };
}

describe("gitignore draft preview", () => {
  it("marks newly hidden, newly shown, and unchanged hits", () => {
    const saved = parseGitignore("*.tmp\n");
    const draft = parseGitignore("*.png\n");
    const preview = diffGitignoreHits(
      [
        candidate("notes.tmp"),
        candidate("icon.png"),
        candidate("keep.txt"),
        candidate(".cache", "folder"),
      ],
      saved,
      draft,
    );

    expect(preview.currentCount).toBe(1);
    expect(preview.addedCount).toBe(1);
    expect(preview.removedCount).toBe(1);
    expect(preview.truncated).toBe(false);
    expect(preview.rows).toEqual([
      expect.objectContaining({ relativePath: "icon.png", change: "added" }),
      expect.objectContaining({ relativePath: "notes.tmp", change: "removed" }),
    ]);
    expect(buildGitignorePreviewListRows(preview.rows)).toEqual([
      ["", { segments: [{ text: "icon.png", tone: "change" }] }],
      [{ segments: [{ text: "notes.tmp", tone: "match" }] }, ""],
    ]);
  });

  it("keeps still-ignored rows unhighlighted after the add/remove rows", () => {
    const rules = parseGitignore("*.tmp\ncache/\n");
    const preview = diffGitignoreHits(
      [candidate("notes.tmp"), candidate("cache", "folder"), candidate("keep.txt")],
      rules,
      rules,
    );

    expect(preview).toMatchObject({
      currentCount: 2,
      addedCount: 0,
      removedCount: 0,
      truncated: false,
    });
    expect(preview.rows.map((row) => row.change)).toEqual(["kept", "kept"]);
    expect(buildGitignorePreviewListRows(preview.rows)).toEqual([
      ["cache", "cache"],
      ["notes.tmp", "notes.tmp"],
    ]);
  });

  it("caps visible rows at the renamer preview limit and prefers add/remove rows", () => {
    const saved = parseGitignore("");
    const draft = parseGitignore("*.log\n");
    const candidates = Array.from({ length: GITIGNORE_PREVIEW_ROW_LIMIT + 3 }, (_, index) =>
      candidate(`file-${String(index).padStart(3, "0")}.log`),
    );
    const preview = diffGitignoreHits(candidates, saved, draft);

    expect(preview.addedCount).toBe(GITIGNORE_PREVIEW_ROW_LIMIT + 3);
    expect(preview.currentCount).toBe(0);
    expect(preview.truncated).toBe(true);
    expect(preview.rows).toHaveLength(GITIGNORE_PREVIEW_ROW_LIMIT);
    expect(preview.rows.every((row) => row.change === "added")).toBe(true);
  });
});
