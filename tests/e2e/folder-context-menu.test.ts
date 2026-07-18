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
 * Fills the open inline folder edit row and commits with Enter, then waits
 * for the row to leave edit mode (REQ-FOLDER-007: folder create/rename is
 * in-tree inline editing; the dialogs no longer exist).
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

/**
 * Turns a folder's nav row into the inline rename row from the context menu
 * and returns the focused input.
 */
async function openFolderRenameInline(window: Page, folderName: string) {
  const menu = await openFolderContextMenu(window, folderName);
  await menu.getByRole("menuitem", { name: "重命名…" }).click();
  const input = window.locator(".nav-inline-edit input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  return input;
}

/**
 * Ordered markers of the sidebar folder rows: nav rows by their text, the
 * inline edit row as "__edit__".
 */
async function folderRowOrder(window: Page) {
  return window.locator(".navigation-pane").evaluate((pane) =>
    Array.from(
      pane.querySelectorAll("button.nav-row, div.nav-inline-edit"),
    ).map((row) =>
      row.classList.contains("nav-inline-edit")
        ? "__edit__"
        : (row.textContent ?? ""),
    ),
  );
}

// ---------------------------------------------------------------------------
// Test 1 — 新建子文件夹 inserts a pending edit row as the first child
// ---------------------------------------------------------------------------

test("creates a nested subfolder inline from the folder context menu", async () => {
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
    // REQ-MENU-006: the folder shell actions sit in the same menu.
    await expect(
      menu.getByRole("menuitem", { name: "在 Finder 中打开" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "复制文件夹路径" }),
    ).toBeVisible();
    await menu.getByRole("menuitem", { name: "新建子文件夹" }).click();

    // No dialog opens: the pending name-edit row appears inside the tree,
    // focused with the default name ready to replace.
    await expect(window.getByRole("dialog")).toHaveCount(0);
    const editRow = window.locator(".nav-inline-edit");
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    const input = editRow.locator("input");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("新建文件夹");

    // The pending row is the right-clicked folder's first child: rendered
    // directly after it and indented by exactly one depth step.
    const parentRow = window.getByRole("button", { name: "父级", exact: true });
    const parentPadding = await parentRow.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingLeft),
    );
    const editPadding = await editRow.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingLeft),
    );
    expect(editPadding).toBe(parentPadding + 14);
    const pendingOrder = await folderRowOrder(window);
    const parentIndex = pendingOrder.findIndex((text) =>
      text.includes("父级"),
    );
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(pendingOrder[parentIndex + 1]).toBe("__edit__");

    // Enter commits through the unchanged folder.create command chain.
    await input.fill("子级");
    await input.press("Enter");
    await expect(editRow).toHaveCount(0, { timeout: 10_000 });
    await expect(window.locator(".toast")).toContainText("已创建文件夹", {
      timeout: 10_000,
    });

    // The sidebar lists the child nested one level under the parent.
    const childRow = window.getByRole("button", { name: "子级", exact: true });
    await expect(childRow).toBeVisible({ timeout: 10_000 });
    const childPadding = await childRow.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingLeft),
    );
    expect(childPadding).toBe(parentPadding + 14);
    const navOrder = await folderRowOrder(window);
    const childIndex = navOrder.findIndex((text) => text.includes("子级"));
    expect(childIndex).toBeGreaterThan(
      navOrder.findIndex((text) => text.includes("父级")),
    );

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
// Test 2 — 重命名… edits the row in place and keeps content
// ---------------------------------------------------------------------------

test("renames a folder inline from the context menu and keeps its assets visible", async () => {
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

    const input = await openFolderRenameInline(window, "原画");
    // The row becomes an input holding the current name, focused and fully
    // preselected so typing replaces it.
    await expect(window.getByRole("dialog")).toHaveCount(0);
    await expect(input).toHaveValue("原画");
    await expect(input).toBeFocused();
    const selection = await input.evaluate((element: HTMLInputElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]);
    expect(selection).toEqual([0, "原画".length]);

    await input.fill("角色原画");
    await input.press("Enter");

    await expect(window.locator(".nav-inline-edit")).toHaveCount(0, {
      timeout: 10_000,
    });
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
// Test 3 — Sibling-name conflict renders inline under the row; retry works
// ---------------------------------------------------------------------------

test("keeps the inline rename row open with an inline conflict error and allows retry", async () => {
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

    const input = await openFolderRenameInline(window, "素材甲");
    await expect(input).toHaveValue("素材甲");
    await input.fill("素材乙");
    await input.press("Enter");

    // Conflict: the typed error renders under the row and the row stays open.
    await expect(window.locator(".nav-inline-edit-error")).toContainText(
      "已存在同名文件夹或文件。",
      { timeout: 10_000 },
    );
    await expect(input).toBeVisible();
    expect(existsSync(path.join(libraryPath, "Assets", "素材甲"))).toBe(true);

    // Fix the name and retry: succeeds and closes the edit row.
    await input.fill("素材丙");
    await input.press("Enter");
    await expect(window.locator(".nav-inline-edit")).toHaveCount(0, {
      timeout: 10_000,
    });
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
// Test 4 — Illegal names show the invalid-name reason inline; Esc cancels
// ---------------------------------------------------------------------------

test("shows inline invalid-name errors for illegal folder names and cancels with Escape", async () => {
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

    const input = await openFolderRenameInline(window, "角色");
    await expect(input).toHaveValue("角色");

    // A path separator is rejected inline and the row stays open.
    await input.fill("a/b");
    await input.press("Enter");
    await expect(window.locator(".nav-inline-edit-error")).toContainText(
      "名称包含不支持的字符。",
      { timeout: 10_000 },
    );
    await expect(input).toBeVisible();

    // A Windows-forbidden character is rejected the same way.
    await input.fill("坏?名");
    await input.press("Enter");
    await expect(window.locator(".nav-inline-edit-error")).toContainText(
      "名称包含不支持的字符。",
      { timeout: 10_000 },
    );
    await expect(input).toBeVisible();

    // Escape cancels without renaming anything; the row returns to normal.
    await input.press("Escape");
    await expect(window.locator(".nav-inline-edit")).toHaveCount(0, {
      timeout: 5_000,
    });
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

// ---------------------------------------------------------------------------
// Test 5 — Sidebar 「+」 lands at the selected folder; Escape cancels; blur
// commits
// ---------------------------------------------------------------------------

test("creates under the selected folder from the sidebar plus entry, cancels with Escape, commits on blur", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-folder-plus-"));
  const libraryName = "Folder Plus Inline";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "父级");

    // Select 父级: the 「+」 entry targets the currently selected location.
    await window.getByRole("button", { name: "父级", exact: true }).click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "父级",
    );
    // Give the parent a disclosure control, then collapse it. Starting a
    // second create must reveal the inline row without losing the persisted
    // collapse preference when that create is cancelled.
    await window.getByRole("button", { name: "添加文件夹" }).click();
    const editRow = window.locator(".nav-inline-edit");
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await editRow.locator("input").fill("已有子级");
    await window.locator(".workspace").click();
    await expect(
      window.getByRole("button", { name: "已有子级", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await window.getByRole("button", { name: "折叠 父级" }).click();
    await expect(
      window.getByRole("button", { name: "已有子级", exact: true }),
    ).toHaveCount(0);

    await window.getByRole("button", { name: "添加文件夹" }).click();

    // The pending row nests under the selected folder, not at the root.
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    const parentPadding = await window
      .getByRole("button", { name: "父级", exact: true })
      .evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
    const editPadding = await editRow.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingLeft),
    );
    expect(editPadding).toBe(parentPadding + 14);

    // Escape removes the pending row without creating anything.
    const input = editRow.locator("input");
    await input.press("Escape");
    await expect(editRow).toHaveCount(0, { timeout: 5_000 });
    await expect(
      window.getByRole("button", { name: "已有子级", exact: true }),
    ).toHaveCount(0);
    expect(existsSync(path.join(libraryPath, "Assets", "父级", "新建文件夹"))).toBe(
      false,
    );

    // Blank blur resolves as cancellation and must not change the original
    // persisted collapsed preference.
    await window.getByRole("button", { name: "添加文件夹" }).click();
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await input.fill("");
    await window.locator(".workspace").click();
    await expect(editRow).toHaveCount(0, { timeout: 5_000 });
    await expect(
      window.getByRole("button", { name: "已有子级", exact: true }),
    ).toHaveCount(0);

    // A rejected create keeps the editor visible. Cancelling it afterwards
    // must likewise restore the collapsed view instead of persisting the
    // temporary reveal used to show the inline row.
    await window.getByRole("button", { name: "添加文件夹" }).click();
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await input.fill("已有子级");
    await window.locator(".workspace").click();
    await expect(editRow.locator(".nav-inline-edit-error")).toBeVisible({
      timeout: 10_000,
    });
    await input.press("Escape");
    await expect(editRow).toHaveCount(0, { timeout: 5_000 });
    await expect(
      window.getByRole("button", { name: "已有子级", exact: true }),
    ).toHaveCount(0);

    // Blur with a valid name commits: clicking away creates the folder.
    await window.getByRole("button", { name: "添加文件夹" }).click();
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await input.fill("子级");
    await window.locator(".workspace").click();
    await expect(editRow).toHaveCount(0, { timeout: 10_000 });
    await expect(window.locator(".toast")).toContainText("已创建文件夹", {
      timeout: 10_000,
    });
    await expect(
      window.getByRole("button", { name: "子级", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      window.getByRole("button", { name: "已有子级", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      window.getByRole("button", { name: "折叠 父级" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(existsSync(path.join(libraryPath, "Assets", "父级", "子级"))).toBe(
      true,
    );
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
