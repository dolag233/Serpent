import { _electron as electron, expect, test, type Page } from "@playwright/test";

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

function launchApp(
  temporaryRoot: string,
  libraryPath: string,
  importFiles?: string,
) {
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

function collectionRow(window: Page, name: string) {
  const escapedName = name.replace(/["\\]/gu, "\\$&");
  return window.locator(
    `.navigation-pane button.nav-row[data-nav-collection-id][title="${escapedName}"]`,
  );
}

function folderRow(window: Page, name: string) {
  const escapedName = name.replace(/["\\]/gu, "\\$&");
  return window.locator(
    `.navigation-pane button.nav-row[data-nav-folder-kind="managed"][title="${escapedName}"]`,
  );
}

async function createLibrary(window: Page, name: string) {
  await window.getByRole("button", { name: "创建资源库" }).click();
  await window.getByRole("textbox", { name: "名称" }).fill(name);
  await window.getByRole("button", { name: "创建", exact: true }).click();
}

async function createCollection(
  window: Page,
  name: string,
  parentName?: string,
) {
  if (parentName) await collectionRow(window, parentName).click();
  await window.getByRole("button", { name: "添加合集" }).click();
  const input = window.getByPlaceholder("新建合集");
  await input.fill(name);
  await input.press("Enter");
  await expect(collectionRow(window, name)).toBeVisible();
}

async function createFolder(window: Page, name: string, parentName?: string) {
  if (parentName) await folderRow(window, parentName).click();
  await window.getByRole("button", { name: "添加文件夹" }).click();
  const input = window.locator(".nav-inline-edit input");
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
  await expect(folderRow(window, name)).toBeVisible();
}

async function renameCollection(window: Page, oldName: string, newName: string) {
  const row = collectionRow(window, oldName);
  await row.click({ button: "right" });
  const menu = window.getByRole("menu", {
    name: `合集操作：${oldName}`,
    exact: true,
  });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "重命名合集" }).click();
  const input = window.locator(".nav-inline-edit input");
  await expect(input).toBeVisible();
  await input.fill(newName);
  await input.press("Enter");
  await expect(window.locator(".nav-inline-edit")).toHaveCount(0);
  await expect(window.locator(".workspace-notice")).toContainText(
    "合集已重命名",
  );
}

async function renameFolder(window: Page, oldName: string, newName: string) {
  await folderRow(window, oldName).click({ button: "right" });
  const menu = window.getByRole("menu", {
    name: `文件夹操作：${oldName}`,
    exact: true,
  });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "重命名…" }).click();
  const input = window.locator(".nav-inline-edit input");
  await expect(input).toBeVisible();
  await input.fill(newName);
  await input.press("Enter");
  await expect(window.locator(".nav-inline-edit")).toHaveCount(0);
  await expect(window.locator(".workspace-notice")).toContainText(
    "已将文件夹重命名为",
  );
}

test("renames a parent collection and parent folder without losing children", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-hierarchy-rename-"),
  );
  const libraryName = "Hierarchy Rename";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);

    await createCollection(window, "合集A");
    await createCollection(window, "合集B", "合集A");
    await renameCollection(window, "合集A", "合集A-重命名");
    await expect(collectionRow(window, "合集B")).toBeVisible();

    const organization = await window.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          serpent: {
            library: {
              listOpen(): Promise<{
                ok: boolean;
                value?: Array<{ libraryId: string }>;
              }>;
              listCollections(input: {
                libraryId: string;
              }): Promise<{
                ok: boolean;
                value?: Array<{
                  collectionId: string;
                  parentId: string | null;
                  name: string;
                }>;
              }>;
            };
          };
        }
      ).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!open.ok || !libraryId) throw new Error("No open library");
      const result = await api.listCollections({ libraryId });
      if (!result.ok || !result.value) throw new Error("Collections unavailable");
      const parent = result.value.find((item) => item.name === "合集A-重命名");
      const child = result.value.find((item) => item.name === "合集B");
      return {
        parentId: parent?.collectionId,
        childParentId: child?.parentId,
      };
    });
    expect(organization.parentId).toBeTruthy();
    expect(organization.childParentId).toBe(organization.parentId);

    await createFolder(window, "文件夹A");
    await createFolder(window, "文件夹B", "文件夹A");
    await renameFolder(window, "文件夹A", "文件夹A-重命名");
    await expect(folderRow(window, "文件夹B")).toBeVisible();
    expect(
      existsSync(path.join(libraryPath, "Assets", "文件夹A-重命名", "文件夹B")),
    ).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("drops an asset into a nested collection and persists membership", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-nested-collection-drop-"),
  );
  const libraryName = "Nested Collection Drop";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(sourceRoot);
  const sourcePath = path.join(sourceRoot, "nested-drop.txt");
  writeFileSync(sourcePath, "nested drop");
  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createCollection(window, "合集A");
    await createCollection(window, "子合集B", "合集A");
    await window.getByRole("button", { name: /所有资产/ }).click();
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const sourceAsset = window.locator(
      '.asset-card[title="nested-drop.txt"]',
    );
    await expect(sourceAsset).toBeVisible({ timeout: 15_000 });

    const child = collectionRow(window, "子合集B");
    await expect(child).toBeVisible();
    await sourceAsset.dragTo(child);
    await expect(window.locator(".workspace-notice")).toContainText(
      "加入合集",
      { timeout: 15_000 },
    );

    await child.click();
    await expect(window.locator(".scope-crumb-label.is-current")).toContainText(
      "子合集B",
    );
    await expect(
      window.locator('.asset-card[title="nested-drop.txt"]'),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
