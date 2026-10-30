import { expect, test } from "vitest";

import { rollupDirectFolderCounts } from "../../src/shared/filtered-folder-counts";

test("rollup adds each subtree into its ancestors once", () => {
  const totals = rollupDirectFolderCounts(
    [
      { folderId: "parent", parentFolderId: null },
      { folderId: "child", parentFolderId: "parent" },
      { folderId: "grandchild", parentFolderId: "child" },
      { folderId: "sibling", parentFolderId: "parent" },
    ],
    new Map([
      ["parent", 1],
      ["child", 2],
      ["grandchild", 4],
      ["sibling", 8],
    ]),
  );
  expect(totals.get("grandchild")).toBe(4);
  expect(totals.get("child")).toBe(6);
  expect(totals.get("sibling")).toBe(8);
  expect(totals.get("parent")).toBe(15);
});
