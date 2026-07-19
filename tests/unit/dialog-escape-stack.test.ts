import { describe, expect, it } from "vitest";

import {
  isDialogEscapeLayerActive,
  resolveDialogEscapeAction,
  type DialogEscapeSnapshot,
} from "../../src/renderer/dialog-escape-stack";

const empty: DialogEscapeSnapshot = {
  assetRenameOpen: false,
  permanentDeleteOpen: false,
  diskDeleteOpen: false,
  deleteLinkedOpen: false,
  batchRelinkOpen: false,
  restoreOpen: false,
  moveOpen: false,
  undoMoveOpen: false,
  collectionEditorOpen: false,
  exportDialogOpen: false,
  appSettingsOpen: false,
  aiConfigOpen: false,
  extensionPairingOpen: false,
  mediaJobsOpen: false,
  linkedRulesEditorOpen: false,
  convertLinkedOpen: false,
  dialogOpen: false,
  conflictsImportId: null,
};

describe("dialog-escape-stack", () => {
  it("returns none when no layer is open", () => {
    expect(resolveDialogEscapeAction(empty)).toEqual({ kind: "none" });
    expect(isDialogEscapeLayerActive(empty)).toBe(false);
  });

  it("prefers asset rename over later layers", () => {
    expect(
      resolveDialogEscapeAction({
        ...empty,
        assetRenameOpen: true,
        dialogOpen: true,
        conflictsImportId: "imp_1",
      }),
    ).toEqual({ kind: "cancel-asset-rename" });
  });

  it("abandons import when only conflicts remain", () => {
    expect(
      resolveDialogEscapeAction({
        ...empty,
        conflictsImportId: "imp_9",
      }),
    ).toEqual({ kind: "abandon-import", importId: "imp_9" });
    expect(
      isDialogEscapeLayerActive({
        ...empty,
        conflictsImportId: "imp_9",
      }),
    ).toBe(true);
  });

  it("closes generic dialog before conflicts", () => {
    expect(
      resolveDialogEscapeAction({
        ...empty,
        dialogOpen: true,
        conflictsImportId: "imp_2",
      }),
    ).toEqual({ kind: "close-dialog" });
  });
});
