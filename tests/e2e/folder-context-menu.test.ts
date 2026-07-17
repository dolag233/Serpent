import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function launchApp(temporaryRoot: string, libraryPath: string, importFiles?: string) {
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
      ...(importFiles ? { SERPENT_E2E_IMPORT_FILES: importFiles } : {}),
    },
  });
}

async function createLibrary(window: Page, libraryName: string) {
  await window.getByRole("button", { name: "创建资源库" }).click();
  await window.getByLabel("名称").fill(libraryName);
  await window.getByRole("button", { name: "创建", exact: true }).click();
}

/**
 * Creates a root-level managed folder through the sidebar “添加文件夹” entry
 * and waits until its nav row is rendered.
 */
async function createFolderViaSidebar(window: Page, folderName: string) {
  await window.getByRole("button", { name: "添加文件夹" }).click();
  const dialog = window.getByRole("dialog");
  await dialog.getByLabel("名称").fill(folderName);
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
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

/**
 * Opens the folder rename dialog from the sidebar context menu, mirroring the
 * asset rename helper in asset-rename.test.ts.
 */
async function openFolderRenameDialog(window: Page, folderName: string) {
  const menu = await openFolderContextMenu(window, folderName);
  await menu.getByRole("menuitem", { name: "重命名…" }).click();
  const dialog = window.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "重命名文件夹" }),
  ).toBeVisible({ timeout: 5_000 });
  return dialog;
}

// ---------------------------------------------------------------------------
// Test 1 — 新建子文件夹 from the context menu nests a real directory
// ---------------------------------------------------------------------------

test("creates a nested subfolder from the folder context menu with the parent hint", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-folder-sub-"));
  const libraryName = "Folder Menu Sub";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "父级");

    const menu = await openFolderContextMenu(window, "父级");
    await expect(
      menu.getByRole("menuitem", { name: "新建子文件夹" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "重命名…" }),
    ).toBeVisible();
    await menu.getByRole("menuitem", { name: "新建子文件夹" }).click();

    // The create dialog opens in the subfolder flow: empty name field, and the
    // destination hint line names the right-clicked parent folder.
    const dialog = window.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "新建文件夹" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator("p.field-help")).toHaveText(
      '将在"父级"内创建真实目录。',
    );
    const input = dialog.locator("input#dialog-name");
    await expect(input).toHaveValue("");

    await input.fill("子级");
    await dialog.getByRole("button", { name: "创建", exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(window.locator(".toast")).toContainText("已创建文件夹", {
      timeout: 10_000,
    });

    // The sidebar lists the child nested one level under the right-clicked
    // parent: rendered after it and indented by exactly one depth step.
    const parentRow = window.getByRole("button", { name: "父级", exact: true });
    const childRow = window.getByRole("button", { name: "子级", exact: true });
    await expect(childRow).toBeVisible({ timeout: 10_000 });
    const parentPadding = await parentRow.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingLeft),
    );
    const childPadding = await childRow.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingLeft),
    );
    expect(childPadding).toBe(parentPadding + 14);
    const navOrder = await window
      .locator(".navigation-pane")
      .evaluate((pane) =>
        Array.from(pane.querySelectorAll("button.nav-row")).map(
          (row) => row.textContent ?? "",
        ),
      );
    const parentIndex = navOrder.findIndex((text) => text.includes("父级"));
    const childIndex = navOrder.findIndex((text) => text.includes("子级"));
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(childIndex).toBeGreaterThan(parentIndex);

    // The real nested directory was created on disk.
    expect(existsSync(path.join(libraryPath, "Assets", "父级", "子级"))).toBe(
      true,
    );
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — 重命名… renames the folder, the real directory, and keeps content
// ---------------------------------------------------------------------------

test("renames a folder from the context menu and keeps its assets visible", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-rename-"),
  );
  const libraryName = "Folder Menu Rename";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(temporaryRoot, "portrait.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "原画");

    // Enter the folder scope and import into it (import targets the selected
    // folder), so the rename has real content to carry over.
    await window.getByRole("button", { name: "原画", exact: true }).click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "原画",
    );
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    const assetCard = window.locator('[data-asset-id][title="portrait.png"]');
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    const dialog = await openFolderRenameDialog(window, "原画");
    // The editable field holds the current name, focused and preselected.
    const input = dialog.locator("input#rename-folder-name");
    await expect(input).toHaveValue("原画");
    await expect(input).toBeFocused();

    await input.fill("角色原画");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(window.locator(".toast")).toContainText(
      "已将文件夹重命名为",
      { timeout: 10_000 },
    );

    // The sidebar, the active scope breadcrumb, and the canvas content all
    // follow the rename — the folderId is unchanged, so nothing is lost.
    await expect(
      window.getByRole("button", { name: "角色原画", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      window.getByRole("button", { name: "原画", exact: true }),
    ).toHaveCount(0);
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "角色原画",
    );
    await expect(assetCard).toBeVisible({ timeout: 10_000 });

    // The real directory was renamed on disk and the asset file moved with it.
    expect(
      existsSync(path.join(libraryPath, "Assets", "角色原画", "portrait.png")),
    ).toBe(true);
    expect(existsSync(path.join(libraryPath, "Assets", "原画"))).toBe(false);

    // The asset is still listed from the all-assets (DB) view as well.
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(assetCard).toBeVisible({ timeout: 10_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — Sibling-name conflict keeps the dialog open; fixing the name works
// ---------------------------------------------------------------------------

test("keeps the folder rename dialog open with an inline conflict error and allows retry", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-conflict-"),
  );
  const libraryName = "Folder Menu Conflict";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "素材甲");
    await createFolderViaSidebar(window, "素材乙");

    const dialog = await openFolderRenameDialog(window, "素材甲");
    const input = dialog.locator("input#rename-folder-name");
    await expect(input).toHaveValue("素材甲");
    await input.fill("素材乙");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();

    // Conflict: the typed error is shown inline and the dialog stays open.
    await expect(dialog.locator(".inline-error")).toContainText(
      "已存在同名文件夹或文件。",
      { timeout: 10_000 },
    );
    await expect(
      dialog.getByRole("heading", { name: "重命名文件夹" }),
    ).toBeVisible();
    expect(existsSync(path.join(libraryPath, "Assets", "素材甲"))).toBe(true);

    // Fix the name and retry: succeeds and closes the dialog.
    await input.fill("素材丙");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(
      window.getByRole("button", { name: "素材丙", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    expect(existsSync(path.join(libraryPath, "Assets", "素材丙"))).toBe(true);
    expect(existsSync(path.join(libraryPath, "Assets", "素材甲"))).toBe(false);
    // The conflicting sibling folder was never touched.
    await expect(
      window.getByRole("button", { name: "素材乙", exact: true }),
    ).toBeVisible();
    expect(existsSync(path.join(libraryPath, "Assets", "素材乙"))).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4 — Illegal names show the invalid-name reason inline; 取消 closes
// ---------------------------------------------------------------------------

test("shows an inline invalid-name error for illegal folder names and closes on 取消", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-invalid-"),
  );
  const libraryName = "Folder Menu Invalid";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "角色");

    const dialog = await openFolderRenameDialog(window, "角色");
    const input = dialog.locator("input#rename-folder-name");
    await expect(input).toHaveValue("角色");

    // A path separator is rejected inline and the dialog stays open.
    await input.fill("a/b");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();
    await expect(dialog.locator(".inline-error")).toContainText(
      "名称包含不支持的字符。",
      { timeout: 10_000 },
    );
    await expect(
      dialog.getByRole("heading", { name: "重命名文件夹" }),
    ).toBeVisible();

    // A Windows-forbidden character is rejected the same way.
    await input.fill("坏?名");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();
    await expect(dialog.locator(".inline-error")).toContainText(
      "名称包含不支持的字符。",
      { timeout: 10_000 },
    );
    await expect(
      dialog.getByRole("heading", { name: "重命名文件夹" }),
    ).toBeVisible();

    // 取消 closes without renaming anything.
    await dialog
      .locator(".dialog-actions")
      .getByRole("button", { name: "取消" })
      .click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    await expect(
      window.getByRole("button", { name: "角色", exact: true }),
    ).toBeVisible();
    expect(existsSync(path.join(libraryPath, "Assets", "角色"))).toBe(true);
    expect(existsSync(path.join(libraryPath, "Assets", "a"))).toBe(false);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
