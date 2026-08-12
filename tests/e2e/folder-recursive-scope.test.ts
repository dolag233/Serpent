import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assetCard,
  resolveElectronExecutablePath,
} from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

function launchApp(temporaryRoot: string, libraryPath: string, importFiles: string) {
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  return electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_IMPORT_FILES: importFiles,
    },
  });
}

async function createLibrary(window: Page, libraryName: string) {
  await window.getByRole("button", { name: "创建资源库" }).click();
  await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
  await window.getByRole("button", { name: "创建", exact: true }).click();
}

/**
 * Fills the open inline folder edit row and commits with Enter, then waits
 * for the row to leave edit mode (same inline flow as
 * folder-context-menu.test.ts).
 */
async function commitInlineFolderEdit(window: Page, folderName: string) {
  const input = window.locator(".nav-inline-edit input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(folderName);
  await input.press("Enter");
  await expect(window.locator(".nav-inline-edit")).toHaveCount(0, {
    timeout: 10_000,
  });
}

/**
 * Locates a managed folder's sidebar nav row by its exact label text.
 *
 * Folder names are NOT looked up via getByRole('button', { name }) because a
 * new folder only shows as a canvas folder-card in a managed folder/root view
 * — the default "所有资产" scope intentionally has no folder-card row
 * (FOLDER-010; folder-card-selection.test.ts) — and the sidebar nav-row label
 * ellipsis-truncates in narrow panes, clipping the text node and breaking an
 * accessible-name match. Targeting the label text + ancestor row is stable.
 */
function sidebarFolderRow(window: Page, folderName: string) {
  return window
    .locator(".navigation-pane .nav-row-label", { hasText: folderName })
    .locator("xpath=ancestor::button[contains(@class, 'nav-row')]");
}

/**
 * Creates a root-level managed folder through the sidebar “添加文件夹” entry
 * and waits until its nav row is rendered.
 */
async function createFolderViaSidebar(window: Page, folderName: string) {
  await window.getByRole("button", { name: "添加文件夹" }).click();
  await commitInlineFolderEdit(window, folderName);
  await expect(sidebarFolderRow(window, folderName)).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Right-clicks the sidebar nav row of a managed folder and returns the open
 * context menu, asserting it is labelled for that exact folder.
 */
async function openFolderContextMenu(window: Page, folderName: string) {
  const row = sidebarFolderRow(window, folderName);
  await expect(row).toBeVisible();
  await row.click({ button: "right" });
  const menu = window.getByRole("menu", {
    name: `文件夹操作：${folderName}`,
    exact: true,
  });
  await expect(menu).toBeVisible({ timeout: 5_000 });
  return menu;
}

// ---------------------------------------------------------------------------
// REQ-FOLDER-009: folder browse defaults to direct children only; include
// subfolders is an explicit scope-bar switch. REQ-FILTER-012: with the switch
// on, folder-scoped search recurses into descendants.
// ---------------------------------------------------------------------------

test("folder browse stays direct until include-subfolders is checked", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-recursive-e2e-"),
  );
  const libraryName = "递归范围验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(sourceRoot);
  const parentSourcePath = path.join(sourceRoot, "parent-note.txt");
  const childSourcePath = path.join(sourceRoot, "child-note.txt");
  writeFileSync(parentSourcePath, "parent note");
  writeFileSync(childSourcePath, "child note");

  const application = await launchApp(
    temporaryRoot,
    libraryPath,
    [parentSourcePath, childSourcePath].join(path.delimiter),
  );

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "父文件夹");

    // Create 子文件夹 nested under 父文件夹 through the folder context menu
    // (inline pending row, committed with Enter).
    const menu = await openFolderContextMenu(window, "父文件夹");
    await menu.getByRole("menuitem", { name: "新建子文件夹" }).click();
    await commitInlineFolderEdit(window, "子文件夹");
    await expect(sidebarFolderRow(window, "子文件夹")).toBeVisible({
      timeout: 10_000,
    });

    // Import targets the currently selected folder: scope into 子文件夹 and
    // import both files into it.
    await sidebarFolderRow(window, "子文件夹").click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "子文件夹",
    );
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const parentCard = window
      .locator(".asset-card")
      .filter({ hasText: "parent-note.txt" });
    const childCard = window
      .locator(".asset-card")
      .filter({ hasText: "child-note.txt" });
    await expect(parentCard).toBeVisible({ timeout: 15_000 });
    await expect(childCard).toBeVisible({ timeout: 15_000 });

    // Both files really landed inside the nested subfolder on disk, so the
    // recursion assertions below are meaningful.
    expect(
      existsSync(
        path.join(libraryPath, "Assets", "父文件夹", "子文件夹", "parent-note.txt"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(libraryPath, "Assets", "父文件夹", "子文件夹", "child-note.txt"),
      ),
    ).toBe(true);

    // REQ-FOLDER-009 default: browsing 父文件夹 shows only direct assets.
    await window.locator("button.nav-row", { hasText: "父文件夹" }).click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "父文件夹",
    );
    // REQ-FOLDER-009: include-subfolders lives beside the workspace title.
    const includeSubfolders = window
      .locator(".workspace-title")
      .getByRole("button", { name: "包含子文件夹" });
    await expect(includeSubfolders).toBeVisible();
    await expect(includeSubfolders).toHaveAttribute("aria-pressed", "false");
    await expect(parentCard).toHaveCount(0, { timeout: 15_000 });
    await expect(childCard).toHaveCount(0);

    // Explicit switch: include descendants for browse + search.
    await includeSubfolders.click();
    await expect(includeSubfolders).toHaveAttribute("aria-pressed", "true");
    await expect(parentCard).toBeVisible({ timeout: 15_000 });
    await expect(childCard).toBeVisible({ timeout: 15_000 });

    // REQ-FILTER-012: searching while scoped to 父文件夹 with include on
    // recurses into descendant folders. There is no explicit search button —
    // submitting the search form (Enter) runs the query.
    await window.getByLabel("搜索资源库").fill("child-note");
    await window.getByLabel("搜索资源库").press("Enter");
    await expect(childCard).toBeVisible({ timeout: 15_000 });
    await expect(parentCard).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("asset cards can be dropped onto folder cards in the browse canvas", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-card-drop-e2e-"),
  );
  const libraryName = "文件夹卡片拖放验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(sourceRoot);
  const firstSourcePath = path.join(sourceRoot, "move-me.txt");
  const secondSourcePath = path.join(sourceRoot, "stay.txt");
  writeFileSync(firstSourcePath, "move me");
  writeFileSync(secondSourcePath, "stay");

  const application = await launchApp(
    temporaryRoot,
    libraryPath,
    [firstSourcePath, secondSourcePath].join(path.delimiter),
  );

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "父文件夹");
    await sidebarFolderRow(window, "父文件夹").click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "父文件夹",
    );
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    await expect(assetCard(window, "move-me.txt")).toBeVisible();

    const parentMenu = await openFolderContextMenu(window, "父文件夹");
    await parentMenu.getByRole("menuitem", { name: "新建子文件夹" }).click();
    await commitInlineFolderEdit(window, "子文件夹");
    await sidebarFolderRow(window, "父文件夹").click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "父文件夹",
    );
    const folderCard = window
      .locator(".folder-card")
      .filter({ hasText: "子文件夹" });
    const moveAssetCard = assetCard(window, "move-me.txt");
    await expect(folderCard).toBeVisible();
    await moveAssetCard.dragTo(folderCard);
    await expect(window.locator(".workspace-notice")).toContainText(
      "已移动 1 项资产",
    );
    await expect(moveAssetCard).toHaveCount(0);
    expect(
      existsSync(
        path.join(libraryPath, "Assets", "父文件夹", "子文件夹", "move-me.txt"),
      ),
    ).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("managed folder rows can be dragged into Trash", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-trash-drop-e2e-"),
  );
  const libraryName = "文件夹拖入回收站验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(sourceRoot);
  const sourcePath = path.join(sourceRoot, "inside-folder.txt");
  writeFileSync(sourcePath, "inside folder");

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "待回收文件夹");
    const folderRow = sidebarFolderRow(window, "待回收文件夹");
    await folderRow.click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "待回收文件夹",
    );
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    await expect(window.locator('[data-asset-id][title="inside-folder.txt"]')).toBeVisible({
      timeout: 15_000,
    });

    const trashRow = window.getByRole("button", {
      name: "回收站",
      exact: true,
    });
    await folderRow.dragTo(trashRow);
    await expect(window.locator(".workspace-notice")).toContainText(
      "已移入回收站",
      { timeout: 15_000 },
    );
    await expect(window.getByRole("button", { name: "撤销" })).toBeVisible({
      timeout: 5_000,
    });
    await expect(folderRow).toHaveCount(0);
    await trashRow.click();
    await expect(window.locator(".folder-card.is-trashed-folder")).toHaveCount(
      1,
      { timeout: 15_000 },
    );

    // The folder trash route must publish the same history receipt as asset
    // trash, so the visible toast Undo restores both the folder and its asset.
    await window.getByRole("button", { name: "撤销" }).click();
    await expect(window.locator(".workspace-notice")).toContainText(
      "已撤回上一步操作",
      { timeout: 15_000 },
    );
    const restoredFolderRow = sidebarFolderRow(window, "待回收文件夹");
    await expect(restoredFolderRow).toBeVisible({ timeout: 15_000 });
    await restoredFolderRow.click();
    await expect(window.locator('[data-asset-id][title="inside-folder.txt"]')).toBeVisible({
      timeout: 15_000,
    });
    expect(
      existsSync(path.join(libraryPath, "Assets", "待回收文件夹", "inside-folder.txt")),
    ).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
