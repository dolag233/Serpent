import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

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

// The folder menu names the platform's file browser, so the label differs on macOS.
const revealInFileManagerLabel =
  process.platform === "darwin" ? "在 Finder 中打开" : "在文件浏览器中打开";

function launchApp(
  temporaryRoot: string,
  libraryPath: string,
  importFiles: string,
  extraEnv: Record<string, string> = {},
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
      SERPENT_E2E_IMPORT_FILES: importFiles,
      ...extraEnv,
    },
  });
}

async function createSmartCollection(window: Page, name: string) {
  const collectionId = await window.evaluate(async (collectionName) => {
    type LibraryApi = {
      listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
      createSmartCollection(input: {
        libraryId: string;
        name: string;
        queryDefinitionJson: string;
      }): Promise<{
        ok: boolean;
        value?: { collectionId: string };
        error?: { message?: string };
      }>;
    };
    const library = (
      globalThis as typeof globalThis & { serpent: { library: LibraryApi } }
    ).serpent.library;
    const opened = await library.listOpen();
    const libraryId = opened.value?.[0]?.libraryId;
    if (!opened.ok || !libraryId) throw new Error("Expected an open library.");
    const result = await library.createSmartCollection({
      libraryId,
      name: collectionName,
      queryDefinitionJson: JSON.stringify({
        filters: [{ field: "format", values: ["txt"], exclude: false }],
      }),
    });
    if (!result.ok || !result.value) {
      throw new Error(result.error?.message ?? "Could not create smart collection.");
    }
    return result.value.collectionId;
  }, name);
  const refreshButton = window.getByRole("button", { name: "刷新磁盘变化" });
  await refreshButton.click();
  await expect(refreshButton).toBeEnabled({ timeout: 15_000 });
  return collectionId;
}

async function delayNextBrowseSession(
  window: Page,
  target: { folderId?: string; smartCollectionId?: string },
  delayMs: number,
) {
  await window.evaluate(({ match, delay }) => {
    type E2eApi = {
      delayNextBrowseSession(
        target: { folderId?: string; smartCollectionId?: string },
        delayMs: number,
      ): void;
    };
    const diagnostics = (
      globalThis as typeof globalThis & {
        serpent: { e2e?: E2eApi };
      }
    ).serpent.e2e;
    if (!diagnostics) throw new Error("E2E diagnostics are unavailable.");
    diagnostics.delayNextBrowseSession(match, delay);
  }, { match: target, delay: delayMs });
}

async function startNoBlankFrameProbe(window: Page) {
  await window.evaluate(() => {
    let active = true;
    let blankFrames = 0;
    const sample = () => {
      if (!active) return;
      const host = document.querySelector<HTMLElement>(".workspace-canvas-host");
      const canvas = host?.querySelector<HTMLElement>(".workspace-canvas");
      if (host && canvas && getComputedStyle(canvas).visibility !== "hidden") {
        const covered =
          host.getAttribute("aria-busy") === "true" ||
          Boolean(host.querySelector(".workspace-navigation-hold"));
        const hasView = Boolean(
          canvas.querySelector(
            ".asset-card, .folder-card, .folder-card-row, .empty-library, .tag-management-workspace, .plugin-sidebar-view-panel",
          ),
        );
        if (!covered && !hasView) blankFrames += 1;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    Object.defineProperty(window, "__workspaceBlankProbe", {
      configurable: true,
      value: {
        stop: () => {
          active = false;
          return blankFrames;
        },
      },
    });
  });
}

async function stopNoBlankFrameProbe(window: Page) {
  return window.evaluate(() => {
    const probe = (window as typeof window & {
      __workspaceBlankProbe?: { stop: () => number };
    }).__workspaceBlankProbe;
    return probe?.stop() ?? -1;
  });
}

async function startCachedViewportProbe(window: Page) {
  await window.evaluate(() => {
    let active = true;
    let targetFrames = 0;
    let firstTargetProgress: number | null = null;
    const sample = () => {
      if (!active) return;
      const host = document.querySelector<HTMLElement>(".workspace-canvas-host");
      const canvas = host?.querySelector<HTMLElement>(".workspace-canvas");
      const currentScope = document.querySelector<HTMLElement>(
        ".scope-crumb-label.is-current",
      )?.textContent?.trim();
      const hasCachedFolderAssets = [
        ...(canvas?.querySelectorAll<HTMLElement>(".asset-card") ?? []),
      ].some((card) => card.getAttribute("title")?.startsWith("folder-view-") === true);
      if (
        host?.getAttribute("aria-busy") === "true" &&
        canvas &&
        currentScope === "角色原画" &&
        hasCachedFolderAssets
      ) {
        targetFrames += 1;
        if (firstTargetProgress === null) {
          const extent = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
          firstTargetProgress = extent > 0 ? canvas.scrollTop / extent : 0;
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    Object.defineProperty(window, "__workspaceCachedViewportProbe", {
      configurable: true,
      value: {
        stop: () => {
          active = false;
          return { targetFrames, firstTargetProgress };
        },
      },
    });
  });
}

async function stopCachedViewportProbe(window: Page) {
  return window.evaluate(() => {
    const probe = (window as typeof window & {
      __workspaceCachedViewportProbe?: {
        stop: () => { targetFrames: number; firstTargetProgress: number | null };
      };
    }).__workspaceCachedViewportProbe;
    return probe?.stop() ?? { targetFrames: -1, firstTargetProgress: null };
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

async function waitForWorkspaceNavigation(window: Page) {
  await expect(window.locator(".workspace-canvas-host")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

/** macOS keeps the process alive after the last window closes; quit explicitly. */
async function quitApplication(application: ElectronApplication): Promise<void> {
  const childProcess = application.process();
  if (childProcess.exitCode === null) {
    try {
      await application.evaluate(({ app }) => app.quit());
    } catch {
      // The transport can close before the child process exits.
    }
    await Promise.race([
      once(childProcess, "exit").then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
  if (childProcess.exitCode === null) {
    childProcess.kill("SIGKILL");
    await once(childProcess, "exit").catch(() => undefined);
  }
  await application.close().catch(() => undefined);
}

test("keeps navigation inside explicit tabs and exposes contextual tab actions", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-workspace-tabs-"));
  const libraryName = "标签页验收库";
    const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceAsset = path.join(temporaryRoot, "blue metal.txt");
  const folderAssets = Array.from({ length: 42 }, (_, index) =>
    path.join(temporaryRoot, `folder-view-${String(index + 1).padStart(2, "0")}.txt`),
  );
  writeFileSync(sourceAsset, "workspace tab selection fixture", "utf8");
  for (const [index, sourcePath] of folderAssets.entries()) {
    writeFileSync(sourcePath, `folder scroll fixture ${index + 1}`, "utf8");
  }
  const application = await launchApp(
    temporaryRoot,
    libraryPath,
    [sourceAsset, ...folderAssets].join(path.delimiter),
  );

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolder(window, "角色原画");
    await importFilesThroughBridge(window, "角色原画");
    await createFolder(window, "并发目标");
    const searchedAsset = window.locator('.asset-card[title="blue metal.txt"]');
    await expect(searchedAsset).toBeVisible({ timeout: 15_000 });
    await createCollection(window, "灵感合集");
    const smartCollectionId = await createSmartCollection(window, "慢速智能合集");
    await createScrollableRoot(window, 36);
    await folderRow(window, "角色原画").click();
    await waitForWorkspaceNavigation(window);

    const tablist = window.getByRole("tablist", { name: "工作区标签页" });
    const tabs = tablist.getByRole("tab");
    const tabItems = tablist.locator(".workspace-tab");
    await expect(tabs).toHaveCount(1);
    const initialTabName = await tabs.first().getAttribute("aria-label");
    expect(initialTabName).toBeTruthy();
    await startNoBlankFrameProbe(window);
    await window.getByRole("button", { name: "新建标签页" }).click();
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAccessibleName("所有资产");
    await waitForWorkspaceNavigation(window);
    await window
      .getByRole("button", { name: `关闭标签页：${initialTabName}` })
      .click();
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAccessibleName("所有资产");
    expect(await stopNoBlankFrameProbe(window)).toBe(0);

    await window.getByRole("button", { name: "资源库根目录", exact: true }).click();
    await waitForWorkspaceNavigation(window);
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
    await waitForWorkspaceNavigation(window);
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.73, 2);
    await window.getByRole("button", { name: "关闭标签页：所有资产" }).click();
    await expect(tabs).toHaveCount(1);

    await folderRow(window, "角色原画").click();
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await waitForWorkspaceNavigation(window);
    const folderId = await folderRow(window, "角色原画").getAttribute("data-nav-folder-id");
    expect(folderId).toBeTruthy();
    await expect.poll(() => canvas.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )).toBeGreaterThan(0);
    await canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      element.scrollTop = extent * 0.41;
    });
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.41, 2);

    await window.getByRole("button", { name: "新建标签页" }).click();
    await expect(tabs).toHaveCount(2);
    await waitForWorkspaceNavigation(window);
    await window.getByRole("button", { name: "资源库根目录", exact: true }).click();
    await waitForWorkspaceNavigation(window);
    await expect.poll(() => canvas.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )).toBeGreaterThan(0);
    await canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      element.scrollTop = extent * 0.89;
    });
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.89, 2);
    await delayNextBrowseSession(window, { folderId: folderId! }, 900);
    await startCachedViewportProbe(window);
    await tabs.first().click();
    await expect(window.locator(".workspace-canvas-host")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(window.locator('.asset-card[title^="folder-view-"]').first()).toBeVisible();
    const cachedViewportProbe = await stopCachedViewportProbe(window);
    expect(cachedViewportProbe.targetFrames).toBeGreaterThan(0);
    expect(cachedViewportProbe.firstTargetProgress).not.toBeNull();
    expect(cachedViewportProbe.firstTargetProgress!).toBeCloseTo(0.41, 2);
    await waitForWorkspaceNavigation(window);
    await tabs.nth(1).click();
    await waitForWorkspaceNavigation(window);
    await window.getByRole("button", { name: "关闭标签页：资源库根目录" }).click();
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toHaveAccessibleName("角色原画");

    await window.getByRole("button", { name: "后退" }).click();
    await expect(tabs.first()).toHaveAccessibleName("资源库根目录");
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.73, 2);
    await waitForWorkspaceNavigation(window);
    await window.getByRole("button", { name: "前进" }).click();
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.41, 2);
    await waitForWorkspaceNavigation(window);

    await window.getByRole("button", { name: "资源库根目录", exact: true }).click();
    await waitForWorkspaceNavigation(window);
    await canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      element.scrollTop = extent * 0.73;
    });
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.73, 2);
    await delayNextBrowseSession(window, { folderId: folderId! }, 1_500);
    await window.getByRole("button", { name: "后退" }).click();
    await expect(window.locator(".workspace-canvas-host")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await folderRow(window, "并发目标").click();
    await waitForWorkspaceNavigation(window);
    await expect(tabs.first()).toHaveAccessibleName("并发目标");
    await window.getByRole("button", { name: "后退" }).click();
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await waitForWorkspaceNavigation(window);
    await expect.poll(() => canvas.evaluate((element) => {
      const extent = element.scrollHeight - element.clientHeight;
      return extent > 0 ? element.scrollTop / extent : 0;
    })).toBeCloseTo(0.41, 2);

    await delayNextBrowseSession(window, { folderId: folderId! }, 900);
    await folderRow(window, "角色原画").click();
    await window.getByRole("button", { name: "资源库根目录", exact: true }).click();
    await expect(tabs.first()).toHaveAccessibleName("资源库根目录");
    await folderRow(window, "角色原画").click();
    await expect(searchedAsset).toBeVisible({ timeout: 15_000 });
    await searchedAsset.click();
    await expect(searchedAsset).toHaveClass(/is-selected/);
    await window.waitForTimeout(1_000);
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await expect(searchedAsset).toHaveClass(/is-selected/);
    await window.getByRole("button", { name: "后退" }).click();
    await expect(tabs.first()).toHaveAccessibleName("资源库根目录");
    await waitForWorkspaceNavigation(window);
    await window.getByRole("button", { name: "前进" }).click();
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await waitForWorkspaceNavigation(window);
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

    await startNoBlankFrameProbe(window);
    await tabs.nth(1).click();
    await expect(window.locator(".scope-crumb-label.is-current")).toContainText("灵感合集");
    await expect(window.getByRole("searchbox", { name: "搜索资源库" })).toHaveValue("");
    await tabs.first().click();
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText("角色原画");
    await tabs.nth(1).click();
    await expect(window.locator(".scope-crumb-label.is-current")).toContainText("灵感合集");
    expect(await stopNoBlankFrameProbe(window)).toBe(0);

    await tabs.first().click({ button: "right" });
    const folderMenu = window.getByRole("menu", { name: "角色原画" });
    await expect(folderMenu.getByRole("menuitem", { name: "关闭标签页" })).toBeVisible();
    await expect(folderMenu.getByRole("menuitem", { name: "关闭其他标签页" })).toBeVisible();
    await expect(folderMenu.getByRole("menuitem", { name: "关闭右侧标签页" })).toHaveCount(0);
    await expect(folderMenu.getByRole("menuitem", { name: "在文件夹中显示" })).toBeVisible();
    await expect(folderMenu.getByRole("menuitem", { name: "复制名称" })).toBeVisible();
    await expect(folderMenu.getByRole("menuitem", { name: "复制路径" })).toBeVisible();
    await expect(
      folderMenu.getByRole("menuitem", { name: revealInFileManagerLabel }),
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

    // The last tab can never be closed away: no X, and no close item in its menu.
    await expect(
      window.getByRole("button", { name: "关闭标签页：角色原画" }),
    ).toHaveCount(0);
    await tabs.first().click({ button: "right" });
    const lastTabMenu = window.getByRole("menu", { name: "角色原画" });
    await expect(lastTabMenu.getByRole("menuitem", { name: "关闭标签页" })).toHaveCount(0);
    await expect(
      lastTabMenu.getByRole("menuitem", { name: "关闭其他标签页" }),
    ).toHaveAttribute("aria-disabled", "true");
    await window.keyboard.press("Escape");
    await expect(lastTabMenu).toHaveCount(0);

    // Drag reorder: the tab follows whichever half of the target it lands on.
    await window.getByRole("button", { name: "新建标签页" }).click();
    await expect(tabs).toHaveCount(2);
    await waitForWorkspaceNavigation(window);
    await tabItems.first().click();
    await waitForWorkspaceNavigation(window);

    const secondTabBox = await tabItems.nth(1).boundingBox();
    await tabItems.first().dragTo(tabItems.nth(1), {
      targetPosition: { x: Math.max(8, (secondTabBox?.width ?? 160) - 6), y: 8 },
    });
    await expect(tabs.first()).toHaveAccessibleName("所有资产");
    await expect(tabs.nth(1)).toHaveAccessibleName("角色原画");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

    await tabItems.nth(1).dragTo(tabItems.first(), {
      targetPosition: { x: 6, y: 8 },
    });
    await expect(tabs.first()).toHaveAccessibleName("角色原画");
    await expect(tabs.nth(1)).toHaveAccessibleName("所有资产");
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await tabItems.nth(1)
      .getByRole("button", { name: "关闭标签页：所有资产" }).click();
    await expect(tabs).toHaveCount(1);

    await window.getByRole("button", { name: "新建标签页" }).click();
    await expect(tabs).toHaveCount(2);
    const smartCollectionRow = window
      .locator(".navigation-pane button.nav-row")
      .filter({ hasText: "慢速智能合集" });
    await expect(smartCollectionRow).toBeVisible();
    await delayNextBrowseSession(window, { smartCollectionId }, 900);
    await smartCollectionRow.click();
    await tablist.locator(".workspace-tab").first()
      .getByRole("button", { name: "关闭标签页：角色原画" }).click();
    await expect(tabs).toHaveCount(1);
    await expect(window.locator('.asset-card[title="blue metal.txt"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(window.locator(".scope-crumb-label.is-current")).toContainText("慢速智能合集");
    await window.waitForTimeout(1_000);
    await expect(window.locator('.asset-card[title="blue metal.txt"]')).toBeVisible();
    await expect(window.locator(".scope-crumb-label.is-current")).toContainText("慢速智能合集");
  } finally {
    await quitApplication(application);
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  }
});

test("restores the saved tab strip after a relaunch", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-workspace-tabs-restore-"),
  );
  const libraryName = "标签页恢复库";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceAsset = path.join(temporaryRoot, "restore fixture.txt");
  writeFileSync(sourceAsset, "restore fixture", "utf8");

  // The first launch has to record the recent library too: under SERPENT_E2E the
  // recent-library file is only written when the restore flag is on, and the
  // relaunch below depends on it to reopen the library by itself.
  const application = await launchApp(temporaryRoot, libraryPath, sourceAsset, {
    SERPENT_E2E_RESTORE_RECENT: "1",
  });
  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolder(window, "恢复夹甲");
    await createFolder(window, "恢复夹乙");
    await importFilesThroughBridge(window, "恢复夹甲");
    await createFolder(window, "恢复夹丙");

    const tablist = window.getByRole("tablist", { name: "工作区标签页" });
    const tabs = tablist.getByRole("tab");

    await folderRow(window, "恢复夹甲").click();
    await waitForWorkspaceNavigation(window);
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "恢复夹甲",
    );

    await window.getByRole("button", { name: "新建标签页" }).click();
    await expect(tabs).toHaveCount(2);
    await waitForWorkspaceNavigation(window);
    await folderRow(window, "恢复夹乙").click();
    await waitForWorkspaceNavigation(window);
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "恢复夹乙",
    );

    await window.getByRole("button", { name: "新建标签页" }).click();
    await expect(tabs).toHaveCount(3);
    await waitForWorkspaceNavigation(window);

    // Quit with the middle tab active, so the relaunch has to pick it back.
    await tabs.nth(1).click();
    await waitForWorkspaceNavigation(window);
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "恢复夹乙",
    );
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  } finally {
    await quitApplication(application);
  }

  const relaunched = await launchApp(temporaryRoot, libraryPath, "", {
    SERPENT_E2E_RESTORE_RECENT: "1",
  });
  try {
    const window = await relaunched.firstWindow();
    await expect(
      window.getByRole("button", { name: `当前资源库 ${libraryName}` }),
    ).toBeVisible({ timeout: 20_000 });
    await waitForWorkspaceNavigation(window);

    const tablist = window.getByRole("tablist", { name: "工作区标签页" });
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveAccessibleName("恢复夹甲");
    await expect(tabs.nth(1)).toHaveAccessibleName("恢复夹乙");
    await expect(tabs.nth(2)).toHaveAccessibleName("所有资产");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "恢复夹乙",
    );

    // Every tab kept the place it was left on.
    await tabs.nth(0).click();
    await waitForWorkspaceNavigation(window);
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "恢复夹甲",
    );
    await tabs.nth(2).click();
    await waitForWorkspaceNavigation(window);
    await expect(window.locator(".scope-crumb-label.is-current")).toHaveText(
      "所有资产",
    );
  } finally {
    await quitApplication(relaunched);
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  }
});
