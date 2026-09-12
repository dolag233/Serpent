import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  importFilesThroughBridge,
  resolveElectronExecutablePath,
} from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

function launchApp(temporaryRoot: string, libraryPath: string, importFile: string) {
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
      SERPENT_E2E_IMPORT_FILES: importFile,
    },
  });
}

async function createLibrary(window: Page, name: string) {
  await window.getByRole("button", { name: "创建资源库" }).click();
  await window.getByRole("textbox", { name: "名称" }).fill(name);
  await window.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    window.getByRole("button", { name: `当前资源库 ${name}` }),
  ).toBeVisible({ timeout: 15_000 });
}

function folderRow(window: Page, name: string) {
  const escapedName = name.replace(/["\\]/gu, "\\$&");
  return window.locator(
    `.navigation-pane button.nav-row[data-nav-folder-kind="managed"][title="${escapedName}"]`,
  );
}

function collectionRow(window: Page, name: string) {
  const escapedName = name.replace(/["\\]/gu, "\\$&");
  return window.locator(
    `.navigation-pane button.nav-row[data-nav-collection-id][title="${escapedName}"]`,
  );
}

async function createFolder(window: Page, name: string) {
  await window.getByRole("button", { name: "添加文件夹" }).click();
  const input = window.locator(".nav-inline-edit input");
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
  await expect(folderRow(window, name)).toBeVisible({ timeout: 10_000 });
}

async function createCollection(window: Page, name: string) {
  await window.getByRole("button", { name: "添加合集" }).click();
  const input = window.getByPlaceholder("新建合集");
  await input.fill(name);
  await input.press("Enter");
  await expect(collectionRow(window, name)).toBeVisible({ timeout: 10_000 });
}

async function createScrollableRoot(window: Page, count: number) {
  await window.evaluate(async (folderCount) => {
    interface Result<T> {
      ok: boolean;
      value?: T;
      error?: { message?: string };
    }
    type LibraryApi = {
      listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
      createFolder(input: {
        libraryId: string;
        name: string;
      }): Promise<Result<unknown>>;
    };
    const api = (
      globalThis as typeof globalThis & {
        serpent: { library: LibraryApi };
      }
    ).serpent.library;
    const opened = await api.listOpen();
    const libraryId = opened.value?.[0]?.libraryId;
    if (!opened.ok || !libraryId) throw new Error("Expected an open library.");
    for (let index = 0; index < folderCount; index += 1) {
      const result = await api.createFolder({
        libraryId,
        name: `滚动夹${String(index + 1).padStart(2, "0")}`,
      });
      if (!result.ok) {
        throw new Error(result.error?.message ?? "Could not create scroll fixture.");
      }
    }
  }, count);
  await window.getByRole("button", { name: "刷新磁盘变化" }).click();
}

test("keeps navigation inside explicit tabs and exposes contextual tab actions", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-workspace-tabs-"));
  const libraryName = "标签页验收库";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceAsset = path.join(temporaryRoot, "blue metal.txt");
  writeFileSync(sourceAsset, "workspace tab selection fixture", "utf8");
  const application = await launchApp(temporaryRoot, libraryPath, sourceAsset);
  const childProcess = application.process();

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolder(window, "角色原画");
    await importFilesThroughBridge(window, "角色原画");
    const searchedAsset = window.locator('.asset-card[title="blue metal.txt"]');
    await expect(searchedAsset).toBeVisible({ timeout: 15_000 });
    await createCollection(window, "灵感合集");
    await createScrollableRoot(window, 36);

    await window
      .locator(".navigation-pane button.nav-row")
      .filter({ hasText: "所有资产" })
      .first()
      .click();

    const tablist = window.getByRole("tablist", { name: "工作区标签页" });
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAccessibleName("所有资产");

    await window.getByRole("button", { name: "资源库根目录", exact: true }).click();
    const canvas = window.locator(".workspace-canvas");
    await expect.poll(() => canvas.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )).toBeGreaterThan(0);
    await canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      element.scrollTop = extent * 0.73;
    });
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.73, 2);

    await window.getByRole("button", { name: "新建标签页" }).click();
    await tabs.first().click();
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.73, 2);
    await window.getByRole("button", { name: "关闭标签页：所有资产" }).click();
    await expect(tabs).toHaveCount(1);

    await folderRow(window, "角色原画").click();
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await window.getByRole("button", { name: "后退" }).click();
    await expect(tabs.first()).toHaveAccessibleName("资源库根目录");
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.73, 2);
    await window.getByRole("button", { name: "前进" }).click();
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await window.getByRole("searchbox", { name: "搜索资源库" }).fill("blue metal");
    await expect(searchedAsset).toBeVisible({ timeout: 15_000 });
    await searchedAsset.click();
    await expect(searchedAsset).toHaveClass(/is-selected/);

    await window.getByRole("button", { name: "新建标签页" }).click();
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAccessibleName("所有资产");
    await expect(window.getByRole("searchbox", { name: "搜索资源库" })).toHaveValue("");

    await collectionRow(window, "灵感合集").click();
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAccessibleName("灵感合集");
    if (process.env.SERPENT_E2E_TABS_SCREENSHOT_PATH) {
      await window.screenshot({
        path: process.env.SERPENT_E2E_TABS_SCREENSHOT_PATH,
      });
    }

    await tabs.first().click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText("角色原画");
    await expect(window.getByRole("searchbox", { name: "搜索资源库" })).toHaveValue("blue metal");
    await expect(searchedAsset).toHaveClass(/is-selected/, { timeout: 15_000 });

    await tabs.nth(1).click();
    await expect(window.locator(".scope-crumb-label.is-current")).toContainText("灵感合集");
    await expect(window.getByRole("searchbox", { name: "搜索资源库" })).toHaveValue("");

    await tabs.first().click({ button: "right" });
    const folderMenu = window.getByRole("menu", { name: "角色原画" });
    await expect(folderMenu.getByRole("menuitem", { name: "关闭标签页" })).toBeVisible();
    await expect(folderMenu.getByRole("menuitem", { name: "关闭其他标签页" })).toBeVisible();
    await expect(folderMenu.getByRole("menuitem", { name: "关闭右侧标签页" })).toHaveCount(0);
    await expect(folderMenu.getByRole("menuitem", { name: "在文件夹中显示" })).toBeVisible();
    await expect(folderMenu.getByRole("menuitem", { name: "复制名称" })).toBeVisible();
    await expect(folderMenu.getByRole("menuitem", { name: "复制路径" })).toBeVisible();
    await expect(
      folderMenu.getByRole("menuitem", { name: "在文件浏览器中打开" }),
    ).toBeVisible();
    await folderMenu.getByRole("menuitem", { name: "在文件夹中显示" }).click();
    await expect(folderRow(window, "角色原画")).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

    await tabs.nth(1).click({ button: "right" });
    const collectionMenu = window.getByRole("menu", { name: "灵感合集" });
    await expect(collectionMenu.getByRole("menuitem", { name: "在合集中显示" })).toBeVisible();
    await expect(collectionMenu.getByRole("menuitem", { name: "复制名称" })).toBeVisible();
    await expect(collectionMenu.getByRole("menuitem", { name: "复制路径" })).toHaveCount(0);
    await collectionMenu.getByRole("menuitem", { name: "关闭标签页" }).click();

    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await expect(window.getByRole("searchbox", { name: "搜索资源库" })).toHaveValue("blue metal");

    await window.getByRole("button", { name: "关闭标签页：角色原画" }).click();
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAccessibleName("所有资产");
    await expect(window.getByRole("searchbox", { name: "搜索资源库" })).toHaveValue("");
  } finally {
    if (childProcess.exitCode === null) {
      await application.evaluate(({ app }) => app.quit());
      await once(childProcess, "exit");
    }
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  }
});
