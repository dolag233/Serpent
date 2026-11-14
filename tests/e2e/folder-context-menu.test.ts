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
  await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
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
 *
 * The new folder only appears as a canvas folder-card in a managed
 * folder/root view — the default "所有资产" scope intentionally has no
 * folder-card row (FOLDER-010; folder-card-selection.test.ts). Wait on the
 * sidebar nav row instead: its label ellipsis-truncates in narrow panes
 * (clipping the text node and breaking an accessible-name match), so target
 * the row via its exact label text.
 */
async function createFolderViaSidebar(window: Page, folderName: string) {
  await window.getByRole("button", { name: "添加文件夹" }).click();
  await commitInlineFolderEdit(window, folderName);
  await expect(sidebarFolderRow(window, folderName)).toBeVisible({
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
  const escapedTitle = folderName.replace(/["\\]/gu, "\\$&");
  return window.locator(
    `.navigation-pane button.nav-row[data-hover-tip="${escapedTitle}"]`,
  );
}

/**
 * Like sidebarFolderRow but matches the label by exact text, so a renamed
 * folder's old name (a substring of the new name, e.g. 原画 ⊂ 角色原画) is
 * asserted gone instead of substring-matching the new row.
 */
function sidebarFolderRowExact(window: Page, folderName: string) {
  return window
    .locator(".navigation-pane .nav-row-label", { hasText: new RegExp(`^${folderName}$`, "u") })
    .locator("xpath=ancestor::button[contains(@class, 'nav-row')]");
}

/**
 * Right-clicks the sidebar nav row of a managed folder and returns the open
 * context menu, asserting it is labelled for that exact folder.
 */
async function openFolderContextMenu(window: Page, folderName: string) {
  const row = sidebarFolderRow(window, folderName);
  await expect(row).toBeVisible();
  await window.mouse.move(0, 0);
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
  await expect(input).toHaveValue(folderName);
  const selection = await input.evaluate((element: HTMLInputElement) => [
    element.selectionStart,
    element.selectionEnd,
  ]);
  expect(selection).toEqual([0, folderName.length]);
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
    // Platform label: macOS Finder vs Windows File Explorer (sidebar-commands).
    await expect(
      menu.getByRole("menuitem", {
        name: process.platform === "darwin" ? "在 Finder 中打开" : "在文件浏览器中打开",
      }),
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
    const parentRow = sidebarFolderRow(window, "父级");
    const parentPadding = await parentRow.evaluate((element) =>
      parseFloat(getComputedStyle(element.closest(".nav-tree-row")!).paddingLeft),
    );
    const editPadding = await editRow.evaluate((element) =>
      parseFloat(getComputedStyle(element.closest(".nav-tree-row")!).paddingLeft),
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
    await expect(window.locator(".workspace-notice")).toContainText("已创建文件夹", {
      timeout: 10_000,
    });

    // The sidebar lists the child nested one level under the parent.
    const childRow = sidebarFolderRow(window, "子级");
    await expect(childRow).toBeVisible({ timeout: 10_000 });
    const childPadding = await childRow.evaluate((element) =>
      parseFloat(getComputedStyle(element.closest(".nav-tree-row")!).paddingLeft),
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

test("restores the default cover only when a folder has a custom cover", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-cover-menu-"),
  );
  const libraryName = "Folder Cover Menu";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(temporaryRoot, "cover.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "封面文件夹");
    let menu = await openFolderContextMenu(window, "封面文件夹");
    await expect(
      menu.getByRole("menuitem", { name: "恢复默认封面", exact: true }),
    ).toHaveCount(0);
    await window.keyboard.press("Escape");

    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    await expect(
      window.locator('[data-asset-id][data-asset-name="cover.png"]'),
    ).toBeVisible({ timeout: 15_000 });

    const { libraryId, folderId, assetId } = await window.evaluate(async () => {
      type Result<T> = { ok: boolean; value?: T; error?: { message?: string } };
      const library = (globalThis as typeof globalThis & {
        serpent: { library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          listFolders(input: { libraryId: string }): Promise<Result<Array<{ folderId: string; name: string }>>>;
          listAssets(input: { libraryId: string; recursive: boolean }): Promise<Result<Array<{ assetId: string }>>>;
        } };
      }).serpent.library;
      const opened = await library.listOpen();
      const libraryId = opened.value?.[0]?.libraryId;
      if (!opened.ok || !libraryId) throw new Error("Expected an open library.");
      const [folders, assets] = await Promise.all([
        library.listFolders({ libraryId }),
        library.listAssets({ libraryId, recursive: true }),
      ]);
      const folderId = folders.value?.find((folder) => folder.name === "封面文件夹")?.folderId;
      const assetId = assets.value?.[0]?.assetId;
      if (!folders.ok || !folderId || !assets.ok || !assetId) {
        throw new Error("Expected a folder and an imported cover asset.");
      }
      return { libraryId, folderId, assetId };
    });

    await window.evaluate(async ({ libraryId, folderId, assetId }) => {
      const api = (globalThis as typeof globalThis & {
        serpent: { library: {
          setFolderCoverFromAsset(input: {
            libraryId: string;
            folderIds: string[];
            assetId: string;
          }): Promise<{ ok: boolean; error?: { message?: string } }>;
        } };
      }).serpent.library;
      const result = await api.setFolderCoverFromAsset({
        libraryId,
        folderIds: [folderId],
        assetId,
      });
      if (!result.ok) throw new Error(result.error?.message ?? "Could not set the custom cover.");
    }, { libraryId, folderId, assetId });

    await window.reload();
    await expect(sidebarFolderRow(window, "封面文件夹")).toBeVisible({ timeout: 10_000 });
    const folderGlyph = sidebarFolderRow(window, "封面文件夹").locator(".nav-entity-glyph");
    await expect(folderGlyph.locator("img")).toHaveCount(0);
    await expect(folderGlyph.locator("svg.icon")).toHaveCount(1);
    menu = await openFolderContextMenu(window, "封面文件夹");
    const restoreItem = menu.getByRole("menuitem", {
      name: "恢复默认封面",
      exact: true,
    });
    await expect(restoreItem).toBeVisible();
    await restoreItem.click();

    await expect.poll(async () => window.evaluate(async (folderId) => {
      const api = (globalThis as typeof globalThis & {
        serpent: { library: {
          listFolderBrowseEntries(input: {
            libraryId: string;
            parentFolderId: string | null;
          }): Promise<{ ok: boolean; value?: Array<{ folderId: string; hasCustomCover?: boolean }> }>;
          listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        } };
      }).serpent.library;
      const opened = await api.listOpen();
      const libraryId = opened.value?.[0]?.libraryId;
      if (!opened.ok || !libraryId) return null;
      const entries = await api.listFolderBrowseEntries({ libraryId, parentFolderId: null });
      return entries.ok
        ? entries.value?.find((entry) => entry.folderId === folderId)?.hasCustomCover ?? false
        : null;
    }, folderId)).toBe(false);

    menu = await openFolderContextMenu(window, "封面文件夹");
    await expect(
      menu.getByRole("menuitem", { name: "恢复默认封面", exact: true }),
    ).toHaveCount(0);
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
    await sidebarFolderRow(window, "原画").click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "原画",
    );
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    const assetCard = window.locator('[data-asset-id][data-asset-name="portrait.png"]');
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    const input = await openFolderRenameInline(window, "原画");
    // The row becomes an input holding the current name with the full name
    // selected, so typing replaces it immediately.
    await expect(window.getByRole("dialog")).toHaveCount(0);
    await expect(input).toHaveValue("原画");
    await expect(input).toBeFocused();
    await input.fill("角色原画");
    await input.press("Enter");

    await expect(window.locator(".nav-inline-edit")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(window.locator(".workspace-notice")).toContainText(
      "已将文件夹重命名为",
      { timeout: 10_000 },
    );

    // The sidebar, the active scope breadcrumb, and the canvas content all
    // follow the rename — the folderId is unchanged, so nothing is lost.
    await expect(
      sidebarFolderRow(window, "角色原画"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      sidebarFolderRowExact(window, "原画"),
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
    await window.getByRole("button", { name: "所有资产", exact: true }).click();
    await expect(assetCard).toBeVisible({ timeout: 10_000 });

    // The canvas caption offers the same inline rename as the sidebar.
    await window.getByRole("button", { name: "资源库根目录" }).click();
    const folderCard = window.locator(".folder-card", { hasText: "角色原画" });
    await expect(folderCard).toBeVisible();
    await folderCard.locator(".folder-card-name").dblclick();
    const cardRenameInput = window.locator(".folder-card-rename-input");
    await expect(cardRenameInput).toBeVisible();
    await expect(cardRenameInput).toBeFocused();
    await cardRenameInput.press("Escape");
    await folderCard.locator(".folder-card-cover").dblclick();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText("角色原画");
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
    // 创建后自动进入新文件夹（产品行为）——回根再建第二个，保证两者同父级。
    await window.getByRole("button", { name: "所有资产", exact: true }).click();
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
      sidebarFolderRow(window, "素材丙"),
    ).toBeVisible({ timeout: 10_000 });
    expect(existsSync(path.join(libraryPath, "Assets", "素材丙"))).toBe(true);
    expect(existsSync(path.join(libraryPath, "Assets", "素材甲"))).toBe(false);
    // The conflicting sibling folder was never touched.
    await expect(
      sidebarFolderRow(window, "素材乙"),
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
      sidebarFolderRow(window, "角色"),
    ).toBeVisible();
    expect(existsSync(path.join(libraryPath, "Assets", "角色"))).toBe(true);
    expect(existsSync(path.join(libraryPath, "Assets", "a"))).toBe(false);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5 — Nested create from the folder menu; Escape cancels; blur commits.
// Section 「+」 always creates at the library root (Serpent-186547).
// ---------------------------------------------------------------------------

test("creates a nested folder from the context menu, cancels with Escape, and commits on blur", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-folder-plus-"));
  const libraryName = "Folder Plus Inline";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "父级");

    await sidebarFolderRow(window, "父级").click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "父级",
    );
    // Give the parent a disclosure control, then collapse it. Starting a
    // second create must reveal the inline row without losing the persisted
    // collapse preference when that create is cancelled.
    const menu = await openFolderContextMenu(window, "父级");
    await menu.getByRole("menuitem", { name: "新建子文件夹", exact: true }).click();
    const editRow = window.locator(".nav-inline-edit");
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await editRow.locator("input").fill("已有子级");
    await window.locator(".workspace").click();
    await expect(
      sidebarFolderRow(window, "已有子级"),
    ).toBeVisible({ timeout: 10_000 });
    await window.getByRole("button", { name: "折叠 父级" }).click();
    await expect(
      sidebarFolderRow(window, "已有子级"),
    ).toHaveCount(0);

    // 创建「已有子级」后自动进入子级；折叠后显式回到父级，再从菜单新建子文件夹。
    await sidebarFolderRow(window, "父级").click();
    const nestedMenu = await openFolderContextMenu(window, "父级");
    await nestedMenu.getByRole("menuitem", { name: "新建子文件夹", exact: true }).click();

    // The pending row nests under the selected folder, not at the root.
    // Depth lives on .nav-tree-row; the edit control's own padding is constant.
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    const parentPadding = await sidebarFolderRow(window, "父级").evaluate(
      (element) =>
        parseFloat(getComputedStyle(element.closest(".nav-tree-row")!).paddingLeft),
    );
    const editPadding = await editRow.evaluate((element) =>
      parseFloat(getComputedStyle(element.closest(".nav-tree-row")!).paddingLeft),
    );
    expect(editPadding).toBe(parentPadding + 14);

    // Escape removes the pending row without creating anything.
    const input = editRow.locator("input");
    await input.press("Escape");
    await expect(editRow).toHaveCount(0, { timeout: 5_000 });
    await expect(
      sidebarFolderRow(window, "已有子级"),
    ).toHaveCount(0);
    expect(existsSync(path.join(libraryPath, "Assets", "父级", "新建文件夹"))).toBe(
      false,
    );

    // Blank blur resolves as cancellation and must not change the original
    // persisted collapsed preference. Nested creates come from the parent
    // menu; the section 「+」 always lands at the library root.
    const blankMenu = await openFolderContextMenu(window, "父级");
    await blankMenu.getByRole("menuitem", { name: "新建子文件夹", exact: true }).click();
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await input.fill("");
    await window.locator(".workspace").click();
    await expect(editRow).toHaveCount(0, { timeout: 5_000 });
    await expect(
      sidebarFolderRow(window, "已有子级"),
    ).toHaveCount(0);

    // A rejected create keeps the editor visible. Cancelling it afterwards
    // must likewise restore the collapsed view instead of persisting the
    // temporary reveal used to show the inline row.
    const conflictMenu = await openFolderContextMenu(window, "父级");
    await conflictMenu.getByRole("menuitem", { name: "新建子文件夹", exact: true }).click();
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await input.fill("已有子级");
    await window.locator(".workspace").click();
    await expect(editRow.locator(".nav-inline-edit-error")).toBeVisible({
      timeout: 10_000,
    });
    await input.press("Escape");
    await expect(editRow).toHaveCount(0, { timeout: 5_000 });
    await expect(
      sidebarFolderRow(window, "已有子级"),
    ).toHaveCount(0);

    // Blur with a valid name commits: clicking away creates the folder.
    const commitMenu = await openFolderContextMenu(window, "父级");
    await commitMenu.getByRole("menuitem", { name: "新建子文件夹", exact: true }).click();
    await expect(editRow).toBeVisible({ timeout: 5_000 });
    await input.fill("子级");
    await window.locator(".workspace").click();
    await expect(editRow).toHaveCount(0, { timeout: 10_000 });
    await expect(window.locator(".workspace-notice")).toContainText("已创建文件夹", {
      timeout: 10_000,
    });
    await expect(
      sidebarFolderRow(window, "子级"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      sidebarFolderRow(window, "已有子级"),
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
