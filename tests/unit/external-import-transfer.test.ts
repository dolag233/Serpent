import { expect, test } from "vitest";

import { MANAGED_ASSETS_DRAG_TYPE } from "../../src/renderer/asset-drag-drop";
import {
  reduceInternalDragPhase,
  shouldActivateExternalImportOverlay,
  supportsExternalImportTypes,
} from "../../src/renderer/external-import-transfer";

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

test("an in-app asset drag does not open the import overlay", () => {
  expect(shouldActivateExternalImportOverlay(["Files"], true)).toBe(false);
  expect(shouldActivateExternalImportOverlay(["Files"], false)).toBe(true);
  expect(
    shouldActivateExternalImportOverlay([MANAGED_ASSETS_DRAG_TYPE, "Files"], false),
  ).toBe(false);
});

test("the cancelled HTML5 dragend does not end an in-app OS drag", () => {
  let phase = reduceInternalDragPhase("idle", "begin");
  phase = reduceInternalDragPhase(phase, "dragend");
  expect(phase).toBe("starting");
  expect(shouldActivateExternalImportOverlay(["Files"], phase !== "idle")).toBe(false);
  phase = reduceInternalDragPhase(phase, "arm");
  expect(phase).toBe("active");
  phase = reduceInternalDragPhase(phase, "drop");
  expect(phase).toBe("idle");
  expect(shouldActivateExternalImportOverlay(["Files"], phase !== "idle")).toBe(true);
});
