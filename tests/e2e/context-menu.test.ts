import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    await window.getByRole("textbox", { name: "名称" }).fill("CM Close Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // --- Outside click closes ---
    // Right-click on the asset card to open context menu
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    // Click on a safe area — the item-count label in the workspace bar is outside the menu
    await window.locator(".item-count").click();
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
    await expect(
      window.getByRole("menu").getByText("已选择 1 项", { exact: true }),
    ).toBeVisible();
    await expect(window.getByRole("menuitem", { name: "用默认应用打开" })).toBeVisible();
    await expect(
      window.getByRole("menuitem", { name: "用默认应用打开" }).locator(".context-menu-item-shortcut"),
    ).toHaveText(process.platform === "darwin" ? "⌘O" : "Ctrl+O");
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
    await window.getByRole("textbox", { name: "名称" }).fill("CM Clamp Test");
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

    // Create a collection to test organization menu clamping.
    // (The sidebar no longer enumerates tags — REQ-TAG-001 — so the
    // collection row is the remaining organization menu entry.)
    // First Escape: close context menu (selection preserved — correct behavior)
    await window.keyboard.press("Escape");
    // Second Escape: clear the selection so the sidebar is unambiguous
    await window.keyboard.press("Escape");
    await window.getByRole("button", { name: "添加合集" }).click();
    await window.getByPlaceholder("新建合集").fill("Clamp Collection");
    await window.getByPlaceholder("新建合集").press("Enter");
    await expect(window.getByRole("button", { name: /Clamp Collection/ })).toBeVisible();

    // Open organization context menu on the collection
    await window.getByRole("button", { name: /Clamp Collection/ }).click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });

    // Assert organization menu is within viewport
    const orgMenu = window.getByRole("menu");
    const orgMenuBox = await orgMenu.boundingBox();
    if (orgMenuBox && viewport) {
      expect(orgMenuBox.x).toBeGreaterThanOrEqual(-2);
      expect(orgMenuBox.y).toBeGreaterThanOrEqual(-2);
      expect(orgMenuBox.x + orgMenuBox.width).toBeLessThanOrEqual(viewport.width + 2);
      expect(orgMenuBox.y + orgMenuBox.height).toBeLessThanOrEqual(viewport.height + 2);
    }

    // Verify menu still works after testing
    await window.keyboard.press("Escape");
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: "用默认应用打开" })).toBeVisible();
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
    await window.getByRole("textbox", { name: "名称" }).fill("CM Single Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Create a collection for dual-menu testing.
    // (The sidebar no longer enumerates tags — REQ-TAG-001 — so the
    // collection row is the remaining organization menu entry.)
    await window.getByRole("button", { name: "添加合集" }).click();
    await window.getByPlaceholder("新建合集").fill("Single Test Collection");
    await window.getByPlaceholder("新建合集").press("Enter");
    await expect(window.getByRole("button", { name: /Single Test Collection/ })).toBeVisible();

    // Step 1: Open context menu on the asset card
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: "用默认应用打开" })).toBeVisible();

    // Step 2: Open context menu on the collection (should close asset menu, single-menu enforced)
    // The backdrop now has pointer-events:none so right-clicks pass through
    await window.getByRole("button", { name: /Single Test Collection/ }).click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: /重命名合集/ })).toBeVisible();
    // Only one menu should exist
    const menus = window.locator('[role="menu"]');
    await expect(menus).toHaveCount(1);

    // Step 3: Open context menu on the asset again (should close collection menu)
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menuitem", { name: "用默认应用打开" })).toBeVisible();
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
    await window.getByRole("textbox", { name: "名称" }).fill("CM A11y Test");
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
    await window.getByRole("textbox", { name: "名称" }).fill("CM Blur Test");
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
    await window.getByRole("textbox", { name: "名称" }).fill("CM Four Corner");
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
    await window.getByRole("textbox", { name: "名称" }).fill("CM Scope Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    // Import file
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator('[data-asset-id]').first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Open context menu on the asset
    await assetCard.click({ button: "right" });
    await expect(window.getByRole("menu")).toBeVisible({ timeout: 5_000 });
    await expect(window.getByRole("menuitem", { name: "用默认应用打开" })).toBeVisible();

    // Click a sidebar nav item (scope change) — should close the menu
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(window.getByRole("menu")).not.toBeVisible({ timeout: 5_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("pointer hover stays subtle while arrow navigation uses the keyboard focus marker", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-highlight-"));
  const libraryPath = path.join(temporaryRoot, "CM-Highlight");
  const sourcePath = path.join(temporaryRoot, "highlight-test.png");
  writeFileSync(sourcePath, VALID_PNG);
  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill("CM Highlight Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    const assetCard = window.locator("[data-asset-id]").first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });
    await assetCard.click({ button: "right" });

    const menu = window.getByRole("menu");
    const items = menu.locator(
      '[role="menuitem"]:not([aria-disabled="true"])',
    );
    await expect(menu).toBeVisible();
    const itemCount = await items.count();
    expect(itemCount).toBeGreaterThan(2);

    // Opening by pointer must not opt into the stronger keyboard treatment.
    await expect(menu).not.toHaveClass(/\bis-keyboard-navigation\b/);
    const pointerIndex = 2;
    await window.mouse.move(0, 0);
    await items.nth(pointerIndex).hover();
    await expect
      .poll(() =>
        items
          .nth(pointerIndex)
          .evaluate((item) => item === document.activeElement),
      )
      .toBe(true);
    await expect(menu).not.toHaveClass(/\bis-keyboard-navigation\b/);
    const pointerStyle = await items.nth(pointerIndex).evaluate((item) => {
      const style = getComputedStyle(item);
      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
      };
    });
    expect(pointerStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(pointerStyle.boxShadow).toBe("none");

    // Keyboard navigation begins from the pointer-focused item and adds the
    // keyboard-only marker, rather than leaving a second hover highlight.
    await window.keyboard.press("ArrowDown");
    await expect(menu).toHaveClass(/\bis-keyboard-navigation\b/);
    const keyboardIndex = (pointerIndex + 1) % itemCount;
    await expect
      .poll(() =>
        items
          .nth(keyboardIndex)
          .evaluate((item) => item === document.activeElement),
      )
      .toBe(true);
    await expect
      .poll(() =>
        items.nth(keyboardIndex).evaluate((item) => {
          const style = getComputedStyle(item);
          return style.boxShadow;
        }),
      )
      .toContain("inset");
    const keyboardStyle = await items.nth(keyboardIndex).evaluate((item) => {
      const style = getComputedStyle(item);
      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
      };
    });
    expect(keyboardStyle.backgroundColor).not.toBe(pointerStyle.backgroundColor);
    expect(keyboardStyle.boxShadow).toContain("inset");

    // Moving the pointer exits keyboard modality, focuses the hovered item,
    // and restores the subtle pointer treatment with no inset marker.
    const resumedPointerIndex = (keyboardIndex + 1) % itemCount;
    await window.mouse.move(0, 0);
    await items.nth(resumedPointerIndex).hover();
    await expect(menu).not.toHaveClass(/\bis-keyboard-navigation\b/);
    await expect
      .poll(() =>
        items
          .nth(resumedPointerIndex)
          .evaluate((item) => item === document.activeElement),
      )
      .toBe(true);
    const resumedPointerStyle = await items
      .nth(resumedPointerIndex)
      .evaluate((item) => {
        const style = getComputedStyle(item);
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
        };
      });
    expect(resumedPointerStyle).toEqual(pointerStyle);

    // The next arrow continues from the hovered item, rather than from the
    // stale item that was focused during the previous keyboard interaction.
    await window.keyboard.press("ArrowDown");
    await expect(menu).toHaveClass(/\bis-keyboard-navigation\b/);
    expect(
      await items
        .nth((resumedPointerIndex + 1) % itemCount)
        .evaluate((item) => item === document.activeElement),
    ).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 8 — Multi-selection heading and mixed file-operation scope
// ---------------------------------------------------------------------------

test("multi-asset menu shows a visible count and mixed-selection skip reasons", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-mixed-"));
  const libraryPath = path.join(temporaryRoot, "CM-Mixed");
  const managedSourcePath = path.join(temporaryRoot, "managed.png");
  const linkedSourceRoot = path.join(temporaryRoot, "linked-source");
  writeFileSync(managedSourcePath, VALID_PNG);
  mkdirSync(linkedSourceRoot);
  writeFileSync(path.join(linkedSourceRoot, "linked.png"), VALID_PNG);

  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: managedSourcePath,
      SERPENT_E2E_LINKED_SOURCE: linkedSourceRoot,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill("CM Mixed Test");
    await window.getByRole("button", { name: "创建", exact: true }).click();

    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    await expect(
      window.locator('[data-asset-id][title="managed.png"]'),
    ).toBeVisible({ timeout: 15_000 });

    await window
      .getByRole("button", { name: /当前资源库/ })
      .click();
    await window.getByRole("menuitem", { name: "导入链接文件夹" }).click();
    await window.getByRole("button", { name: "所有资产" }).click();

    const managedCard = window.locator(
      '[data-asset-id][title="managed.png"]',
    );
    const linkedCard = window.locator('[data-asset-id][title="linked.png"]');
    await expect(managedCard).toBeVisible({ timeout: 15_000 });
    await expect(linkedCard).toBeVisible({ timeout: 15_000 });

    const additiveModifier = process.platform === "darwin" ? "Meta" : "Control";
    await managedCard.click();
    await linkedCard.click({ modifiers: [additiveModifier] });
    await expect(
      window.getByRole("button", { name: "移动到文件夹", exact: true }),
    ).toHaveCount(0);
    await expect(
      window.getByRole("button", { name: "删除", exact: true }),
    ).toHaveCount(0);
    await linkedCard.click({ button: "right" });

    const menu = window.getByRole("menu", { name: "批量资产操作：2 项" });
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await expect(menu.getByText("已选择 2 项", { exact: true })).toBeVisible();
    await expect(menu.getByRole("note")).toHaveText(
      "移动：将处理 1 / 跳过 1（链接资产）；回收站：将处理 1 / 跳过 1（链接资产）",
    );
    await expect(
      menu.getByRole("menuitem", { name: "移动到文件夹…（1 项）" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "移入回收站（1 项）" }),
    ).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test — Tag picker: search filter, in-menu scroll must not dismiss, no
// secondary back button, Escape closes (REQ-TAG-004)
// ---------------------------------------------------------------------------

test("tag picker searches, survives in-menu scroll, has no back button, and closes on Escape", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-cm-tagpicker-"));
  const libraryPath = path.join(temporaryRoot, "CM-TagPicker");
  const sourcePath = path.join(temporaryRoot, "tagpicker-test.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();

    // Create library and import one asset
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill("CM Tag Picker");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const assetCard = window.locator("[data-asset-id]").first();
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Create two tags through the library API so the picker has candidates.
    // The sidebar no longer enumerates or creates tags (REQ-TAG-001);
    // re-entering 所有资产 refreshes the Renderer tag summaries.
    await window.evaluate(async () => {
      const api = (
        globalThis as typeof globalThis & {
          serpent: {
            library: {
              listOpen(): Promise<{
                ok: boolean;
                value?: Array<{ libraryId: string }>;
              }>;
              createTag(input: {
                libraryId: string;
                name: string;
              }): Promise<{ ok: boolean }>;
            };
          };
        }
      ).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error("No open library");
      const names = [
        "甲标签",
        "乙标签",
        ...Array.from({ length: 40 }, (_, index) => `测试标签${index + 1}`),
      ];
      for (const name of names) {
        const created = await api.createTag({ libraryId, name });
        if (!created.ok) throw new Error(`Could not create tag ${name}.`);
      }
    });
    await window.getByRole("button", { name: /所有资产/ }).click();

    // Enter the tag picker from the asset context menu
    await assetCard.click({ button: "right" });
    const tagTrigger = window.getByRole("menuitem", { name: "添加标签…" });
    const tagTriggerBox = await tagTrigger.boundingBox();
    expect(tagTriggerBox).not.toBeNull();
    await tagTrigger.click();
    const pickerMenu = window.locator('.context-menu-submenu[role="menu"]');
    await expect(pickerMenu).toBeVisible({ timeout: 5_000 });
    const pickerMenuBox = await pickerMenu.boundingBox();
    expect(pickerMenuBox).not.toBeNull();
    // The floating panel touches the trigger horizontally; no transparent
    // four-pixel bridge may expose the draggable asset grid underneath.
    expect(
      Math.abs(pickerMenuBox!.x - (tagTriggerBox!.x + tagTriggerBox!.width)),
    ).toBeLessThanOrEqual(1);
    const pickerPanelBox = await pickerMenu.boundingBox();
    const pickerContentBox = await pickerMenu.locator(".tag-picker").boundingBox();
    expect(pickerPanelBox).not.toBeNull();
    expect(pickerContentBox).not.toBeNull();
    expect(pickerContentBox!.y - pickerPanelBox!.y).toBeLessThanOrEqual(12);
    await expect(
      window.getByRole("combobox", { name: "搜索要添加的标签" }),
    ).toBeFocused();
    await expect(window.getByRole("option", { name: "甲标签" })).toBeVisible();
    await expect(window.getByRole("option", { name: "乙标签" })).toBeVisible();

    // The picker is rendered as a floating submenu. Moving the pointer from
    // the trigger into that portal must not let the trigger's mouseleave
    // timer close the menu before an option can be clicked.
    await window.getByRole("option", { name: "甲标签" }).evaluate((element) => {
      element.scrollIntoView({ block: "nearest" });
    });
    const optionBox = await window.getByRole("option", { name: "甲标签" }).boundingBox();
    expect(optionBox).not.toBeNull();
    await window.mouse.move(
      optionBox!.x + optionBox!.width / 2,
      optionBox!.y + optionBox!.height / 2,
    );
    await expect(pickerMenu).toBeVisible();

    // Scrolling inside the picker's own list must not dismiss the menu
    // (regression: backdrop scroll-dismiss used to fire on in-menu scrolls,
    // including keyboard-driven scrollIntoView).
    await window.locator(".tag-picker-options").evaluate((element) => {
      element.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    await expect(pickerMenu).toBeVisible();

    // Typing a query filters the candidates
    await window
      .getByRole("combobox", { name: "搜索要添加的标签" })
      .fill("甲");
    await expect(window.getByRole("option", { name: "甲标签" })).toBeVisible();
    await expect(window.getByRole("option", { name: "乙标签" })).toHaveCount(0);

    // The picker has no secondary Back button; Escape closes the whole menu.
    await expect(
      window.getByRole("button", { name: "返回上一级菜单" }),
    ).toHaveCount(0);

    // Escape closes the whole menu
    await window.keyboard.press("Escape");
    await expect(window.getByRole("menu")).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
