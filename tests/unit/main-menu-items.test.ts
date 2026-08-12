import { describe, expect, it, vi } from "vitest";

import {
  buildMainMenuSections,
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
  });
});
