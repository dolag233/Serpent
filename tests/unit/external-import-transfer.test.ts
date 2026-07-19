import { expect, test } from "vitest";

import { MANAGED_ASSETS_DRAG_TYPE } from "../../src/renderer/asset-drag-drop";
import { supportsExternalImportTypes } from "../../src/renderer/external-import-transfer";

test("external import accepts Files / html / uri-list", () => {
  expect(supportsExternalImportTypes(["Files"])).toBe(true);
  expect(supportsExternalImportTypes(["text/uri-list"])).toBe(true);
  expect(supportsExternalImportTypes(["text/html", "Files"])).toBe(true);
});

test("managed asset drag is never treated as external import", () => {
  expect(
    supportsExternalImportTypes([MANAGED_ASSETS_DRAG_TYPE, "Files"]),
  ).toBe(false);
  expect(supportsExternalImportTypes([MANAGED_ASSETS_DRAG_TYPE])).toBe(false);
});
