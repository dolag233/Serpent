import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  resolveElectronExecutablePath,
} from "./electron-test-helpers";

// ---------------------------------------------------------------------------
// Serpent-b8a853 include-subfolders pulse hint + Serpent-f74e48 folder search
// results. Both features are renderer-only and verified here with the same
// library/folder helpers as folder-recursive-scope.test.ts. Search-result
// folder cards reuse the ordinary folder-card-row; their cover thumbnails are
// verified deterministically at the worker level (folderEntriesByRefs in
// tests/worker/folder-browse-entries.test.ts) — a tiny PNG is source-direct
// and never produces a cover artifact, so asserting an <img> here would be
// timing-flaky. The real preview is a human/visual check.
// ---------------------------------------------------------------------------

test.describe.configure({ timeout: 120_000 });

function launchApp(temporaryRoot: string, libraryPath: string) {
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
    },
  });
}

async function createLibrary(window: Page, libraryName: string) {
  await window.getByRole("button", { name: "创建资源库" }).click();
  await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
  await window.getByRole("button", { name: "创建", exact: true }).click();
}

async function commitInlineFolderEdit(window: Page, folderName: string) {
  const input = window.locator(".nav-inline-edit input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill(folderName);
  await input.press("Enter");
  await expect(window.locator(".nav-inline-edit")).toHaveCount(0, {
    timeout: 10_000,
  });
}

function sidebarFolderRow(window: Page, folderName: string) {
  return window
    .locator(".navigation-pane .nav-row-label", { hasText: folderName })
    .locator("xpath=ancestor::button[contains(@class, 'nav-row')]");
}

async function createFolderViaSidebar(window: Page, folderName: string) {
  await window.getByRole("button", { name: "添加文件夹" }).click();
  await commitInlineFolderEdit(window, folderName);
  await expect(sidebarFolderRow(window, folderName)).toBeVisible({
    timeout: 10_000,
  });
}

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

test("include-subfolders hint pulses until the folder is expanded once", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-hint-e2e-"),
  );
  const libraryName = "提示验收";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "父文件夹");

    // 父文件夹 gets two child folders and no direct assets → hint-qualifying.
    for (const childName of ["子文件夹甲", "子文件夹乙"]) {
      const menu = await openFolderContextMenu(window, "父文件夹");
      await menu.getByRole("menuitem", { name: "新建子文件夹" }).click();
      await commitInlineFolderEdit(window, childName);
      await expect(sidebarFolderRow(window, childName)).toBeVisible({
        timeout: 10_000,
      });
    }

    await sidebarFolderRow(window, "父文件夹").click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "父文件夹",
    );

    const includeButton = window.getByRole("button", {
      name: "包含子文件夹",
    });
    await expect(includeButton).toBeVisible();
    const hintButton = window.locator(
      ".workspace-include-subfolders.is-feature-hinting",
    );
    await expect(hintButton).toBeVisible({ timeout: 5_000 });

    // The pulse keeps breathing (infinite animation): still visible after a
    // full cycle instead of a one-shot 1.6s flash.
    await window.waitForTimeout(1_800);
    await expect(hintButton).toBeVisible({ timeout: 5_000 });

    // Enabling recursive once dismisses the hint forever.
    await includeButton.click();
    await expect(hintButton).toHaveCount(0, { timeout: 5_000 });

    // Even toggling recursive back off must not resurrect it (once expanded,
    // never again).
    await includeButton.click();
    await expect(hintButton).toHaveCount(0, { timeout: 5_000 });

    // Re-entering the same folder never pulses again (dismissed persisted).
    await sidebarFolderRow(window, "子文件夹甲").click();
    await sidebarFolderRow(window, "父文件夹").click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "父文件夹",
    );
    await expect(hintButton).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("text search shows matching folders as the ordinary folder-card-row and navigates on click", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-search-e2e-"),
  );
  const libraryName = "搜索文件夹验收";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "父文件夹");
    await createFolderViaSidebar(window, "配色参考");

    const searchBox = window.getByLabel("搜索资源库");
    await searchBox.fill("配色");
    await expect(searchBox).toBeVisible();

    // Matched folders appear as the SAME folder-card-row the asset browser
    // uses during normal browsing — no bespoke result section.
    const folderRow = window.locator(".folder-card-row");
    await expect(folderRow).toBeVisible({ timeout: 5_000 });
    const folderResult = folderRow.locator(".folder-card", {
      hasText: "配色参考",
    });
    await expect(folderResult).toBeVisible({ timeout: 5_000 });

    // A click on the result enters the folder (chooseFolder resets the search).
    await folderResult.click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "配色参考",
    );
    // 配色参考 has no children → the ordinary folder-card-row is hidden again.
    await expect(window.locator(".folder-card-row")).toHaveCount(0, {
      timeout: 5_000,
    });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("hovering a highlighted affordance for half a second dismisses it", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-folder-hover-hint-e2e-"),
  );
  const libraryName = "悬停提示验收";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolderViaSidebar(window, "父文件夹");
    const menu = await openFolderContextMenu(window, "父文件夹");
    await menu.getByRole("menuitem", { name: "新建子文件夹" }).click();
    await commitInlineFolderEdit(window, "子文件夹");
    await expect(sidebarFolderRow(window, "子文件夹")).toBeVisible({
      timeout: 10_000,
    });

    await sidebarFolderRow(window, "父文件夹").click();
    const hintButton = window.locator(
      ".workspace-include-subfolders.is-feature-hinting",
    );
    await expect(hintButton).toBeVisible({ timeout: 5_000 });

    // Hover >0.5s dismisses the highlight permanently (shared rule).
    await hintButton.hover();
    await window.waitForTimeout(700);
    await expect(hintButton).toHaveCount(0, { timeout: 5_000 });

    // Re-entering never pulses again.
    await sidebarFolderRow(window, "子文件夹").click();
    await sidebarFolderRow(window, "父文件夹").click();
    await expect(hintButton).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("linked-folder entry pulses after adding a normal folder and is dismissed by hover", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-linked-hint-e2e-"),
  );
  const libraryName = "链接提示验收";
  const libraryPath = path.join(temporaryRoot, libraryName);

  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);

    const linkedButton = window.getByRole("button", {
      name: "导入链接文件夹",
    });
    await expect(linkedButton).toBeVisible();
    // No linked folders in this library, and the hint is not shown yet.
    await expect(window.locator(".tiny-action.is-feature-hinting")).toHaveCount(
      0,
      { timeout: 5_000 },
    );

    // Adding an ordinary folder pulses the linked-folder entry.
    await createFolderViaSidebar(window, "普通文件夹");
    const hintButton = window.locator(".tiny-action.is-feature-hinting");
    await expect(hintButton).toBeVisible({ timeout: 5_000 });

    // Hovering the linked-folder entry >0.5s dismisses it for good.
    await linkedButton.hover();
    await window.waitForTimeout(700);
    await expect(hintButton).toHaveCount(0, { timeout: 5_000 });

    // Adding another ordinary folder must not re-show the hint.
    await createFolderViaSidebar(window, "第二个文件夹");
    await expect(hintButton).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});