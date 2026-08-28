import { describe, expect, it, vi } from "vitest";

import {
  buildMainMenuSections,
  collectMainMenuCommandStates,
  type MainMenuActions,
} from "../../src/renderer/main-menu-items";

function createActions(): MainMenuActions {
  return {
    createLibrary: vi.fn(),
    openLibrary: vi.fn(),
    closeLibrary: vi.fn(),
    removeLibrary: vi.fn(),
    deleteLibraryFromDisk: vi.fn(),
    importFiles: vi.fn(),
    importFolder: vi.fn(),
    importLinkedFolder: vi.fn(),
    importLibrary: vi.fn(),
    exportLibrary: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    copySelection: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
    invertSelection: vi.fn(),
    clearSelection: vi.fn(),
    openSettings: vi.fn(),
    openBackgroundJobs: vi.fn(),
    openAppLog: vi.fn(),
    openAbout: vi.fn(),
    openGitHub: vi.fn(),
    openOpenSourceLicenses: vi.fn(),
  };
}

function build(overrides?: Partial<Parameters<typeof buildMainMenuSections>[0]>) {
  const actions = createActions();
  const sections = buildMainMenuSections({
    locale: "zh-CN",
    platform: "windows",
    state: {
      libraryOpen: true,
      busy: false,
      hasUndoableOperation: true,
      hasRedoableOperation: false,
      hasSelectedAssets: true,
      hasPasteTarget: true,
      hasBrowseAssets: true,
    },
    actions,
    ...overrides,
  });
  return { actions, sections };
}

describe("main-menu-items (Serpent-bnah)", () => {
  it("splits the menu bar into stable Windows sections", () => {
    const { sections } = build();
    expect(sections.map((section) => section.id)).toEqual([
      "file",
      "edit",
      "library",
      "window",
      "about",
      "settings",
    ]);
    expect(sections.map((section) => section.label)).toEqual([
      "文件",
      "编辑",
      "资源库",
      "窗口",
      "关于",
      "设置",
    ]);
    expect(sections[1]?.items?.find((item) => item.id === "edit.select-all")?.shortcut).toBe(
      "Ctrl+A",
    );
    expect(sections[1]?.items?.find((item) => item.id === "edit.undo")?.shortcut).toBe(
      "Ctrl+Z",
    );
    expect(sections[1]?.items?.find((item) => item.id === "edit.redo")?.shortcut).toBe(
      "Ctrl+Shift+Z",
    );
  });

  it("uses the macOS undo and redo shortcut labels", () => {
    const { sections } = build({ platform: "mac" });
    const edit = sections.find((section) => section.id === "edit");
    expect(edit?.items?.find((item) => item.id === "edit.undo")?.shortcut).toBe("⌘Z");
    expect(edit?.items?.find((item) => item.id === "edit.redo")?.shortcut).toBe("⌘⇧Z");
  });

  it("gates library and selection actions from the shared state", () => {
    const { sections } = build({
      state: {
        libraryOpen: false,
        busy: true,
        hasUndoableOperation: false,
        hasRedoableOperation: false,
        hasSelectedAssets: false,
        hasPasteTarget: false,
        hasBrowseAssets: false,
      },
    });
    const file = sections.find((section) => section.id === "file");
    const edit = sections.find((section) => section.id === "edit");
    expect(file?.items?.every((item) => item.disabled)).toBe(true);
    expect(edit?.items?.find((item) => item.id === "edit.select-all")?.disabled).toBe(true);
    expect(edit?.items?.find((item) => item.id === "edit.clear-selection")?.disabled).toBe(true);
  });

  it("replaces the version display with a check-for-updates item (Serpent-0fe8b4)", () => {
    const { actions, sections } = build();
    const about = sections.find((section) => section.id === "about");
    expect(about?.items?.find((item) => item.id === "about.version")).toBeUndefined();
    const checkUpdate = about?.items?.find(
      (item) => item.id === "about.check-update",
    );
    expect(checkUpdate?.label).toBe("检查更新");
    checkUpdate?.onSelect?.();
    expect(actions.openAbout).toHaveBeenCalledTimes(1);
  });

  it("keeps the action callbacks attached to their split menu items", () => {
    const { actions, sections } = build();
    const settings = sections.find((section) => section.id === "settings");
    settings?.onSelect?.();
    expect(actions.openSettings).toHaveBeenCalledTimes(1);
    expect(settings?.items).toBeUndefined();
    expect(sections.find((section) => section.id === "window")?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "window.background-jobs" }),
        expect.objectContaining({ id: "window.diagnostics" }),
      ]),
    );
    const about = sections.find((section) => section.id === "about");
    const diagnostics = about?.items?.find((item) => item.id === "about.diagnostics");
    diagnostics?.onSelect?.();
    expect(actions.openAppLog).toHaveBeenCalledTimes(1);
  });

  it("keeps the Library menu aligned with the library switcher", () => {
    const { sections } = build();
    const file = sections.find((section) => section.id === "file");
    const library = sections.find((section) => section.id === "library");
    expect(file?.items?.some((item) => item.id === "library.import-eagle")).toBe(false);
    expect(library?.items?.map((item) => item.id)).toEqual([
      "library.create",
      "library.open",
      "library.close",
      "library.import",
      "library.export",
      "library.remove",
      "library.delete-from-disk",
      "library.settings",
    ]);
    expect(library?.items?.find((item) => item.id === "library.rename")).toBeUndefined();
    expect(library?.items?.find((item) => item.id === "library.open-external")).toBeUndefined();
    expect(library?.items?.find((item) => item.id === "library.import-external")).toBeUndefined();
    expect(library?.items?.find((item) => item.id === "library.delete-from-disk")?.danger).toBe(
      true,
    );
  });

  it("maps canonical custom commands to native enabled states", () => {
    const { sections } = build({
      state: {
        libraryOpen: false,
        busy: true,
        hasUndoableOperation: false,
        hasRedoableOperation: false,
        hasSelectedAssets: false,
        hasPasteTarget: false,
        hasBrowseAssets: false,
      },
    });
    const states = new Map(
      collectMainMenuCommandStates(sections).map((state) => [state.command, state.enabled]),
    );
    expect(states.get("library.close")).toBe(false);
    expect(states.get("library.open")).toBe(false);
    expect(states.get("library.export")).toBe(false);
    expect(states.get("settings")).toBe(false);
    expect(states.get("window.diagnostics")).toBe(true);
  });

  it("does not expose a library rename menu item", () => {
    const { sections } = build();
    const library = sections.find((section) => section.id === "library");
    expect(library?.items?.some((item) => item.id === "library.rename")).toBe(false);
  });
});
