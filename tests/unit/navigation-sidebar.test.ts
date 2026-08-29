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

function dispatchDragEvent(
  element: Element,
  type: "dragenter" | "dragover",
  dataTransfer: DataTransfer,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  element.dispatchEvent(event);
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
    expect(parentFolderRow?.style.paddingLeft).toBe("21px");
    expect(childFolderRow?.style.paddingLeft).toBe("35px");
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
    expect(childCollectionRow?.style.paddingLeft).toBe("21px");
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
    const props = createNavigationProps({
      collections: [parent, child],
      collectionTree: new Map([
        [null, [parent]],
        [parent.collectionId, [child]],
      ]),
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
        dispatchDragEvent(childRow!, "dragover", createDragTransfer(types));
      });

      expect(childRow?.classList.contains("is-drop-target")).toBe(true);
      expect(parentRow?.classList.contains("is-drop-target")).toBe(false);
    }
  });
});
