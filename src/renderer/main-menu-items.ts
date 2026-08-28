import packageJson from "../../package.json";

import {
  translateForLocale,
  type AppLocale,
  type TranslateParams,
} from "./i18n";
import type { IconName } from "./Icons";
import type { CommandPlatform } from "./commands/command-types";
import type { ApplicationMenuCommand } from "../shared/application-menu";

export const SERPENT_VERSION = packageJson.version;

export type MainMenuSectionId =
  | "file"
  | "edit"
  | "library"
  | "window"
  | "settings"
  | "about";

export type MainMenuItem = {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly submenu?: readonly MainMenuItem[];
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly onSelect: () => void;
};

export type MainMenuSection = {
  readonly id: MainMenuSectionId;
  readonly label: string;
  readonly icon: IconName;
  readonly items?: readonly MainMenuItem[];
  readonly disabled?: boolean;
  readonly onSelect?: () => void;
};

export type MainMenuCommandState = {
  readonly command: ApplicationMenuCommand;
  readonly enabled: boolean;
};

const APPLICATION_MENU_ITEM_COMMANDS: Readonly<Record<string, ApplicationMenuCommand>> = {
  "edit.copy-selection": "copy-selection",
  "edit.invert-selection": "invert-selection",
  "file.import-files": "file.import-files",
  "file.import-folder": "file.import-folder",
  "file.import-linked-folder": "file.import-linked-folder",
  "edit.undo": "edit.undo",
  "edit.redo": "edit.redo",
  "library.create": "library.create",
  "library.open": "library.open",
  "library.close": "library.close",
  "library.remove": "library.remove",
  "library.delete-from-disk": "library.delete-from-disk",
  "library.import": "library.import",
  "library.export": "library.export",
  "library.settings": "library.settings",
  "window.background-jobs": "window.background-jobs",
  "window.diagnostics": "window.diagnostics",
  "about.serpent": "about.serpent",
  "about.github": "about.github",
  "about.open-source": "about.open-source",
  "about.diagnostics": "about.diagnostics",
};

/**
 * Convert the canonical renderer menu into enabled states for macOS's native
 * custom command items. Native roles keep their own Chromium semantics; only
 * commands routed back into the renderer need explicit synchronization.
 */
export function collectMainMenuCommandStates(
  sections: readonly MainMenuSection[],
): MainMenuCommandState[] {
  const states = new Map<ApplicationMenuCommand, boolean>();
  const visit = (items: readonly MainMenuItem[], sectionEnabled: boolean) => {
    for (const item of items) {
      const command = APPLICATION_MENU_ITEM_COMMANDS[item.id];
      if (command) states.set(command, sectionEnabled && !item.disabled);
      if (item.submenu) visit(item.submenu, sectionEnabled && !item.disabled);
    }
  };
  for (const section of sections) {
    const sectionEnabled = !section.disabled;
    if (section.id === "settings") {
      states.set("settings", sectionEnabled);
    }
    visit(section.items ?? [], sectionEnabled);
  }
  return [...states].map(([command, enabled]) => ({ command, enabled }));
}

export type MainMenuActions = {
  readonly createLibrary: () => void;
  readonly openLibrary: () => void;
  readonly closeLibrary: () => void;
  readonly removeLibrary: () => void;
  readonly deleteLibraryFromDisk: () => void;
  readonly importFiles: () => void;
  readonly importFolder: () => void;
  readonly importLinkedFolder: () => void;
  readonly importLibrary: () => void;
  readonly exportLibrary: () => void;
  readonly openLibrarySettings?: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly copySelection: () => void;
  readonly paste: () => void;
  readonly selectAll: () => void;
  readonly invertSelection: () => void;
  readonly clearSelection: () => void;
  readonly openSettings: () => void;
  readonly openBackgroundJobs: () => void;
  readonly openAppLog: () => void;
  readonly openAbout: () => void;
  readonly openGitHub: () => void;
  readonly openOpenSourceLicenses: () => void;
};

export type MainMenuState = {
  readonly libraryOpen: boolean;
  readonly busy: boolean;
  readonly hasUndoableOperation: boolean;
  readonly hasRedoableOperation: boolean;
  readonly undoLabel?: string;
  readonly redoLabel?: string;
  readonly hasSelectedAssets: boolean;
  readonly hasPasteTarget: boolean;
  readonly hasBrowseAssets: boolean;
};

export type MainMenuBuilderInput = {
  readonly locale: AppLocale;
  readonly platform: CommandPlatform;
  readonly state: MainMenuState;
  readonly actions: MainMenuActions;
};

function shortcut(platform: CommandPlatform, mac: string, windows: string): string {
  return platform === "mac" ? mac : windows;
}

function label(locale: AppLocale, key: string, params?: TranslateParams): string {
  return translateForLocale(locale, key, params);
}

/**
 * Canonical Windows in-app menu information architecture.
 *
 * Keep this pure: the renderer owns state and effects, while this module only
 * splits the menu-bar responsibilities into stable File/Edit/Library/Window/
 * Settings/About sections. Settings is intentionally a direct action; the
 * other sections expose their items only when the hover menu opens them. This
 * keeps the Windows menu and future command palette on the same inventory
 * without growing App.tsx further.
 */
export function buildMainMenuSections({
  locale,
  platform,
  state,
  actions,
}: MainMenuBuilderInput): MainMenuSection[] {
  const libraryDisabled = !state.libraryOpen || state.busy;
  const appDisabled = state.busy;
  const selectionDisabled = !state.hasSelectedAssets || state.busy;
  const selectDisabled = !state.hasBrowseAssets || state.busy;

  return [
    {
      id: "file",
      label: label(locale, "shell.mainMenuFile"),
      icon: "file",
      items: [
        {
          id: "file.import-files",
          label: label(locale, "toolbar.importFiles"),
          disabled: libraryDisabled,
          onSelect: actions.importFiles,
        },
        {
          id: "file.import-folder",
          label: label(locale, "toolbar.importFolder"),
          disabled: libraryDisabled,
          onSelect: actions.importFolder,
        },
        {
          id: "file.import-linked-folder",
          label: label(locale, "toolbar.importLinkedFolder"),
          disabled: libraryDisabled,
          onSelect: actions.importLinkedFolder,
        },
      ],
    },
    {
      id: "edit",
      label: label(locale, "shell.mainMenuEdit"),
      icon: "edit",
      items: [
        {
          id: "edit.undo",
          label: state.undoLabel ?? label(locale, "shell.mainMenuUndo"),
          shortcut: shortcut(platform, "⌘Z", "Ctrl+Z"),
          disabled: !state.hasUndoableOperation || state.busy,
          onSelect: actions.undo,
        },
        {
          id: "edit.redo",
          label: state.redoLabel ?? label(locale, "shell.mainMenuRedo"),
          shortcut: shortcut(platform, "⌘⇧Z", "Ctrl+Shift+Z"),
          disabled: !state.hasRedoableOperation || state.busy,
          onSelect: actions.redo,
        },
        {
          id: "edit.copy-selection",
          label: label(locale, "shell.mainMenuCopySelection"),
          shortcut: shortcut(platform, "⌘C", "Ctrl+C"),
          disabled: selectionDisabled,
          onSelect: actions.copySelection,
        },
        {
          id: "edit.paste",
          label: label(locale, "shell.mainMenuPaste"),
          shortcut: shortcut(platform, "⌘V", "Ctrl+V"),
          disabled: !state.hasPasteTarget,
          onSelect: actions.paste,
        },
        {
          id: "edit.select-all",
          label: label(locale, "shell.mainMenuSelectAll"),
          shortcut: shortcut(platform, "⌘A", "Ctrl+A"),
          disabled: selectDisabled,
          onSelect: actions.selectAll,
        },
        {
          id: "edit.invert-selection",
          label: label(locale, "shell.mainMenuInvertSelection"),
          shortcut: shortcut(platform, "⌘I", "Ctrl+I"),
          disabled: selectDisabled,
          onSelect: actions.invertSelection,
        },
        {
          id: "edit.clear-selection",
          label: label(locale, "shell.mainMenuClearSelection"),
          disabled: !state.hasSelectedAssets,
          onSelect: actions.clearSelection,
        },
      ],
    },
    {
      id: "library",
      label: label(locale, "shell.mainMenuLibrary"),
      icon: "collection",
      items: [
        {
          id: "library.create",
          label: label(locale, "shell.createLibraryEllipsis"),
          disabled: appDisabled,
          onSelect: actions.createLibrary,
        },
        {
          id: "library.open",
          label: label(locale, "shell.openLibraryEllipsis"),
          disabled: appDisabled,
          onSelect: actions.openLibrary,
        },
        {
          id: "library.close",
          label: label(locale, "shell.closeLibrary"),
          disabled: libraryDisabled,
          onSelect: actions.closeLibrary,
        },
        {
          id: "library.import",
          label: label(locale, "toolbar.importLibrary"),
          disabled: libraryDisabled,
          onSelect: actions.importLibrary,
        },
        {
          id: "library.export",
          label: label(locale, "toolbar.exportLibrary"),
          disabled: libraryDisabled,
          onSelect: actions.exportLibrary,
        },
        {
          id: "library.remove",
          label: label(locale, "shell.removeLibrary"),
          disabled: libraryDisabled,
          onSelect: actions.removeLibrary,
        },
        {
          id: "library.delete-from-disk",
          label: label(locale, "shell.deleteLibraryFromDisk"),
          disabled: libraryDisabled,
          danger: true,
          onSelect: actions.deleteLibraryFromDisk,
        },
        {
          id: "library.settings",
          label: label(locale, "settings.librarySettings"),
          disabled: libraryDisabled,
          onSelect: actions.openLibrarySettings ?? (() => undefined),
        },
      ],
    },
    {
      id: "window",
      label: label(locale, "shell.mainMenuWindow"),
      icon: "fullscreen",
      items: [
        {
          id: "window.background-jobs",
          label: label(locale, "toolbar.backgroundJobs"),
          disabled: !state.libraryOpen,
          onSelect: actions.openBackgroundJobs,
        },
        {
          id: "window.diagnostics",
          label: label(locale, "settings.viewDiagnostics"),
          onSelect: actions.openAppLog,
        },
      ],
    },
    {
      id: "about",
      label: label(locale, "shell.mainMenuAbout"),
      icon: "info",
      items: [
        {
          id: "about.serpent",
          label: label(locale, "shell.mainMenuAboutSerpent"),
          onSelect: actions.openAbout,
        },
        {
          id: "about.github",
          label: label(locale, "shell.mainMenuVisitGitHub"),
          onSelect: actions.openGitHub,
        },
        {
          id: "about.open-source",
          label: label(locale, "shell.mainMenuOpenSource"),
          onSelect: actions.openOpenSourceLicenses,
        },
        {
          id: "about.diagnostics",
          label: label(locale, "settings.viewDiagnostics"),
          onSelect: actions.openAppLog,
        },
        {
          // Serpent-0fe8b4: 菜单里不再显示版本号（无用的 disabled 项），
          // 改为「检查更新」——点击打开关于 Serpent 页面，该页面负责
          // 自动更新流程（检查/下载/安装/进度）。
          id: "about.check-update",
          label: label(locale, "shell.mainMenuCheckUpdate"),
          onSelect: actions.openAbout,
        },
      ],
    },
    {
      id: "settings",
      label: label(locale, "shell.mainMenuSettings"),
      icon: "settings",
      disabled: appDisabled,
      onSelect: actions.openSettings,
    },
  ];
}
