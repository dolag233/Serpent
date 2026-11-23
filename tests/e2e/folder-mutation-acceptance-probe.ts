import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statfsSync,
  type Dirent,
  type Stats,
} from "node:fs";
import path from "node:path";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";

const MANAGED_OLD = "OwnedManagedBefore";
const MANAGED_NEW = "OwnedManagedAfter";
const LINKED_ROOT = "OwnedMutationSource";
const LINKED_CHILD_OLD = "OwnedChildBefore";
const LINKED_CHILD_INTERMEDIATE = "OwnedChildIntermediate";
const LINKED_CHILD_NEW = "OwnedChildAfter";
const LINKED_GRANDCHILD = "OwnedGrandchild";
const MAX_SOURCE_IMAGE_BYTES = 4 * 1024 * 1024;
const MIN_FREE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_ENTRIES = 8_000;
const NATIVE_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

type SourceImage = { path: string; extension: string; size: number };

export type FolderMutationAcceptanceResult = {
  copiedSampleCount: number;
  decodedImage: boolean;
  managed: {
    visibleAfterCreateAndRename: boolean;
    typedApiAgrees: boolean;
  };
  linked: {
    visibleAfterCreateAndRename: boolean;
    descendantIdAndPathUpdated: boolean;
    ownedDiskSubtreeRenamed: boolean;
  };
};

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function assertOwnedDirectory(root: string, candidate: string): void {
  let rootReal: string;
  let candidateReal: string;
  let candidateInfo: Stats;
  try {
    rootReal = realpathSync(root);
    candidateReal = realpathSync(candidate);
    candidateInfo = lstatSync(candidate);
  } catch {
    throw new Error("Could not verify the owned probe directory.");
  }
  if (
    !candidateInfo.isDirectory() ||
    candidateInfo.isSymbolicLink() ||
    !isWithin(rootReal, candidateReal)
  ) {
    throw new Error("The probe directory is outside its owned root or is a reparse point.");
  }
}

function assertOwnedTreeHasNoReparsePoints(directory: string): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    throw new Error("Could not verify the owned linked-source tree.");
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    let info: Stats;
    try {
      info = lstatSync(child);
    } catch {
      throw new Error("Could not verify an owned linked-source entry.");
    }
    if (info.isSymbolicLink()) {
      throw new Error("The owned linked-source tree contains a reparse point.");
    }
    if (info.isDirectory()) assertOwnedTreeHasNoReparsePoints(child);
  }
}

function findSourceImages(sourceRoot: string): SourceImage[] {
  let rootInfo: Stats;
  let rootReal: string;
  try {
    rootInfo = lstatSync(sourceRoot);
    rootReal = realpathSync(sourceRoot);
  } catch {
    throw new Error("The configured read-only image source is unavailable.");
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("The configured read-only image source is not a plain directory.");
  }

  const found: SourceImage[] = [];
  let examined = 0;
  const visit = (directory: string, depth: number) => {
    if (found.length >= 2 || depth > 5 || examined >= MAX_SOURCE_ENTRIES) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= 2 || examined >= MAX_SOURCE_ENTRIES) return;
      examined += 1;
      const candidate = path.join(directory, entry.name);
      let info: Stats;
      try {
        info = lstatSync(candidate);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        visit(candidate, depth + 1);
        continue;
      }
      if (!info.isFile() || info.size <= 0 || info.size > MAX_SOURCE_IMAGE_BYTES) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!NATIVE_IMAGE_EXTENSIONS.has(extension)) continue;
      let candidateReal: string;
      try {
        candidateReal = realpathSync(candidate);
      } catch {
        continue;
      }
      if (!isWithin(rootReal, candidateReal)) continue;
      found.push({ path: candidate, extension, size: info.size });
    }
  };
  visit(sourceRoot, 0);
  if (found.length === 0) {
    throw new Error("No small, supported image was found in the read-only source.");
  }
  return found;
}

function createOwnedImageSource(
  ownedRoot: string,
  readOnlySourceRoot: string,
): { sourcePath: string; fileNames: string[] } {
  let ownedRootReal: string;
  let readOnlySourceReal: string;
  try {
    const ownedInfo = lstatSync(ownedRoot);
    if (!ownedInfo.isDirectory() || ownedInfo.isSymbolicLink()) {
      throw new Error("invalid owned root");
    }
    ownedRootReal = realpathSync(ownedRoot);
    readOnlySourceReal = realpathSync(readOnlySourceRoot);
  } catch {
    throw new Error("Could not verify the probe roots.");
  }
  if (
    isWithin(ownedRootReal, readOnlySourceReal) ||
    isWithin(readOnlySourceReal, ownedRootReal)
  ) {
    throw new Error("The read-only source and owned probe root must be separate.");
  }

  const samples = findSourceImages(readOnlySourceReal);
  const requiredBytes = samples.reduce((total, sample) => total + sample.size, 0);
  let availableBytes: number;
  try {
    const space = statfsSync(ownedRootReal);
    availableBytes = Number(space.bavail) * Number(space.bsize);
  } catch {
    throw new Error("Could not check free space for the owned probe root.");
  }
  if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes + MIN_FREE_BYTES) {
    throw new Error("Insufficient free space for the owned linked-source probe.");
  }

  const sourcePath = path.join(ownedRootReal, "owned-linked-source");
  try {
    lstatSync(sourcePath);
    throw new Error("The owned linked-source path already exists.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof Error && error.message === "The owned linked-source path already exists.") {
        throw error;
      }
      throw new Error("Could not verify the owned linked-source path.", { cause: error });
    }
  }
  try {
    mkdirSync(sourcePath, { recursive: false });
  } catch {
    throw new Error("Could not create the owned linked-source directory.");
  }
  assertOwnedDirectory(ownedRootReal, sourcePath);

  const fileNames = samples.map((sample, index) => {
    const fileName = "owned-image-" + (index + 1) + sample.extension;
    const destination = path.join(sourcePath, fileName);
    try {
      copyFileSync(sample.path, destination, constants.COPYFILE_EXCL);
      const copiedInfo = lstatSync(destination);
      if (
        !copiedInfo.isFile() ||
        copiedInfo.isSymbolicLink() ||
        copiedInfo.size !== sample.size
      ) {
        throw new Error("invalid copied image");
      }
    } catch {
      throw new Error("Could not copy a small image into the owned linked-source directory.");
    }
    return fileName;
  });
  assertOwnedDirectory(ownedRootReal, sourcePath);
  assertOwnedTreeHasNoReparsePoints(sourcePath);
  return { sourcePath, fileNames };
}

function folderRow(page: Page, kind: "managed" | "linked", name: string) {
  const label = page.locator(".navigation-pane .nav-row-label").getByText(name, { exact: true });
  return label.locator(
    "xpath=ancestor::button[contains(@class, 'nav-row') and @data-nav-folder-kind='" + kind + "']",
  );
}

async function openFolderMenu(page: Page, kind: "managed" | "linked", name: string) {
  const row = folderRow(page, kind, name);
  await expect(row).toHaveCount(1, { timeout: 120_000 });
  await expect(row).toBeVisible({ timeout: 120_000 });
  await page.mouse.move(0, 0);
  await row.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "文件夹操作：" + name, exact: true });
  await expect(menu).toBeVisible({ timeout: 30_000 });
  return menu;
}

async function commitInlineEdit(page: Page, name: string): Promise<void> {
  const input = page.locator(".nav-inline-edit input");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(name);
  await input.press("Enter");
  await expect(page.locator(".nav-inline-edit")).toHaveCount(0, { timeout: 120_000 });
}

async function createChildFromMenu(
  page: Page,
  kind: "managed" | "linked",
  parentName: string,
  childName: string,
): Promise<void> {
  const menu = await openFolderMenu(page, kind, parentName);
  await menu.getByRole("menuitem", { name: "新建子文件夹", exact: true }).click();
  await commitInlineEdit(page, childName);
  await expect(folderRow(page, kind, childName)).toHaveCount(1, { timeout: 120_000 });
}

async function renameFromMenu(
  page: Page,
  kind: "managed" | "linked",
  oldName: string,
  newName: string,
): Promise<void> {
  const menu = await openFolderMenu(page, kind, oldName);
  await menu.getByRole("menuitem", { name: "重命名…", exact: true }).click();
  const input = page.locator(".nav-inline-edit input, .folder-card-rename-input");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await expect(input).toHaveValue(oldName);
  await input.fill(newName);
  await input.press("Enter");
  await expect(page.locator(".nav-inline-edit")).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator(".folder-card-rename-input")).toHaveCount(0);
  await expect(folderRow(page, kind, newName)).toHaveCount(1, { timeout: 120_000 });
  await expect(folderRow(page, kind, oldName)).toHaveCount(0);
}

async function expandIfNeeded(
  page: Page,
  kind: "managed" | "linked",
  name: string,
): Promise<void> {
  const row = folderRow(page, kind, name);
  const treeRow = row.locator(
    "xpath=ancestor::div[contains(@class, 'nav-tree-row')]",
  );
  const disclosure = treeRow.locator("button.nav-disclosure");
  if (await disclosure.count()) {
    if (await disclosure.getAttribute("aria-expanded") !== "true") {
      await disclosure.click();
    }
  }
}

async function readLinkedTopology(
  page: Page,
  libraryId: string,
  childName: string,
  grandchildName: string,
): Promise<{ childId: string; grandchildId: string }> {
  const result = await page.evaluate(async ({ libraryId, rootName, childName, grandchildName }) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const roots = await api.listLinkedFolders({ libraryId });
    if (!roots.ok) return null;
    const root = roots.value.find((item) =>
      item.displayName === rootName && item.relativePath === "",
    );
    if (!root) return null;
    const rootId = root.linkedFolderId ?? root.folderId;
    const children = await api.listFolderBrowseEntries({ libraryId, parentFolderId: rootId });
    if (!children.ok) return null;
    const child = children.value.find((item) =>
      item.name === childName && item.relativePath === childName,
    );
    if (!child) return null;
    const descendants = await api.listFolderBrowseEntries({
      libraryId,
      parentFolderId: child.folderId,
    });
    if (!descendants.ok) return null;
    const grandchild = descendants.value.find((item) =>
      item.name === grandchildName &&
      item.relativePath === childName + "/" + grandchildName,
    );
    if (!grandchild) return null;
    return { childId: child.folderId, grandchildId: grandchild.folderId };
  }, { libraryId, rootName: LINKED_ROOT, childName, grandchildName });
  if (!result) throw new Error("Typed linked-folder browse data is missing before rename.");
  return result;
}

export async function probeFolderMutationAcceptance(options: {
  application: ElectronApplication;
  window: Page;
  libraryId: string;
  ownedRoot: string;
  readOnlySourceRoot: string;
}): Promise<FolderMutationAcceptanceResult> {
  const { application, window, libraryId, ownedRoot, readOnlySourceRoot } = options;
  const ownedSource = createOwnedImageSource(ownedRoot, readOnlySourceRoot);

  await window.getByRole("button", { name: "所有资产", exact: true }).click();
  await window.getByRole("button", { name: "添加文件夹", exact: true }).click();
  await commitInlineEdit(window, MANAGED_OLD);
  const managedBeforeRow = folderRow(window, "managed", MANAGED_OLD);
  await expect(managedBeforeRow).toHaveCount(1, { timeout: 120_000 });
  const managedId = await managedBeforeRow.getAttribute("data-nav-folder-id");
  if (!managedId) throw new Error("The created managed folder has no navigation identity.");
  await renameFromMenu(window, "managed", MANAGED_OLD, MANAGED_NEW);

  const managedApi = await window.evaluate(async ({ libraryId, oldName, newName, expectedId }) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const result = await api.listFolders({ libraryId, showIgnored: true });
    if (!result.ok) return { typedApiAgrees: false };
    const current = result.value.filter((folder) => folder.name === newName);
    return {
      typedApiAgrees: current.length === 1 &&
        current[0]?.folderId === expectedId &&
        current[0]?.relativePath === newName &&
        !result.value.some((folder) => folder.name === oldName),
    };
  }, { libraryId, oldName: MANAGED_OLD, newName: MANAGED_NEW, expectedId: managedId });

  await application.evaluate((_, sourcePath) => {
    process.env.SERPENT_E2E_LINKED_SOURCE = sourcePath;
  }, ownedSource.sourcePath);
  const imported = await window.evaluate(async ({ libraryId, displayName }) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const result = await api.importFolderAsLinked({ libraryId, displayName });
    return result.ok;
  }, { libraryId, displayName: LINKED_ROOT });
  expect(imported).toBe(true);

  const rootRow = folderRow(window, "linked", LINKED_ROOT);
  await expect(rootRow).toHaveCount(1, { timeout: 120_000 });
  await expect(rootRow).toBeVisible({ timeout: 120_000 });
  await rootRow.click();
  const firstImageName = ownedSource.fileNames[0]!;
  const imageCard = window.locator(".asset-card[data-asset-name='" + firstImageName + "']");
  const image = imageCard.locator("img.asset-thumbnail").first();
  await expect(image).toBeVisible({ timeout: 120_000 });
  await image.click();
  await window.keyboard.press("Space");
  const viewerImage = window.locator(".workspace-viewer img.preview-image:not(.is-hidden)");
  await expect(viewerImage).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => viewerImage.evaluate((element) =>
    element instanceof HTMLImageElement &&
    element.complete &&
    element.naturalWidth > 0 &&
    element.naturalHeight > 0,
  ), { timeout: 60_000 }).toBe(true);
  await window.keyboard.press("Escape");

  await createChildFromMenu(window, "linked", LINKED_ROOT, LINKED_CHILD_OLD);
  await expandIfNeeded(window, "linked", LINKED_ROOT);
  await expect(folderRow(window, "linked", LINKED_CHILD_OLD)).toBeVisible({ timeout: 60_000 });
  await createChildFromMenu(window, "linked", LINKED_CHILD_OLD, LINKED_GRANDCHILD);
  await expandIfNeeded(window, "linked", LINKED_ROOT);
  await expandIfNeeded(window, "linked", LINKED_CHILD_OLD);
  await expect(folderRow(window, "linked", LINKED_GRANDCHILD)).toBeVisible({ timeout: 60_000 });

  // A visible child card owns the first rename editor; the second rename is
  // in the sidebar while that folder's descendant is the active browse scope.
  await renameFromMenu(window, "linked", LINKED_CHILD_OLD, LINKED_CHILD_INTERMEDIATE);
  await expandIfNeeded(window, "linked", LINKED_ROOT);
  await expandIfNeeded(window, "linked", LINKED_CHILD_INTERMEDIATE);
  await folderRow(window, "linked", LINKED_GRANDCHILD).click();
  await expect(window.locator(".scope-crumb-label.is-current"))
    .toHaveText(LINKED_GRANDCHILD);

  const oldLinkedIds = await readLinkedTopology(
    window,
    libraryId,
    LINKED_CHILD_INTERMEDIATE,
    LINKED_GRANDCHILD,
  );
  await renameFromMenu(window, "linked", LINKED_CHILD_INTERMEDIATE, LINKED_CHILD_NEW);
  await expandIfNeeded(window, "linked", LINKED_ROOT);
  await expandIfNeeded(window, "linked", LINKED_CHILD_NEW);
  const childAfterRow = folderRow(window, "linked", LINKED_CHILD_NEW);
  const grandchildAfterRow = folderRow(window, "linked", LINKED_GRANDCHILD);
  await expect(childAfterRow).toBeVisible({ timeout: 60_000 });
  await expect(grandchildAfterRow).toBeVisible({ timeout: 60_000 });
  await expect(grandchildAfterRow).toHaveClass(/is-active/);
  await expect(window.locator(".scope-crumb-label.is-current"))
    .toHaveText(LINKED_GRANDCHILD);
  await expect(window.locator(".scope-breadcrumbs").getByRole("button", { name: LINKED_CHILD_NEW, exact: true }))
    .toBeVisible();

  const currentLinkedIds = await window.evaluate(({ oldChildId, oldGrandchildId, childName, grandchildName }) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(
      '.navigation-pane button.nav-row[data-nav-folder-kind="linked"]',
    ));
    const rowFor = (name: string) => rows.find((row) =>
      row.querySelector(".nav-row-label")?.textContent?.trim() === name,
    );
    const child = rowFor(childName);
    const grandchild = rowFor(grandchildName);
    const ids = rows.map((row) => row.dataset.navFolderId ?? "");
    return {
      oldIdsAbsent: !ids.includes(oldChildId) && !ids.includes(oldGrandchildId),
      childAndDescendantIdsChanged: Boolean(child && grandchild) &&
        child?.dataset.navFolderId !== oldChildId &&
        grandchild?.dataset.navFolderId !== oldGrandchildId,
      hasLinkedRows: rows.length > 0,
    };
  }, {
    oldChildId: oldLinkedIds.childId,
    oldGrandchildId: oldLinkedIds.grandchildId,
    childName: LINKED_CHILD_NEW,
    grandchildName: LINKED_GRANDCHILD,
  });

  const updatedLinkedApi = await window.evaluate(async ({
    libraryId,
    oldChildId,
    oldGrandchildId,
    newChildName,
    grandchildName,
    rootName,
  }) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const roots = await api.listLinkedFolders({ libraryId });
    if (!roots.ok) return { descendantIdAndPathUpdated: false };
    const matchingRoots = roots.value.filter((item) =>
      item.displayName === rootName && item.relativePath === "",
    );
    if (matchingRoots.length !== 1) return { descendantIdAndPathUpdated: false };
    const rootId = matchingRoots[0]!.linkedFolderId ?? matchingRoots[0]!.folderId;
    const children = await api.listFolderBrowseEntries({ libraryId, parentFolderId: rootId });
    if (!children.ok) return { descendantIdAndPathUpdated: false };
    const child = children.value.find((item) =>
      item.name === newChildName && item.relativePath === newChildName,
    );
    if (!child) return { descendantIdAndPathUpdated: false };
    const descendants = await api.listFolderBrowseEntries({
      libraryId,
      parentFolderId: child.folderId,
    });
    if (!descendants.ok) return { descendantIdAndPathUpdated: false };
    const grandchild = descendants.value.find((item) =>
      item.name === grandchildName &&
      item.relativePath === newChildName + "/" + grandchildName,
    );
    const oldIdsAbsent =
      !children.value.some((item) => item.folderId === oldChildId) &&
      !descendants.value.some((item) => item.folderId === oldGrandchildId);
    return {
      descendantIdAndPathUpdated: Boolean(grandchild) &&
        child.folderId !== oldChildId &&
        grandchild?.folderId !== oldGrandchildId &&
        oldIdsAbsent,
    };
  }, {
    libraryId,
    oldChildId: oldLinkedIds.childId,
    oldGrandchildId: oldLinkedIds.grandchildId,
    newChildName: LINKED_CHILD_NEW,
    grandchildName: LINKED_GRANDCHILD,
    rootName: LINKED_ROOT,
  });

  await childAfterRow.click();
  await expect(window.locator(".scope-crumb-label.is-current"))
    .toHaveText(LINKED_CHILD_NEW, { timeout: 60_000 });
  await grandchildAfterRow.click();
  await expect(window.locator(".scope-crumb-label.is-current"))
    .toHaveText(LINKED_GRANDCHILD, { timeout: 60_000 });

  assertOwnedDirectory(ownedRoot, ownedSource.sourcePath);
  assertOwnedTreeHasNoReparsePoints(ownedSource.sourcePath);
  const ownedDiskSubtreeRenamed =
    existsSync(path.join(ownedSource.sourcePath, LINKED_CHILD_NEW, LINKED_GRANDCHILD)) &&
    !existsSync(path.join(ownedSource.sourcePath, LINKED_CHILD_OLD));

  const result: FolderMutationAcceptanceResult = {
    copiedSampleCount: ownedSource.fileNames.length,
    decodedImage: true,
    managed: {
      visibleAfterCreateAndRename: await folderRow(window, "managed", MANAGED_NEW).count() === 1,
      typedApiAgrees: managedApi.typedApiAgrees,
    },
    linked: {
      visibleAfterCreateAndRename: currentLinkedIds.hasLinkedRows && currentLinkedIds.oldIdsAbsent,
      descendantIdAndPathUpdated: updatedLinkedApi.descendantIdAndPathUpdated &&
        currentLinkedIds.childAndDescendantIdsChanged,
      ownedDiskSubtreeRenamed,
    },
  };
  expect(result.decodedImage).toBe(true);
  expect(result.managed).toEqual({ visibleAfterCreateAndRename: true, typedApiAgrees: true });
  expect(result.linked).toEqual({
    visibleAfterCreateAndRename: true,
    descendantIdAndPathUpdated: true,
    ownedDiskSubtreeRenamed: true,
  });
  return result;
}
