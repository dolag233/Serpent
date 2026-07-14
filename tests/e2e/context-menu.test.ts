import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

async function getViewportSize(page: Page) {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}

// ---------------------------------------------------------------------------
// Test 1 — Close on outside click, Escape, scroll, and window resize
// ---------------------------------------------------------------------------

test("context menu closes on outside click, Escape, scroll, and window resize", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-close-"));
  const libraryPath = path.join(temporaryRoot, "CM-Close");
  const sourcePath = path.join(temporaryRoot, "close-test.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill("CM Close Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // --- Outside click closes ---
    // Right-click on the asset card to open context menu
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    // Click on a safe area — the brand area in the toolbar header is outside the menu
    await window.locator(".brand-mark").click();
    await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });

    // --- Escape closes ---
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await window.keyboard.press("Escape");
    await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });

    // --- Scroll closes ---
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    // Dispatch a scroll event on the document to trigger the scroll listener
    await window.evaluate(() => {
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });

    // --- Window resize closes ---
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    const viewport = await getViewportSize(window);
    await application.evaluate(
      ({ BrowserWindow }, { w, h }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(w + 50, h + 50);
      },
      { w: viewport.width, h: viewport.height },
    );
    await window.waitForTimeout(500);
    await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });

    // Verify menu still works after all close events
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: "使用外部应用打开" })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — Viewport clamp (menu stays within viewport)
// ---------------------------------------------------------------------------

test("context menu clamps at viewport edges", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-clamp-"));
  const libraryPath = path.join(temporaryRoot, "CM-Clamp");
  const sourcePath = path.join(temporaryRoot, "clamp-corner.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill("CM Clamp Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Open context menu
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });

    // Assert menu is fully within the viewport
    const menu = window.getByRole("menu");
    const menuBox = await menu.boundingBox();
    const viewport = await getViewportSize(window);
    expect(menuBox).toBeTruthy();
    expect(viewport).toBeTruthy();
    if (menuBox && viewport) {
      // Menu must not overflow past viewport edges (allow 2px tolerance)
      expect(menuBox.x).toBeGreaterThanOrEqual(-2);
      expect(menuBox.y).toBeGreaterThanOrEqual(-2);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 2);
      expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height + 2);
    }

    // Create a tag to test organization menu clamping
    // First Escape: close context menu (selection preserved — correct behavior)
    await window.keyboard.press("Escape");
    // Second Escape: clear the selection so the sidebar "添加标签" button
    // is unambiguous (no multi-select context menu when selection is empty)
    await window.keyboard.press("Escape");
    await window.getByRole("button", { name: "添加标签" }).click();
    await window.getByPlaceholder("输入标签名称，回车创建").fill("Clamp Tag");
    await window.getByPlaceholder("输入标签名称，回车创建").press("Enter");
    await expect(window.getByRole("button", { name: /Clamp Tag/ })).toBeVisible();

    // Open organization context menu on the tag
    await window.getByRole("button", { name: /Clamp Tag/ }).click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });

    // Assert organization menu is within viewport
    const tagMenu = window.getByRole("menu");
    const tagMenuBox = await tagMenu.boundingBox();
    if (tagMenuBox && viewport) {
      expect(tagMenuBox.x).toBeGreaterThanOrEqual(-2);
      expect(tagMenuBox.y).toBeGreaterThanOrEqual(-2);
      expect(tagMenuBox.x + tagMenuBox.width).toBeLessThanOrEqual(viewport.width + 2);
      expect(tagMenuBox.y + tagMenuBox.height).toBeLessThanOrEqual(viewport.height + 2);
    }

    // Verify menu still works after testing
    await window.keyboard.press("Escape");
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: "使用外部应用打开" })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — Single-menu enforcement
// ---------------------------------------------------------------------------

test("single-menu enforcement — opening new context menu closes existing one", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-single-"));
  const libraryPath = path.join(temporaryRoot, "CM-Single");
  const sourcePath = path.join(temporaryRoot, "single-menu.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill("CM Single Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Create a tag for dual-menu testing
    await window.getByRole("button", { name: "添加标签" }).click();
    await window.getByPlaceholder("输入标签名称，回车创建").fill("Single Test Tag");
    await window.getByPlaceholder("输入标签名称，回车创建").press("Enter");
    await expect(window.getByRole("button", { name: /Single Test Tag/ })).toBeVisible();

    // Step 1: Open context menu on the asset card
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: "使用外部应用打开" })).toBeVisible();

    // Step 2: Open context menu on the tag (should close asset menu, single-menu enforced)
    // The backdrop now has pointer-events:none so right-clicks pass through
    await window.getByRole("button", { name: /Single Test Tag/ }).click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: /重命名标签/ })).toBeVisible();
    // Only one menu should exist
    const menus = window.locator('[role="menu"]');
    await expect(menus).toHaveCount(1);

    // Step 3: Open context menu on the asset again (should close tag menu)
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menuitem", { name: "使用外部应用打开" })).toBeVisible();
    await expect(menus).toHaveCount(1);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4 — Accessible name and keyboard Escape
// ---------------------------------------------------------------------------

test("context menu has accessible name and keyboard Escape", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-a11y-"));
  const libraryPath = path.join(temporaryRoot, "CM-A11y");
  const sourcePath = path.join(temporaryRoot, "a11y-menu.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill("CM A11y Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Open context menu on asset
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });

    // Assert menu has an accessible name (aria-label)
    const menu = window.getByRole("menu");
    const ariaLabel = await menu.getAttribute("aria-label");
    expect(ariaLabel).toBeTruthy();
    expect(ariaLabel!.length).toBeGreaterThan(0);

    // Assert Escape closes the menu
    await window.keyboard.press("Escape");
    await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5 — Window blur closes the context menu
// ---------------------------------------------------------------------------

test("window blur closes the context menu", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-blur-"));
  const libraryPath = path.join(temporaryRoot, "CM-Blur");
  const sourcePath = path.join(temporaryRoot, "blur-test.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill("CM Blur Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Open context menu
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });

    // Dispatch window blur
    await window.evaluate(() => {
      globalThis.dispatchEvent(new Event("blur"));
    });
    await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6 — Four-corner viewport clamp
// ---------------------------------------------------------------------------

test("context menu clamps within viewport at all four corners", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-4corner-"));
  const libraryPath = path.join(temporaryRoot, "CM-4Corner");
  const sourcePath = path.join(temporaryRoot, "four-corner.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill("CM Four Corner");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    const viewport = await getViewportSize(window);

    // Four corner positions with a small inset
    const corners = [
      { name: "top-left", x: 5, y: 5 },
      { name: "top-right", x: viewport.width - 5, y: 5 },
      { name: "bottom-left", x: 5, y: viewport.height - 5 },
      { name: "bottom-right", x: viewport.width - 5, y: viewport.height - 5 },
    ];

    for (const corner of corners) {
      // Dispatch a synthetic contextmenu event on the asset card at the corner position.
      // React's event delegation on the root container will catch the bubbling native
      // event and trigger the onContextMenu handler with corner clientX/clientY. The
      // ContextMenu component's useLayoutEffect then clamps the menu within the viewport.
      const cardId = await assetCard.getAttribute("data-asset-id");
      await window.evaluate(
        ({ x, y, cid }) => {
          const card = document.querySelector(`[data-asset-id="${cid}"]`);
          if (card) {
            card.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button: 2,
              }),
            );
          }
        },
        { x: corner.x, y: corner.y, cid: cardId },
      );

      // Wait for the menu to appear and measure
      const menu = window.getByRole("menu");
      await expect(menu).toBeVisible({ timeout: 5_000 });

      // Assert the menu is fully within the viewport at each corner
      const menuBox = await menu.boundingBox();
      expect(menuBox).toBeTruthy();
      if (menuBox) {
        expect(
          menuBox.x,
          `${corner.name}: menu left edge (${menuBox.x}) should be >= 0`,
        ).toBeGreaterThanOrEqual(-2);
        expect(
          menuBox.y,
          `${corner.name}: menu top edge (${menuBox.y}) should be >= 0`,
        ).toBeGreaterThanOrEqual(-2);
        expect(
          menuBox.x + menuBox.width,
          `${corner.name}: menu right edge (${menuBox.x + menuBox.width}) should be <= ${viewport.width}`,
        ).toBeLessThanOrEqual(viewport.width + 2);
        expect(
          menuBox.y + menuBox.height,
          `${corner.name}: menu bottom edge (${menuBox.y + menuBox.height}) should be <= ${viewport.height}`,
        ).toBeLessThanOrEqual(viewport.height + 2);
      }

      // Close menu before next corner
      await window.keyboard.press("Escape");
      await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 3_000 });
    }
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7 — Scope change closes the context menu
// ---------------------------------------------------------------------------

test("scope change closes the context menu", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-scope-"));
  const libraryPath = path.join(temporaryRoot, "CM-Scope");
  const sourcePath = path.join(temporaryRoot, "scope-test.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill("CM Scope Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Create a tag to have a sidebar nav item to click
    await window.getByRole("button", { name: "添加标签" }).click();
    await window.getByPlaceholder("输入标签名称，回车创建").fill("Scope Tag");
    await window.getByPlaceholder("输入标签名称，回车创建").press("Enter");
    await expect(window.getByRole("button", { name: /Scope Tag/ })).toBeVisible();

    // Open context menu on the asset
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: "使用外部应用打开" })).toBeVisible();

    // Click a sidebar nav item (scope change) — should close the menu
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
