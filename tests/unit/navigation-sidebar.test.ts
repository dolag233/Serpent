// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NavigationSidebar,
  type NavigationSidebarProps,
} from "../../src/renderer/NavigationSidebar";
import { MANAGED_FOLDERS_DRAG_TYPE } from "../../src/renderer/folder-drag-drop";
import { LocaleProvider } from "../../src/renderer/i18n";

function createDragTransfer(types: string[]): DataTransfer {
  return {
    types,
    dropEffect: "none",
    effectAllowed: "all",
    files: [],
    getData: () => "",
    setData: () => undefined,
  } as unknown as DataTransfer;
}

function createFolderDragTransfer(folderIds: string[]): DataTransfer {
  return {
    types: [MANAGED_FOLDERS_DRAG_TYPE],
    dropEffect: "none",
    effectAllowed: "all",
    files: [],
    getData: (type: string) =>
      type === MANAGED_FOLDERS_DRAG_TYPE ? JSON.stringify(folderIds) : "",
    setData: () => undefined,
  } as unknown as DataTransfer;
}

function dispatchDragEvent(
  element: Element,
  type: "dragenter" | "dragover" | "dragstart",
  dataTransfer: DataTransfer,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  element.dispatchEvent(event);
  return event;
}

function dispatchDropEvent(
  element: Element,
  dataTransfer: DataTransfer,
): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  element.dispatchEvent(event);
  return event;
}

function createNavigationProps(
  overrides: Partial<NavigationSidebarProps> = {},
): NavigationSidebarProps {
  const noop = vi.fn();
  return {
    library: {
      libraryId: "library-1",
      displayName: "Demo",
      displayPath: "/temporary/demo",
    },
    assetScope: "root",
    showTrash: false,
    showTagManagement: false,
    activeTagId: null,
    activeCollectionId: null,
    activeSmartCollectionId: null,
    showIgnoredItems: false,
    onToggleShowIgnoredItems: noop,
    allAssetCount: 7,
    rootAssetCount: 2,
    trashedAssetCount: 0,
    folders: [],
    collections: [],
    collectionTree: new Map(),
    smartCollections: [],
    linkedFolders: [],
    showCollectionInput: false,
    collectionInputValue: "",
    newCollectionParentId: null,
    inlineCollectionRename: null,
    draggedCollectionId: null,
    onSetDraggedCollectionId: noop,
    onChooseAllAssets: noop,
    onEnterTrash: noop,
    onEnterTagManagement: noop,
    onChooseFolder: noop,
    onChooseCollection: noop,
    onChooseSmartCollection: noop,
    onExternalDragOver: noop,
    onExternalDrop: noop,
    onAssetsDroppedOnFolder: noop,
    onFoldersDroppedOnFolder: noop,
    selectedFolderIds: [],
    onAssetsDroppedOnTrash: noop,
    onFoldersDroppedOnTrash: noop,
    onAssetsDroppedOnCollection: noop,
    onImportFolderAsLinked: noop,
    onRelinkFolder: noop,
    onConvertLinkedDialog: noop,
    onAddCollection: noop,
    onSetShowCollectionInput: noop,
    onSetCollectionInputValue: noop,
    onSetNewCollectionParentId: noop,
    onCollectionInputCommit: noop,
    onInlineCollectionRenameChange: noop,
    onInlineCollectionRenameCommit: noop,
    onInlineCollectionRenameCancel: noop,
    onAddFolder: noop,
    onAddSmartCollection: noop,
    inlineFolderEdit: null,
    onInlineFolderEditChange: noop,
    onInlineFolderEditCommit: noop,
    onInlineFolderEditCancel: noop,
    inlineSmartCollectionEdit: null,
    onInlineSmartCollectionEditChange: noop,
    onInlineSmartCollectionEditCommit: noop,
    onInlineSmartCollectionEditCancel: noop,
    onOpenContextMenu: noop,
    onReorderCollection: noop,
    onImportDroppedFiles: noop,
    onCopyManagedToLinked: noop,
    ...overrides,
  };
}

describe("NavigationSidebar virtual library root", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("renders one selectable root row with its direct-asset count", async () => {
    const onChooseFolder = vi.fn();
    const props = createNavigationProps({ onChooseFolder });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(NavigationSidebar, props),
        ),
      );
    });

    const rows = [...container.querySelectorAll<HTMLButtonElement>(".nav-row")];
    const rootRows = rows.filter((row) => (row.textContent ?? "").includes("Library root"));
    expect(rootRows).toHaveLength(1);
    expect(rootRows[0]?.classList.contains("is-active")).toBe(true);
    expect(rootRows[0]?.textContent).toContain("2");

    await act(async () => rootRows[0]?.click());
    expect(onChooseFolder).toHaveBeenCalledWith("root");
  });

  it("keeps nested folder and collection rows aligned with long labels and counts", async () => {
    const onChooseFolder = vi.fn();
    const onChooseCollection = vi.fn();
    const parentFolderName = "A very long parent folder name that must stay on one row";
    const childFolderName = "A deeply nested child folder with a long display name";
    const parentCollectionName = "A long parent collection name with many characters";
    const childCollectionName = "A long nested collection name with many characters";
    const parentFolderId = "folder-parent";
    const childFolderId = "folder-child";
    const parentCollectionId = "collection-parent";
    const childCollectionId = "collection-child";
    const parentCollection = {
      collectionId: parentCollectionId,
      parentId: null,
      name: parentCollectionName,
      description: null,
      coverAssetId: null,
      position: 0,
      assetCount: 4,
      childCollectionCount: 1,
    };
    const childCollection = {
      collectionId: childCollectionId,
      parentId: parentCollectionId,
      name: childCollectionName,
      description: null,
      coverAssetId: null,
      position: 0,
      assetCount: 2,
      childCollectionCount: 0,
    };
    const props = createNavigationProps({
      activeCollectionId: childCollectionId,
      folders: [
        {
          folderId: parentFolderId,
          parentFolderId: null,
          name: parentFolderName,
          relativePath: "parent",
          directAssetCount: 3,
          childFolderCount: 1,
        },
        {
          folderId: childFolderId,
          parentFolderId: parentFolderId,
          name: childFolderName,
          relativePath: "parent/child",
          directAssetCount: 5,
          childFolderCount: 0,
        },
      ],
      collections: [parentCollection, childCollection],
      collectionTree: new Map([
        [null, [parentCollection]],
        [parentCollectionId, [childCollection]],
      ]),
      onChooseFolder,
      onChooseCollection,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(NavigationSidebar, props),
        ),
      );
    });

    const folderRows = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[data-nav-folder-kind="managed"]',
      ),
    ];
    expect(folderRows).toHaveLength(2);
    const parentFolderRow = folderRows.find(
      (row) => row.dataset.navFolderId === parentFolderId,
    );
    const childFolderRow = folderRows.find(
      (row) => row.dataset.navFolderId === childFolderId,
    );
    expect(parentFolderRow?.querySelector(".nav-row-label")?.textContent).toBe(
      parentFolderName,
    );
    expect(childFolderRow?.querySelector(".nav-row-label")?.textContent).toBe(
      childFolderName,
    );
    expect(parentFolderRow?.title).toBe(parentFolderName);
    expect(childFolderRow?.title).toBe(childFolderName);
    expect(parentFolderRow?.style.paddingLeft).toBe("7px");
    expect(childFolderRow?.style.paddingLeft).toBe("7px");
    expect(parentFolderRow?.closest<HTMLElement>(".nav-tree-row")?.style.paddingLeft).toBe(
      "14px",
    );
    expect(childFolderRow?.closest<HTMLElement>(".nav-tree-row")?.style.paddingLeft).toBe(
      "28px",
    );
    expect(
      parentFolderRow?.closest(".nav-tree-row")?.querySelector(".nav-disclosure"),
    ).not.toBeNull();
    expect(
      childFolderRow?.closest(".nav-tree-row")?.querySelector(".nav-disclosure-spacer"),
    ).not.toBeNull();
    expect(parentFolderRow?.querySelector(".nav-count")?.textContent).toBe("3");
    expect(childFolderRow?.querySelector(".nav-count")?.textContent).toBe("5");

    const collectionRows = [
      ...container.querySelectorAll<HTMLButtonElement>(
        "button[data-nav-collection-id]",
      ),
    ];
    expect(collectionRows).toHaveLength(2);
    const parentCollectionRow = collectionRows.find(
      (row) => row.dataset.navCollectionId === parentCollectionId,
    );
    const childCollectionRow = collectionRows.find(
      (row) => row.dataset.navCollectionId === childCollectionId,
    );
    expect(parentCollectionRow?.title).toBe(parentCollectionName);
    expect(childCollectionRow?.title).toBe(childCollectionName);
    expect(parentCollectionRow?.style.paddingLeft).toBe("7px");
    expect(childCollectionRow?.style.paddingLeft).toBe("7px");
    expect(
      parentCollectionRow?.closest<HTMLElement>(".nav-tree-row")?.style.paddingLeft,
    ).toBe("0px");
    expect(
      childCollectionRow?.closest<HTMLElement>(".nav-tree-row")?.style.paddingLeft,
    ).toBe("14px");
    expect(parentCollectionRow?.classList.contains("is-active")).toBe(false);
    expect(childCollectionRow?.classList.contains("is-active")).toBe(true);
    expect(parentCollectionRow?.querySelectorAll(".nav-count")).toHaveLength(1);
    expect(parentCollectionRow?.textContent).toContain("4");
    expect(parentCollectionRow?.textContent).not.toContain("1");
    expect(childCollectionRow?.querySelector(".nav-count")?.textContent).toBe("2");

    await act(async () => childCollectionRow?.click());
    await act(async () => childFolderRow?.click());
    expect(onChooseCollection).toHaveBeenCalledWith(childCollectionId);
    expect(onChooseFolder).toHaveBeenCalledWith(childFolderId);
  });

  it("reserves one trailing grid column for the asset count", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "src/renderer/styles.css"),
      "utf8",
    );

    expect(styles).toMatch(
      /\.nav-row\s*\{[\s\S]*?grid-template-columns:\s*17px minmax\(0, 1fr\) auto;/,
    );
    expect(styles).not.toContain(".nav-child-count");
  });

  it("collapses and expands collection children via the disclosure button (Serpent-c42eb1)", async () => {
    const parentId = "collection-parent";
    const childId = "collection-child";
    const parentCollection = {
      collectionId: parentId,
      parentId: null,
      name: "Parent",
      description: null,
      coverAssetId: null,
      position: 0,
      assetCount: 4,
      childCollectionCount: 1,
    };
    const childCollection = {
      collectionId: childId,
      parentId,
      name: "Child",
      description: null,
      coverAssetId: null,
      position: 0,
      assetCount: 2,
      childCollectionCount: 0,
    };
    const props = createNavigationProps({
      collections: [parentCollection, childCollection],
      collectionTree: new Map([
        [null, [parentCollection]],
        [parentId, [childCollection]],
      ]),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(NavigationSidebar, props),
        ),
      );
    });

    const rows = () => [
      ...(container as HTMLDivElement).querySelectorAll<HTMLButtonElement>(
        "button[data-nav-collection-id]",
      ),
    ];
    // Both rows visible initially (expanded).
    expect(rows().map((row) => row.dataset.navCollectionId)).toEqual([
      parentId,
      childId,
    ]);

    // Parent row exposes a disclosure button with the chevron icon.
    const parentRow = rows().find(
      (row) => row.dataset.navCollectionId === parentId,
    );
    const disclosure = parentRow
      ? [...(container as HTMLDivElement).querySelectorAll<HTMLButtonElement>(".nav-disclosure")]
          .find((button) =>
            button.getAttribute("aria-label")?.includes("Parent"),
          )
      : undefined;
    expect(disclosure).toBeDefined();
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");

    // Collapse: child row disappears, disclosure flips to collapsed.
    await act(async () => disclosure?.click());
    expect(rows().map((row) => row.dataset.navCollectionId)).toEqual([
      parentId,
    ]);
    const collapsedDisclosure = [
      ...(container as HTMLDivElement).querySelectorAll<HTMLButtonElement>(".nav-disclosure"),
    ].find((button) => button.getAttribute("aria-label")?.includes("Parent"));
    expect(collapsedDisclosure?.getAttribute("aria-expanded")).toBe("false");

    // Expand: child row returns.
    await act(async () => collapsedDisclosure?.click());
    expect(rows().map((row) => row.dataset.navCollectionId)).toEqual([
      parentId,
      childId,
    ]);
  });

  it("highlights collection and trash rows for native File drags", async () => {
    const collection = {
      collectionId: "collection-1",
      parentId: null,
      name: "References",
      description: null,
      coverAssetId: null,
      position: 0,
      assetCount: 1,
      childCollectionCount: 0,
    };
    const props = createNavigationProps({
      collections: [collection],
      collectionTree: new Map([[null, [collection]]]),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(NavigationSidebar, props),
        ),
      );
    });

    const collectionRow = container.querySelector<HTMLButtonElement>(
      'button[data-nav-collection-id="collection-1"]',
    );
    const trashRow = [...container.querySelectorAll<HTMLButtonElement>(".nav-row")]
      .find((row) => /Trash|回收站/u.test(row.textContent ?? ""));
    expect(collectionRow).not.toBeNull();
    expect(trashRow).toBeDefined();

    const nativeFileTransfer = createDragTransfer(["Files"]);
    await act(async () => {
      dispatchDragEvent(collectionRow!, "dragover", nativeFileTransfer);
    });

    expect(collectionRow?.classList.contains("is-drop-target")).toBe(true);

    await act(async () => {
      dispatchDragEvent(trashRow!, "dragover", nativeFileTransfer);
    });

    expect(trashRow?.classList.contains("is-drop-target")).toBe(true);
    expect(collectionRow?.classList.contains("is-drop-target")).toBe(false);
  });

  it("keeps the child collection highlighted when a drag enters its row", async () => {
    const parent = {
      collectionId: "collection-parent",
      parentId: null,
      name: "Parent",
      description: null,
      coverAssetId: null,
      position: 0,
      assetCount: 1,
      childCollectionCount: 1,
    };
    const child = {
      collectionId: "collection-child",
      parentId: parent.collectionId,
      name: "Child",
      description: null,
      coverAssetId: null,
      position: 0,
      assetCount: 0,
      childCollectionCount: 0,
    };
    const onAssetsDroppedOnCollection = vi.fn();
    const onResolveManagedAssetDrop = vi.fn(async () => ["asset-1"]);
    const props = createNavigationProps({
      collections: [parent, child],
      collectionTree: new Map([
        [null, [parent]],
        [parent.collectionId, [child]],
      ]),
      onExternalDragOver: (event) => event.preventDefault(),
      onAssetsDroppedOnCollection,
      onResolveManagedAssetDrop,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(NavigationSidebar, props),
        ),
      );
    });

    const parentRow = container.querySelector<HTMLButtonElement>(
      `button[data-nav-collection-id="${parent.collectionId}"]`,
    );
    const childRow = container.querySelector<HTMLButtonElement>(
      `button[data-nav-collection-id="${child.collectionId}"]`,
    );
    expect(parentRow).not.toBeNull();
    expect(childRow).not.toBeNull();

    for (const types of [["Files"], ["application/x-serpent-managed-assets"]]) {
      await act(async () => {
        const dragOver = dispatchDragEvent(
          childRow!,
          "dragover",
          createDragTransfer(types),
        );
        if (types[0] === "Files") {
          expect(dragOver.defaultPrevented).toBe(true);
        }
      });

      expect(childRow?.classList.contains("is-drop-target")).toBe(true);
      expect(parentRow?.classList.contains("is-drop-target")).toBe(false);
    }

    const nativeFileTransfer = {
      ...createDragTransfer(["Files"]),
      files: [new File(["asset"], "asset.png")],
    } as unknown as DataTransfer;
    let dropEvent: Event | undefined;
    await act(async () => {
      dropEvent = dispatchDropEvent(childRow!, nativeFileTransfer);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dropEvent?.defaultPrevented).toBe(true);
    expect(onResolveManagedAssetDrop).toHaveBeenCalledWith(
      nativeFileTransfer.files,
    );
    expect(onAssetsDroppedOnCollection).toHaveBeenCalledWith(
      child.collectionId,
      ["asset-1"],
      "move",
    );
  });
});

describe("NavigationSidebar folder-section blank area", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  const parentFolder = {
    folderId: "folder-parent",
    parentFolderId: null,
    name: "Parent",
    relativePath: "parent",
    directAssetCount: 3,
    childFolderCount: 1,
  };
  const childFolder = {
    folderId: "folder-child",
    parentFolderId: "folder-parent",
    name: "Child",
    relativePath: "parent/child",
    directAssetCount: 5,
    childFolderCount: 0,
  };
  /** Another root-level folder: a drop here really does change the parent. */
  const siblingFolder = {
    folderId: "folder-sibling",
    parentFolderId: null,
    name: "Sibling",
    relativePath: "sibling",
    directAssetCount: 1,
    childFolderCount: 0,
  };

  async function renderSidebar(
    overrides: Partial<NavigationSidebarProps> = {},
  ): Promise<HTMLElement> {
    const props = createNavigationProps({
      folders: [parentFolder, childFolder, siblingFolder],
      ...overrides,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          // Explicit preference keeps the renderer independent of
          // globalThis.localStorage (see the sibling suite).
          { children: null, initialPreference: "zh-CN" },
          createElement(NavigationSidebar, props),
        ),
      );
    });
    const nav = container.querySelector<HTMLElement>(".navigation-scroll");
    expect(nav).not.toBeNull();
    return nav!;
  }

  function folderRow(nav: HTMLElement, folderId: string): HTMLButtonElement {
    const row = nav.querySelector<HTMLButtonElement>(
      `button[data-nav-folder-id="${folderId}"]`,
    );
    expect(row).not.toBeNull();
    return row!;
  }

  /** The folder list container: its own box is the blank area's outer edge. */
  function folderList(nav: HTMLElement): HTMLElement {
    const list = nav.querySelector<HTMLElement>(".nav-folder-list");
    expect(list).not.toBeNull();
    return list!;
  }

  /** The indentation column left of a row: blank, but visually part of it. */
  function rowGutter(nav: HTMLElement, folderId: string): HTMLElement {
    const gutter = folderRow(nav, folderId).closest<HTMLElement>(".nav-tree-row");
    expect(gutter).not.toBeNull();
    return gutter!;
  }

  // Serpent-6e3b10
  it("returns to the library root when the folder list itself is clicked", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      assetScope: "folder-child",
      onChooseFolder,
    });

    await act(async () => folderList(nav).click());

    expect(onChooseFolder).toHaveBeenCalledWith("root");
  });

  // Serpent-6e3b10 — the folder section's own empty state is inside the blank
  // area; the collections / smart-collections sections are not.
  it("returns to the library root when the folder section's empty state is clicked", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      assetScope: "folder-child",
      folders: [],
      onChooseFolder,
    });
    const emptyState = nav.querySelector<HTMLElement>(
      ".nav-folder-list p.nav-empty",
    );
    expect(emptyState).not.toBeNull();

    await act(async () => emptyState!.click());

    expect(onChooseFolder).toHaveBeenCalledWith("root");
  });

  // Serpent-6e3b10
  it("returns to the library root when the indentation gutter is clicked", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      assetScope: "folder-child",
      onChooseFolder,
    });

    await act(async () => rowGutter(nav, childFolder.folderId).click());

    expect(onChooseFolder).toHaveBeenCalledWith("root");
  });

  // Serpent-6e3b10 — everything outside the folder section stays inert.
  it("does not navigate from the rest of the pane", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      assetScope: "folder-child",
      collections: [],
      smartCollections: [],
      onChooseFolder,
    });
    const collectionsEmptyState = [
      ...nav.querySelectorAll<HTMLElement>("p.nav-empty"),
    ].find((node) => !node.closest(".nav-folder-list"));
    const heading = nav.querySelector<HTMLElement>(".nav-section-heading > span");
    expect(collectionsEmptyState).toBeDefined();
    expect(heading).not.toBeNull();

    await act(async () => {
      collectionsEmptyState!.click();
      heading!.click();
      nav.click();
    });

    expect(onChooseFolder).not.toHaveBeenCalled();
  });

  // Serpent-316493 follow-up: right-clicking the blank area is a right-click on
  // the library root.
  it("opens the root context menu when the blank area is right-clicked", async () => {
    const onOpenRootFolderContextMenu = vi.fn();
    const nav = await renderSidebar({ onOpenRootFolderContextMenu });

    await act(async () => {
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 42,
        clientY: 24,
      });
      folderList(nav).dispatchEvent(event);
    });

    expect(onOpenRootFolderContextMenu).toHaveBeenCalledWith({ x: 42, y: 24 });
  });

  it("keeps a folder row right-click on that row's own menu", async () => {
    const onOpenRootFolderContextMenu = vi.fn();
    const nav = await renderSidebar({ onOpenRootFolderContextMenu });

    await act(async () => {
      folderRow(nav, childFolder.folderId).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });

    expect(onOpenRootFolderContextMenu).not.toHaveBeenCalled();
  });

  // Serpent-a6c516: the 「资源库根目录」 row is the same subject as the blank area.
  it("opens the root context menu from the library root row", async () => {
    const onOpenRootFolderContextMenu = vi.fn();
    const nav = await renderSidebar({ onOpenRootFolderContextMenu });
    const rootRow = [
      ...nav.querySelectorAll<HTMLButtonElement>(".nav-row"),
    ].find((row) => row.textContent?.includes("资源库根目录"));
    expect(rootRow).toBeDefined();

    await act(async () => {
      rootRow!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 7,
          clientY: 9,
        }),
      );
    });

    expect(onOpenRootFolderContextMenu).toHaveBeenCalledWith({ x: 7, y: 9 });
  });

  // Serpent-6e3b10
  it("keeps a folder row click on that folder and never falls back to the root", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({ onChooseFolder });

    await act(async () => folderRow(nav, childFolder.folderId).click());

    expect(onChooseFolder).toHaveBeenCalledWith(childFolder.folderId);
    expect(onChooseFolder).not.toHaveBeenCalledWith("root");
  });

  // Serpent-6e3b10
  it("ignores blank-area clicks while an inline editor owns the click", async () => {
    const onChooseFolder = vi.fn();
    const nav = await renderSidebar({
      inlineFolderEdit: {
        kind: "create",
        parentFolderId: null,
        value: "New",
        error: null,
        submitting: false,
      },
      onChooseFolder,
    });

    await act(async () => {
      folderList(nav).click();
      rowGutter(nav, childFolder.folderId).click();
    });

    expect(onChooseFolder).not.toHaveBeenCalled();
  });

  // Serpent-b29bc4
  it("moves dragged folders to the library root when dropped on the blank area", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const list = folderList(nav);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(list, "dragenter", transfer);
      dispatchDragEvent(list, "dragover", transfer);
    });
    expect(
      nav
        .querySelector(".nav-folder-list")!
        .classList.contains("is-root-drop-target"),
    ).toBe(true);

    let dropEvent: Event | undefined;
    await act(async () => {
      dropEvent = dispatchDropEvent(list, transfer);
    });

    expect(dropEvent?.defaultPrevented).toBe(true);
    expect(onFoldersDroppedOnFolder).toHaveBeenCalledWith(null, [
      childFolder.folderId,
    ]);
    expect(
      nav
        .querySelector(".nav-folder-list")!
        .classList.contains("is-root-drop-target"),
    ).toBe(false);
  });

  // Serpent-b29bc4
  it("moves dragged folders to the root when dropped on the gutter", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const gutter = rowGutter(nav, childFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(gutter, "dragenter", transfer);
      dispatchDragEvent(gutter, "dragover", transfer);
      dispatchDropEvent(gutter, transfer);
    });

    expect(onFoldersDroppedOnFolder).toHaveBeenCalledWith(null, [
      childFolder.folderId,
    ]);
  });

  // Serpent-b29bc4
  it("keeps a folder row drop on that row instead of the blank area", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const row = folderRow(nav, parentFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      // Real HTML5 drags fire dragenter before dragover; the row highlight is
      // set on dragenter, the drop decision on dragover.
      dispatchDragEvent(row, "dragenter", transfer);
      dispatchDragEvent(row, "dragover", transfer);
    });
    expect(row.classList.contains("is-drop-target")).toBe(true);
    expect(
      nav
        .querySelector(".nav-folder-list")!
        .classList.contains("is-root-drop-target"),
    ).toBe(false);

    await act(async () => {
      dispatchDropEvent(row, transfer);
    });

    expect(onFoldersDroppedOnFolder).toHaveBeenCalledWith(
      parentFolder.folderId,
      [childFolder.folderId],
    );
  });

  // Serpent-b29bc4 — dragging off the blank area onto a row must hand the
  // highlight over instead of leaving both lit.
  it("clears the blank-area highlight once the drag hovers a folder row", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const list = nav.querySelector<HTMLElement>(".nav-folder-list")!;
    const row = folderRow(nav, parentFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(list, "dragenter", transfer);
      dispatchDragEvent(list, "dragover", transfer);
    });
    expect(list.classList.contains("is-root-drop-target")).toBe(true);

    await act(async () => {
      dispatchDragEvent(row, "dragenter", transfer);
      dispatchDragEvent(row, "dragover", transfer);
    });

    expect(list.classList.contains("is-root-drop-target")).toBe(false);
    expect(row.classList.contains("is-drop-target")).toBe(true);
  });

  // Serpent-374266: a target that would change nothing is not a target — it must
  // not highlight (and therefore never shows the "cannot move" notice).
  it("does not highlight folder targets that would change nothing", async () => {
    const nav = await renderSidebar();
    const childRow = folderRow(nav, childFolder.folderId);
    const parentRow = folderRow(nav, parentFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    // The drag payload is unreadable during dragover (protected mode), so the
    // sidebar records the ids at dragstart; replay that here.
    await act(async () => {
      dispatchDragEvent(childRow, "dragstart", transfer);
    });

    await act(async () => {
      // Its current parent, and its own row.
      dispatchDragEvent(parentRow, "dragenter", transfer);
      dispatchDragEvent(parentRow, "dragover", transfer);
      dispatchDragEvent(childRow, "dragenter", transfer);
      dispatchDragEvent(childRow, "dragover", transfer);
    });

    expect(parentRow.classList.contains("is-drop-target")).toBe(false);
    expect(childRow.classList.contains("is-drop-target")).toBe(false);
  });

  // Serpent-374266 — the counterpart: a real reparent still highlights.
  it("still highlights a folder target that would change the parent", async () => {
    const nav = await renderSidebar();
    const childRow = folderRow(nav, childFolder.folderId);
    const siblingRow = folderRow(nav, siblingFolder.folderId);
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(childRow, "dragstart", transfer);
      dispatchDragEvent(siblingRow, "dragenter", transfer);
      dispatchDragEvent(siblingRow, "dragover", transfer);
    });

    expect(siblingRow.classList.contains("is-drop-target")).toBe(true);
  });

  // Serpent-374266 — folders that already live at the root have nowhere to go.
  it("does not highlight the blank area for folders already at the root", async () => {
    const nav = await renderSidebar();
    const parentRow = folderRow(nav, parentFolder.folderId);
    const list = folderList(nav);
    const transfer = createFolderDragTransfer([parentFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(parentRow, "dragstart", transfer);
      dispatchDragEvent(list, "dragenter", transfer);
      dispatchDragEvent(list, "dragover", transfer);
    });

    expect(list.classList.contains("is-root-drop-target")).toBe(false);
  });

  // Serpent-b29bc4 — one more time: no folder drag, no root move.
  it("moves nothing when a folder is dropped outside the folder section", async () => {    const onFoldersDroppedOnFolder = vi.fn();
    const nav = await renderSidebar({ onFoldersDroppedOnFolder });
    const collectionsHeading = [
      ...nav.querySelectorAll<HTMLElement>(".nav-section-heading > span"),
    ].find((node) => node.textContent?.trim() === "合集");
    expect(collectionsHeading).toBeDefined();
    const transfer = createFolderDragTransfer([childFolder.folderId]);

    await act(async () => {
      dispatchDragEvent(collectionsHeading!, "dragenter", transfer);
      dispatchDragEvent(collectionsHeading!, "dragover", transfer);
      dispatchDropEvent(collectionsHeading!, transfer);
    });

    expect(onFoldersDroppedOnFolder).not.toHaveBeenCalled();
  });

  // Serpent-b29bc4 — blank space must not become a new asset/file target.
  it("leaves asset and native-file drags over the blank area untouched", async () => {
    const onFoldersDroppedOnFolder = vi.fn();
    const onExternalDrop = vi.fn();
    const nav = await renderSidebar({
      onFoldersDroppedOnFolder,
      onExternalDrop,
    });
    const list = folderList(nav);
    const assetTransfer = {
      ...createDragTransfer(["application/x-serpent-managed-assets"]),
      getData: () => JSON.stringify(["asset-1"]),
    } as unknown as DataTransfer;
    const fileTransfer = {
      ...createDragTransfer(["Files"]),
      files: [new File(["asset"], "asset.png")],
    } as unknown as DataTransfer;

    let assetDragOver: Event | undefined;
    let fileDrop: Event | undefined;
    await act(async () => {
      assetDragOver = dispatchDragEvent(list, "dragover", assetTransfer);
      fileDrop = dispatchDropEvent(list, fileTransfer);
    });

    expect(assetDragOver?.defaultPrevented).toBe(false);
    expect(fileDrop?.defaultPrevented).toBe(false);
    expect(
      nav
        .querySelector(".nav-folder-list")!
        .classList.contains("is-root-drop-target"),
    ).toBe(false);
    expect(onFoldersDroppedOnFolder).not.toHaveBeenCalled();
    expect(onExternalDrop).not.toHaveBeenCalled();
  });
});
