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
  importLibraryChooserOpen: false,
  appSettingsOpen: false,
  appLogOpen: false,
  aboutOpen: false,
  openSourceLicensesOpen: false,
  mediaJobsOpen: false,
  linkedRulesEditorOpen: false,
  convertLinkedOpen: false,
  dialogOpen: false,
  fatalAlertOpen: false,
  aiConnectionFailureOpen: false,
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

  it("prefers fatal alert over AI connection failure and other layers (Serpent-99lv)", () => {
    expect(
      resolveDialogEscapeAction({
        ...empty,
        fatalAlertOpen: true,
        aiConnectionFailureOpen: true,
        assetRenameOpen: true,
        mediaJobsOpen: true,
      }),
    ).toEqual({ kind: "dismiss-fatal-alert" });
  });

  it("prefers AI connection failure over other layers (Serpent-kdnm)", () => {
    expect(
      resolveDialogEscapeAction({
        ...empty,
        aiConnectionFailureOpen: true,
        assetRenameOpen: true,
        mediaJobsOpen: true,
      }),
    ).toEqual({ kind: "abort-ai-connection-failure" });
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

  it("treats embedded AI configuration as part of settings", () => {
    expect(
      resolveDialogEscapeAction({
        ...empty,
        appSettingsOpen: true,
      }),
    ).toEqual({ kind: "close-app-settings" });
  });

  it("closes app settings when that layer is open", () => {
    expect(
      resolveDialogEscapeAction({
        ...empty,
        appSettingsOpen: true,
        mediaJobsOpen: true,
      }),
    ).toEqual({ kind: "close-app-settings" });
  });

  it("closes diagnostics after settings but before background jobs", () => {
    expect(
      resolveDialogEscapeAction({
        ...empty,
        appLogOpen: true,
        mediaJobsOpen: true,
      }),
    ).toEqual({ kind: "close-app-log" });
  });
});
