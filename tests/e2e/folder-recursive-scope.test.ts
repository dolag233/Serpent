import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

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
  await window.getByLabel("名称").fill(libraryName);
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
 * Creates a root-level managed folder through the sidebar “添加文件夹” entry
 * and waits until its nav row is rendered.
 */
async function createFolderViaSidebar(window: Page, folderName: string) {
  await window.getByRole("button", { name: "添加文件夹" }).click();
  await commitInlineFolderEdit(window, folderName);
  await expect(
    window.getByRole("button", { name: folderName, exact: true }),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Right-clicks the sidebar nav row of a managed folder and returns the open
 * context menu, asserting it is labelled for that exact folder.
 */
async function openFolderContextMenu(window: Page, folderName: string) {
  const row = window.getByRole("button", { name: folderName, exact: true });
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
    await expect(
      window.getByRole("button", { name: "子文件夹", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Import targets the currently selected folder: scope into 子文件夹 and
    // import both files into it.
    await window
      .getByRole("button", { name: "子文件夹", exact: true })
      .click();
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
    const includeSubfolders = window.getByLabel("包含子文件夹");
    await expect(includeSubfolders).toBeVisible();
    await expect(includeSubfolders).not.toBeChecked();
    await expect(parentCard).toHaveCount(0, { timeout: 15_000 });
    await expect(childCard).toHaveCount(0);

    // Explicit switch: include descendants for browse + search.
    await includeSubfolders.check();
    await expect(parentCard).toBeVisible({ timeout: 15_000 });
    await expect(childCard).toBeVisible({ timeout: 15_000 });

    // REQ-FILTER-012: searching while scoped to 父文件夹 with include on
    // recurses into descendant folders.
    await window.getByLabel("搜索资源库").fill("child-note");
    await window.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(
      window.locator(".toast").filter({ hasText: "找到 1 项" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(childCard).toBeVisible({ timeout: 15_000 });
    await expect(parentCard).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
