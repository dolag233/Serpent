import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

// ---------------------------------------------------------------------------
// Serpent-565785: a restored scroll offset must be in place in the FIRST frame
// the new content paints. Sampling the canvas every animation frame across a
// Back restore and a tab switch must never see a frame that already has
// content (scroll extent > 0) but sits at scrollTop 0 — that top frame is the
// flicker the UX principles (0005) tell us to remove.
// ---------------------------------------------------------------------------

test.describe.configure({ timeout: 120_000 });

function launchApp(temporaryRoot: string, libraryPath: string, importFiles: string) {
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
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

async function createFolderViaApi(window: Page, name: string) {
  await window.evaluate(async (folderName) => {
    type LibraryApi = {
      listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
      createFolder(input: { libraryId: string; name: string }): Promise<{ ok: boolean }>;
    };
    const library = (globalThis as typeof globalThis & { serpent: { library: LibraryApi } }).serpent.library;
    const opened = await library.listOpen();
    const libraryId = opened.value?.[0]?.libraryId;
    if (!opened.ok || !libraryId) throw new Error("no library");
    await library.createFolder({ libraryId, name: folderName });
  }, name);
  const refresh = window.getByRole("button", { name: "刷新磁盘变化" });
  await refresh.click();
  await expect(refresh).toBeEnabled({ timeout: 15_000 });
}

function folderRow(window: Page, name: string) {
  const escaped = name.replace(/"/g, '\\"');
  return window.locator(
    `.navigation-pane button.nav-row[data-nav-folder-kind="managed"][data-hover-tip="${escaped}"]`,
  );
}

async function waitForNavigation(window: Page) {
  await expect(window.locator(".workspace-canvas-host")).toHaveAttribute("aria-busy", "false");
}

/** Records scrollTop/extent on every animation frame for `ms` milliseconds. */
async function startFrameProbe(window: Page, ms: number) {
  await window.evaluate((duration) => {
    const g = globalThis as unknown as { __samples: Array<[number, number]> };
    g.__samples = [];
    const el = document.querySelector(".workspace-canvas") as HTMLElement | null;
    if (!el) return;
    const started = performance.now();
    const tick = () => {
      const extent = Math.max(0, el.scrollHeight - el.clientHeight);
      g.__samples.push([Math.round(el.scrollTop), Math.round(extent)]);
      if (performance.now() - started < duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function readFrameProbe(window: Page) {
  return window.evaluate(() => {
    const g = globalThis as unknown as { __samples: Array<[number, number]> };
    const withContent = g.__samples.filter(([, extent]) => extent > 0);
    return {
      contentFrames: withContent.length,
      topFrames: withContent.filter(([top]) => top === 0).length,
      first: withContent.slice(0, 3),
    };
  });
}

async function withScrollableLibrary(run: (window: Page) => Promise<void>) {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-scroll-restore-"));
  const libraryName = "滚动恢复验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sources: string[] = [];
  for (let i = 0; i < 160; i += 1) {
    const p = path.join(temporaryRoot, `asset-${String(i).padStart(3, "0")}.txt`);
    writeFileSync(p, `asset ${i}`, "utf8");
    sources.push(p);
  }

  const application = await launchApp(temporaryRoot, libraryPath, sources.join(path.delimiter));
  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await waitForNavigation(window);
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    await waitForNavigation(window);
    await run(window);
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function scrollDeep(window: Page) {
  const canvas = window.locator(".workspace-canvas");
  await expect(window.locator(".asset-card").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(
    () => canvas.evaluate((el) => el.scrollHeight - el.clientHeight),
    { timeout: 20_000 },
  ).toBeGreaterThan(0);
  await canvas.evaluate((el) => {
    const extent = el.scrollHeight - el.clientHeight;
    el.scrollTop = extent * 0.6;
  });
  const backTarget = await canvas.evaluate((el) => el.scrollTop);
  expect(backTarget).toBeGreaterThan(0);
  return canvas;
}

test("a restored scroll offset is painted in the first content frame", async () => {
  await withScrollableLibrary(async (window) => {
    await createFolderViaApi(window, "空文件夹");

    const canvas = await scrollDeep(window);

    // --- Back restore ---
    await folderRow(window, "空文件夹").click();
    await waitForNavigation(window);
    await startFrameProbe(window, 1_500);
    await window.getByRole("button", { name: "后退" }).click();
    await waitForNavigation(window);
    await window.waitForTimeout(1_200);
    const back = await readFrameProbe(window);
    expect(back.contentFrames).toBeGreaterThan(0);
    expect(back.topFrames).toBe(0);
    expect(back.first[0]?.[0]).toBeGreaterThan(0);

    // --- Tab switch restore ---
    const tabs = window.getByRole("tablist", { name: "工作区标签页" }).getByRole("tab");
    await window.getByRole("button", { name: "新建标签页" }).click();
    await expect(tabs).toHaveCount(2);
    await waitForNavigation(window);
    await expect.poll(
      () => canvas.evaluate((el) => el.scrollHeight - el.clientHeight),
      { timeout: 20_000 },
    ).toBeGreaterThan(0);
    await canvas.evaluate((el) => {
      const extent = el.scrollHeight - el.clientHeight;
      el.scrollTop = extent * 0.3;
    });
    await startFrameProbe(window, 1_500);
    await tabs.first().click();
    await waitForNavigation(window);
    await window.waitForTimeout(1_200);
    const tab = await readFrameProbe(window);
    expect(tab.contentFrames).toBeGreaterThan(0);
    expect(tab.topFrames).toBe(0);
    expect(tab.first[0]?.[0]).toBeGreaterThan(0);
  });
});

test("returns from the viewer to the exact browse position", async () => {
  await withScrollableLibrary(async (window) => {
    const canvas = await scrollDeep(window);

    // Open a card without moving the scrollport. Returning to an unchanged
    // layout must preserve both the raw pixel offset and card screen position.
    const visibleAssetId = await canvas.evaluate((el) => {
      const viewport = el.getBoundingClientRect();
      return [...el.querySelectorAll<HTMLElement>(".asset-card[data-asset-id]")]
        .find((card) => {
          const rect = card.getBoundingClientRect();
          return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
        })?.dataset.assetId;
    });
    expect(visibleAssetId).toBeTruthy();
    const card = canvas.locator(`.asset-card[data-asset-id="${visibleAssetId}"]`);
    await card.click();
    const browseView = () => canvas.evaluate((el, id) => {
      const card = el.querySelector(`.asset-card[data-asset-id="${id}"]`);
      const rect = card?.getBoundingClientRect();
      return { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, top: rect?.top, left: rect?.left };
    }, visibleAssetId);
    const beforePreview = await browseView();
    await window.keyboard.press("Enter");
    const viewer = window.locator(".workspace-viewer");
    await expect(viewer).toHaveClass(/is-text-viewer/);
    await expect(viewer.getByRole("textbox", { name: "文本内容" })).toHaveValue(/asset \d+/);
    await viewer.focus();
    await window.keyboard.press("Enter");
    await expect(viewer).toHaveCount(0);
    await expect(window.locator(".workspace-canvas-host")).not.toHaveClass(/is-restoring/);
    await canvas.evaluate(async () => {
      for (let frame = 0; frame < 16; frame += 1) {
        await new Promise(requestAnimationFrame);
      }
    });
    expect(await browseView()).toEqual(beforePreview);
  });
});
