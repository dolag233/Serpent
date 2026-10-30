// ---------------------------------------------------------------------------
// Custom keyboard shortcut catalog (R2)
//
// One declaration per user-configurable action. The same catalog feeds the
// Renderer matchers, context-menu labels and the shortcut settings page.
// It is pure data: no React, Electron or i18n runtime imports.
// ---------------------------------------------------------------------------

export type ShortcutPlatform = "mac" | "windows";

/** Where an action can fire. Browse, sidebar and viewer media scopes are exclusive. */
export type ShortcutScope =
  | "app"
  | "browse"
  | "sidebar.folder"
  | "sidebar.collection"
  | "viewer.base"
  | "viewer.image"
  | "viewer.video"
  | "viewer.audio";

export type ShortcutSurface =
  | "renderer"
  | "context-menu"
  | "app-menu"
  | "native-menu"
  | "hidden-accelerator"
  | "before-input";

export type ShortcutCategory = "asset" | "folder" | "collection" | "app" | "viewer";

export type ShortcutChord = {
  /** Logical key used for display and named-key matching. */
  readonly key: string;
  /** Physical key (KeyboardEvent.code); preferred for letters/digits/F keys. */
  readonly code?: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
};

export type ShortcutActionDefinition = {
  readonly id: string;
  readonly labelKey: string;
  readonly category: ShortcutCategory;
  readonly scopes: readonly ShortcutScope[];
  /** false = occupied by a fixed system or structural shortcut. */
  readonly customizable: boolean;
  readonly defaults: {
    readonly mac: readonly ShortcutChord[];
    readonly windows: readonly ShortcutChord[];
  };
  readonly surfaces: readonly ShortcutSurface[];
};

const chord = (
  key: string,
  modifiers: Omit<ShortcutChord, "key" | "code"> & { code?: string } = {},
): ShortcutChord => ({
  key,
  ...(modifiers.code === undefined ? {} : { code: modifiers.code }),
  ...(modifiers.metaKey === undefined ? {} : { metaKey: modifiers.metaKey }),
  ...(modifiers.ctrlKey === undefined ? {} : { ctrlKey: modifiers.ctrlKey }),
  ...(modifiers.altKey === undefined ? {} : { altKey: modifiers.altKey }),
  ...(modifiers.shiftKey === undefined ? {} : { shiftKey: modifiers.shiftKey }),
});

const command = (key: string, platform: ShortcutPlatform): ShortcutChord =>
  platform === "mac"
    ? chord(key, { code: `Key${key.toUpperCase()}`, metaKey: true })
    : chord(key, { code: `Key${key.toUpperCase()}`, ctrlKey: true });

const shiftCommand = (key: string, platform: ShortcutPlatform): ShortcutChord =>
  platform === "mac"
    ? chord(key, { code: `Key${key.toUpperCase()}`, metaKey: true, shiftKey: true })
    : chord(key, { code: `Key${key.toUpperCase()}`, ctrlKey: true, shiftKey: true });

const functionKey = (key: string): ShortcutChord =>
  chord(key, { code: key });

const viewerLetter = (key: string): ShortcutChord =>
  chord(key, { code: `Key${key.toUpperCase()}` });

const viewerNamedKey = (key: string): ShortcutChord => chord(key, { code: key });

const [assetOpenExternalMac, assetOpenExternalWin] = [
  command("o", "mac"),
  command("o", "windows"),
];
const [assetRevealMac, assetRevealWin] = [
  shiftCommand("s", "mac"),
  shiftCommand("s", "windows"),
];
const [assetShowInLibraryMac, assetShowInLibraryWin] = [
  command("b", "mac"),
  command("b", "windows"),
];
const [assetCopyPathMac, assetCopyPathWin] = [
  chord("c", { code: "KeyC", metaKey: true, altKey: true }),
  chord("c", { code: "KeyC", ctrlKey: true, shiftKey: true }),
];
const [folderCreateMac, folderCreateWin] = [
  shiftCommand("n", "mac"),
  shiftCommand("n", "windows"),
];
const [focusSearchMac, focusSearchWin] = [
  command("f", "mac"),
  command("f", "windows"),
];
const refresh = functionKey("F5");
const rename = functionKey("F2");
const moveToTrashMac = chord("Backspace", {
  code: "Backspace",
  metaKey: true,
});
const moveToTrashWin = chord("Delete", { code: "Delete" });
const deleteFromDiskMac = chord("Delete", {
  code: "Delete",
  metaKey: true,
  altKey: true,
});
const deleteFromDiskWin = chord("Delete", {
  code: "Delete",
  shiftKey: true,
});

const sharedDefaults = {
  mac: [rename],
  windows: [rename],
} as const;

const sharedTrashDefaults = {
  mac: [moveToTrashMac],
  windows: [moveToTrashWin],
} as const;

const sharedDiskDeleteDefaults = {
  mac: [deleteFromDiskMac],
  windows: [deleteFromDiskWin],
} as const;

const rendererAndContext: readonly ShortcutSurface[] = [
  "renderer",
  "context-menu",
];

const rendererContextAndHidden: readonly ShortcutSurface[] = [
  "renderer",
  "context-menu",
  "hidden-accelerator",
];

const rendererMainAndHidden: readonly ShortcutSurface[] = [
  "renderer",
  "app-menu",
  "native-menu",
  "hidden-accelerator",
  "before-input",
];

const rendererViewerMain: readonly ShortcutSurface[] = [
  "renderer",
  "hidden-accelerator",
  "before-input",
];

export const SHORTCUT_ACTIONS: readonly ShortcutActionDefinition[] = Object.freeze([
  {
    id: "viewer.image.wheel-zoom",
    labelKey: "shortcuts.action.viewer.wheelZoom",
    category: "viewer",
    scopes: ["viewer.image"],
    defaults: { mac: [chord("Wheel")], windows: [chord("Wheel")] },
    customizable: true,
    surfaces: ["renderer"],
  },
  { id: "asset.select-previous", labelKey: "shortcuts.action.asset.selectPrevious", category: "asset", scopes: ["browse"], defaults: { mac: [viewerNamedKey("ArrowLeft")], windows: [viewerNamedKey("ArrowLeft")] }, customizable: true, surfaces: ["renderer"] },
  { id: "asset.select-next", labelKey: "shortcuts.action.asset.selectNext", category: "asset", scopes: ["browse"], defaults: { mac: [viewerNamedKey("ArrowRight")], windows: [viewerNamedKey("ArrowRight")] }, customizable: true, surfaces: ["renderer"] },
  {
    id: "asset.open-external",
    labelKey: "shortcuts.action.asset.openExternal",
    category: "asset",
    scopes: ["browse"],
    defaults: {
      mac: [assetOpenExternalMac],
      windows: [assetOpenExternalWin],
    },
    customizable: true,
    surfaces: rendererAndContext,
  },
  {
    id: "asset.reveal-in-folder",
    labelKey: "shortcuts.action.asset.revealInFolder",
    category: "asset",
    scopes: ["browse"],
    defaults: {
      mac: [assetRevealMac],
      windows: [assetRevealWin],
    },
    customizable: true,
    surfaces: rendererAndContext,
  },
  {
    id: "asset.show-in-library-folder",
    labelKey: "shortcuts.action.asset.showInLibraryFolder",
    category: "asset",
    scopes: ["browse"],
    defaults: {
      mac: [assetShowInLibraryMac],
      windows: [assetShowInLibraryWin],
    },
    customizable: true,
    surfaces: rendererAndContext,
  },
  {
    id: "asset.copy-file-path",
    labelKey: "shortcuts.action.asset.copyFilePath",
    category: "asset",
    scopes: ["browse"],
    defaults: {
      mac: [assetCopyPathMac],
      windows: [assetCopyPathWin],
    },
    customizable: true,
    surfaces: ["renderer", "context-menu", "hidden-accelerator", "before-input"],
  },
  {
    id: "asset.rename",
    labelKey: "shortcuts.action.asset.rename",
    category: "asset",
    scopes: ["browse"],
    defaults: sharedDefaults,
    customizable: true,
    surfaces: rendererContextAndHidden,
  },
  {
    id: "asset.move-to-trash",
    labelKey: "shortcuts.action.asset.moveToTrash",
    category: "asset",
    scopes: ["browse"],
    defaults: sharedTrashDefaults,
    customizable: true,
    surfaces: rendererContextAndHidden,
  },
  {
    id: "asset.delete-from-disk",
    labelKey: "shortcuts.action.asset.deleteFromDisk",
    category: "asset",
    scopes: ["browse"],
    defaults: sharedDiskDeleteDefaults,
    customizable: true,
    surfaces: rendererContextAndHidden,
  },
  {
    id: "folder.copy-path",
    labelKey: "shortcuts.action.folder.copyPath",
    category: "folder",
    scopes: ["sidebar.folder"],
    defaults: {
      mac: [assetCopyPathMac],
      windows: [assetCopyPathWin],
    },
    customizable: true,
    surfaces: ["renderer", "context-menu", "hidden-accelerator", "before-input"],
  },
  {
    id: "folder.open-in-file-manager",
    labelKey: "shortcuts.action.folder.openInFileManager",
    category: "folder",
    scopes: ["sidebar.folder"],
    defaults: {
      mac: [assetRevealMac],
      windows: [assetRevealWin],
    },
    customizable: true,
    surfaces: rendererAndContext,
  },
  {
    id: "folder.create-subfolder",
    labelKey: "shortcuts.action.folder.createSubfolder",
    category: "folder",
    scopes: ["sidebar.folder"],
    defaults: {
      mac: [folderCreateMac],
      windows: [folderCreateWin],
    },
    customizable: true,
    surfaces: rendererAndContext,
  },
  {
    id: "folder.rename",
    labelKey: "shortcuts.action.folder.rename",
    category: "folder",
    scopes: ["sidebar.folder"],
    defaults: sharedDefaults,
    customizable: true,
    surfaces: rendererContextAndHidden,
  },
  {
    id: "folder.move-to-trash",
    labelKey: "shortcuts.action.folder.moveToTrash",
    category: "folder",
    scopes: ["sidebar.folder"],
    defaults: sharedTrashDefaults,
    customizable: true,
    surfaces: rendererContextAndHidden,
  },
  {
    id: "folder.delete-from-disk",
    labelKey: "shortcuts.action.folder.deleteFromDisk",
    category: "folder",
    scopes: ["sidebar.folder"],
    defaults: sharedDiskDeleteDefaults,
    customizable: true,
    surfaces: rendererContextAndHidden,
  },
  {
    id: "collection.create-subcollection",
    labelKey: "shortcuts.action.collection.createSubcollection",
    category: "collection",
    scopes: ["sidebar.collection"],
    defaults: {
      mac: [folderCreateMac],
      windows: [folderCreateWin],
    },
    customizable: true,
    surfaces: rendererAndContext,
  },
  {
    id: "collection.rename",
    labelKey: "shortcuts.action.collection.rename",
    category: "collection",
    scopes: ["sidebar.collection"],
    defaults: sharedDefaults,
    customizable: true,
    surfaces: rendererContextAndHidden,
  },
  {
    id: "collection.delete",
    labelKey: "shortcuts.action.collection.delete",
    category: "collection",
    scopes: ["sidebar.collection"],
    defaults: sharedTrashDefaults,
    customizable: true,
    surfaces: rendererContextAndHidden,
  },
  {
    id: "workspace.focus-search",
    labelKey: "shortcuts.action.app.focusSearch",
    category: "app",
    scopes: ["app"],
    defaults: {
      mac: [focusSearchMac],
      windows: [focusSearchWin],
    },
    customizable: true,
    surfaces: rendererAndContext,
  },
  {
    id: "canvas.refresh",
    labelKey: "shortcuts.action.app.refresh",
    category: "app",
    scopes: ["browse"],
    defaults: {
      mac: [refresh],
      windows: [refresh],
    },
    customizable: true,
    surfaces: rendererAndContext,
  },
  // Occupied shortcuts kept out of the v1-lite editor. They still participate
  // in conflict detection so a custom chord cannot silently shadow them.
  {
    id: "asset.view",
    labelKey: "command.asset.view",
    category: "asset",
    scopes: ["browse"],
    defaults: {
      mac: [chord("Enter", { code: "Enter" }), chord("Space", { code: "Space" })],
      windows: [chord("Enter", { code: "Enter" }), chord("Space", { code: "Space" })],
    },
    customizable: false,
    surfaces: rendererAndContext,
  },
  {
    id: "asset.copy",
    labelKey: "command.asset.copy",
    category: "asset",
    scopes: ["browse"],
    defaults: { mac: [command("c", "mac")], windows: [command("c", "windows")] },
    customizable: true,
    surfaces: ["renderer", "context-menu", "app-menu", "native-menu", "hidden-accelerator", "before-input"],
  },
  {
    id: "asset.paste",
    labelKey: "command.asset.paste",
    category: "asset",
    scopes: ["browse"],
    defaults: { mac: [command("v", "mac")], windows: [command("v", "windows")] },
    customizable: true,
    surfaces: ["renderer", "context-menu", "app-menu", "native-menu", "hidden-accelerator", "before-input"],
  },
  {
    id: "folder.copy",
    labelKey: "command.folder.copy",
    category: "folder",
    scopes: ["sidebar.folder"],
    defaults: { mac: [command("c", "mac")], windows: [command("c", "windows")] },
    customizable: false,
    surfaces: rendererAndContext,
  },
  {
    id: "folder.paste",
    labelKey: "command.folder.paste",
    category: "folder",
    scopes: ["sidebar.folder"],
    defaults: { mac: [command("v", "mac")], windows: [command("v", "windows")] },
    customizable: false,
    surfaces: rendererAndContext,
  },
  {
    id: "selection.select-all",
    labelKey: "shell.mainMenuSelectAll",
    category: "asset",
    scopes: ["browse"],
    defaults: { mac: [command("a", "mac")], windows: [command("a", "windows")] },
    customizable: true,
    surfaces: rendererMainAndHidden,
  },
  {
    id: "selection.invert",
    labelKey: "shell.mainMenuInvertSelection",
    category: "asset",
    scopes: ["browse"],
    defaults: { mac: [command("i", "mac")], windows: [command("i", "windows")] },
    customizable: true,
    surfaces: rendererMainAndHidden,
  },
  {
    id: "edit.undo",
    labelKey: "shell.mainMenuUndo",
    category: "app",
    scopes: ["app"],
    defaults: { mac: [command("z", "mac")], windows: [command("z", "windows")] },
    customizable: true,
    surfaces: rendererMainAndHidden,
  },
  {
    id: "edit.redo",
    labelKey: "shell.mainMenuRedo",
    category: "app",
    scopes: ["app"],
    defaults: {
      mac: [shiftCommand("z", "mac")],
      windows: [shiftCommand("z", "windows")],
    },
    customizable: true,
    surfaces: rendererMainAndHidden,
  },
  {
    id: "canvas.zoom-in",
    labelKey: "shortcuts.action.fixed.zoomIn",
    category: "app",
    scopes: ["app"],
    defaults: {
      mac: [
        chord("=", { code: "Equal", metaKey: true }),
        chord("+", { code: "Equal", metaKey: true, shiftKey: true }),
        chord("Add", { code: "NumpadAdd", metaKey: true }),
      ],
      windows: [
        chord("=", { code: "Equal", ctrlKey: true }),
        chord("+", { code: "Equal", ctrlKey: true, shiftKey: true }),
        chord("Add", { code: "NumpadAdd", ctrlKey: true }),
      ],
    },
    customizable: true,
    surfaces: rendererMainAndHidden,
  },
  {
    id: "canvas.zoom-out",
    labelKey: "shortcuts.action.fixed.zoomOut",
    category: "app",
    scopes: ["app"],
    defaults: {
      mac: [
        chord("-", { code: "Minus", metaKey: true }),
        chord("_", { code: "Minus", metaKey: true, shiftKey: true }),
        chord("Subtract", { code: "NumpadSubtract", metaKey: true }),
      ],
      windows: [
        chord("-", { code: "Minus", ctrlKey: true }),
        chord("_", { code: "Minus", ctrlKey: true, shiftKey: true }),
        chord("Subtract", { code: "NumpadSubtract", ctrlKey: true }),
      ],
    },
    customizable: true,
    surfaces: rendererMainAndHidden,
  },
  {
    id: "viewer.close",
    labelKey: "shortcuts.action.fixed.viewerClose",
    category: "viewer",
    scopes: ["viewer.base"],
    defaults: { mac: [viewerNamedKey("Escape")], windows: [viewerNamedKey("Escape")] },
    customizable: false,
    surfaces: ["renderer"],
  },
  {
    id: "viewer.previous",
    labelKey: "shortcuts.action.fixed.viewerPrevious",
    category: "viewer",
    scopes: ["viewer.base"],
    defaults: { mac: [viewerNamedKey("ArrowLeft")], windows: [viewerNamedKey("ArrowLeft")] },
    customizable: true,
    surfaces: ["renderer"],
  },
  {
    id: "viewer.next",
    labelKey: "shortcuts.action.fixed.viewerNext",
    category: "viewer",
    scopes: ["viewer.base"],
    defaults: { mac: [viewerNamedKey("ArrowRight")], windows: [viewerNamedKey("ArrowRight")] },
    customizable: true,
    surfaces: ["renderer"],
  },
  {
    id: "viewer.media.play-pause",
    labelKey: "shortcuts.action.viewer.playPause",
    category: "viewer",
    scopes: ["viewer.video", "viewer.audio"],
    defaults: { mac: [viewerNamedKey("Space")], windows: [viewerNamedKey("Space")] },
    customizable: true,
    surfaces: rendererViewerMain,
  },
  {
    id: "viewer.video.frame-prev",
    labelKey: "shortcuts.action.viewer.framePrevious",
    category: "viewer",
    scopes: ["viewer.video"],
    defaults: { mac: [viewerLetter("d")], windows: [viewerLetter("d")] },
    customizable: true,
    surfaces: rendererViewerMain,
  },
  {
    id: "viewer.video.frame-next",
    labelKey: "shortcuts.action.viewer.frameNext",
    category: "viewer",
    scopes: ["viewer.video"],
    defaults: { mac: [viewerLetter("f")], windows: [viewerLetter("f")] },
    customizable: true,
    surfaces: rendererViewerMain,
  },
  {
    id: "viewer.video.rate-slower",
    labelKey: "shortcuts.action.viewer.rateSlower",
    category: "viewer",
    scopes: ["viewer.video"],
    defaults: { mac: [viewerLetter("x")], windows: [viewerLetter("x")] },
    customizable: true,
    surfaces: rendererViewerMain,
  },
  {
    id: "viewer.video.rate-faster",
    labelKey: "shortcuts.action.viewer.rateFaster",
    category: "viewer",
    scopes: ["viewer.video"],
    defaults: { mac: [viewerLetter("c")], windows: [viewerLetter("c")] },
    customizable: true,
    surfaces: rendererViewerMain,
  },
  {
    id: "viewer.video.seek-back",
    labelKey: "shortcuts.action.viewer.seekBack",
    category: "viewer",
    scopes: ["viewer.video"],
    defaults: { mac: [chord("ArrowLeft", { code: "ArrowLeft", ctrlKey: true })], windows: [chord("ArrowLeft", { code: "ArrowLeft", ctrlKey: true })] },
    customizable: true,
    surfaces: ["renderer"],
  },
  {
    id: "viewer.video.seek-forward",
    labelKey: "shortcuts.action.viewer.seekForward",
    category: "viewer",
    scopes: ["viewer.video"],
    defaults: { mac: [chord("ArrowRight", { code: "ArrowRight", ctrlKey: true })], windows: [chord("ArrowRight", { code: "ArrowRight", ctrlKey: true })] },
    customizable: true,
    surfaces: ["renderer"],
  },
  {
    id: "viewer.volume-up",
    labelKey: "shortcuts.action.viewer.volumeUp",
    category: "viewer",
    scopes: ["viewer.base"],
    defaults: { mac: [viewerNamedKey("ArrowUp")], windows: [viewerNamedKey("ArrowUp")] },
    customizable: true,
    surfaces: ["renderer"],
  },
  {
    id: "viewer.volume-down",
    labelKey: "shortcuts.action.viewer.volumeDown",
    category: "viewer",
    scopes: ["viewer.base"],
    defaults: { mac: [viewerNamedKey("ArrowDown")], windows: [viewerNamedKey("ArrowDown")] },
    customizable: true,
    surfaces: ["renderer"],
  },
  {
    id: "viewer.fit",
    labelKey: "shortcuts.action.viewer.fit",
    category: "viewer",
    scopes: ["viewer.image", "viewer.video"],
    defaults: { mac: [chord(".", { code: "NumpadDecimal" })], windows: [chord(".", { code: "NumpadDecimal" })] },
    customizable: true,
    surfaces: ["renderer"],
  },
  {
    id: "canvas.zoom-reset",
    labelKey: "shortcuts.action.fixed.zoomReset",
    category: "app",
    scopes: ["app"],
    defaults: {
      mac: [chord("0", { code: "Digit0", metaKey: true })],
      windows: [chord("0", { code: "Digit0", ctrlKey: true })],
    },
    customizable: true,
    surfaces: rendererMainAndHidden,
  },
  {
    id: "window.toggle-fullscreen",
    labelKey: "shell.mainMenuToggleFullscreen",
    category: "app",
    scopes: ["app"],
    defaults: {
      mac: [chord("f", { code: "KeyF", metaKey: true, ctrlKey: true })],
      windows: [chord("F11", { code: "F11" })],
    },
    customizable: true,
    surfaces: rendererMainAndHidden,
  },
]);

const ACTION_BY_ID = new Map(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

export function findShortcutAction(
  actionId: string,
): ShortcutActionDefinition | undefined {
  return ACTION_BY_ID.get(actionId);
}

export function shortcutActionIds(): readonly string[] {
  return SHORTCUT_ACTIONS.map((action) => action.id);
}

export function shortcutScopesOverlap(
  left: readonly ShortcutScope[],
  right: readonly ShortcutScope[],
): boolean {
  if (left.includes("app") || right.includes("app")) return true;
  return left.some((leftScope) => right.some((rightScope) => {
    if (leftScope === rightScope) return true;
    return (leftScope === "viewer.base" && rightScope.startsWith("viewer."))
      || (rightScope === "viewer.base" && leftScope.startsWith("viewer."));
  }));
}

export const SHORTCUT_CATEGORY_ORDER: readonly ShortcutCategory[] = [
  "asset",
  "folder",
  "collection",
  "app",
  "viewer",
];
