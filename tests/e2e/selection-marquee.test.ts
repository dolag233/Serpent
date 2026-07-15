import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the canvas scroll container and return its bounding box. */
async function canvasBox(page: { locator: (selector: string) => { boundingBox: () => Promise<{ x: number; y: number; width: number; height: number } | null> } }) {
  const box = await page.locator(".workspace-canvas").boundingBox();
  if (!box) throw new Error("workspace-canvas is not visible");
  return box;
}

/** Create a temporary library with N PNG assets, returning cleanup + page. */
async function setupLibrary(assetCount: number) {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-marquee-e2e-"),
  );
  const sourceRoot = path.join(temporaryRoot, "sources");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(sourceRoot);

  const sourcePaths = Array.from({ length: assetCount }, (_, index) => {
    const sourcePath = path.join(
      sourceRoot,
      `marquee-${index.toString().padStart(2, "0")}.png`,
    );
    writeFileSync(sourcePath, VALID_PNG);
    return sourcePath;
  });

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
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "profile"),
    },
  });

  const window = await application.firstWindow();
  return { temporaryRoot, application, window };
}

async function createAndImport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window: any,
  libraryName: string,
  expectedCardCount: number,
) {
  await window.getByRole("button", { name: "创建资源库" }).click();
  await window.getByLabel("名称").fill(libraryName);
  await window.getByRole("button", { name: "创建", exact: true }).click();
  await window
    .getByRole("button", { name: "导入文件", exact: true })
    .first()
    .click();
  await expect(window.locator(".asset-card")).toHaveCount(expectedCardCount, {
    timeout: 30_000,
  });
}

/** Count selected asset cards via .is-selected CSS class. */
async function selectedCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll(".asset-card.is-selected").length,
  );
}

// ---------------------------------------------------------------------------
// Test 1 — Marquee drag-select in grid mode
// ---------------------------------------------------------------------------

test("marquee-selects multiple cards in grid mode", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(4);
  try {
    await createAndImport(window, "框选平铺验收", 4);
    const additiveModifier =
      process.platform === "darwin" ? "Meta" : "Control";

    // Ensure grid mode
    const gridButton = window.getByRole("button", { name: "平铺视图" });
    const isGrid = (await gridButton.getAttribute("aria-pressed")) === "true";
    if (!isGrid) await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");

    // Get card and canvas bounding boxes
    const canvas = await canvasBox(window);
    const cards = window.locator(".asset-card");
    const firstCardBox = await cards.first().boundingBox();
    const lastCardBox = await cards.last().boundingBox();
    if (!firstCardBox || !lastCardBox)
      throw new Error("Cards are not visible");

    // Start marquee from slightly above-left of first card
    const startX = firstCardBox.x - 10;
    const startY = firstCardBox.y - 10;
    const endX = lastCardBox.x + lastCardBox.width + 10;
    const endY = lastCardBox.y + lastCardBox.height + 10;

    // Ensure start point is within canvas
    expect(startX).toBeGreaterThan(canvas.x);
    expect(startY).toBeGreaterThan(canvas.y);

    await window.mouse.move(startX, startY);
    await window.mouse.down();
    // Drag diagonally across all cards
    await window.mouse.move(endX, endY, { steps: 15 });
    await window.mouse.up();

    // All 4 cards should be selected
    await expect.poll(() => selectedCount(window)).toBe(4);

    // Click empty canvas to clear (checks marquee-to-empty behavior)
    await window.mouse.click(canvas.x + 5, canvas.y + 5);
    await expect.poll(() => selectedCount(window)).toBe(0);

    // Ctrl/Cmd-marquee: select first 2 via normal click, then shift-marquee
    // First, click card 0 then Ctrl+click card 1
    await cards.nth(0).click();
    await cards.nth(1).click({ modifiers: [additiveModifier] });
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Shift-marquee to add remaining 2 cards
    // Start marquee from slightly above card 2
    const card2Box = await cards.nth(2).boundingBox();
    const card3Box = await cards.nth(3).boundingBox();
    if (!card2Box || !card3Box) throw new Error("Cards 2-3 not visible");
    const shiftStartX = card2Box.x - 10;
    const shiftStartY = card2Box.y - 10;
    const shiftEndX = card3Box.x + card3Box.width + 10;
    const shiftEndY = card3Box.y + card3Box.height + 10;

    // Hold Shift during marquee (union with existing)
    await window.keyboard.down("Shift");
    await window.mouse.move(shiftStartX, shiftStartY);
    await window.mouse.down();
    await window.mouse.move(shiftEndX, shiftEndY, { steps: 15 });
    await window.mouse.up();
    await window.keyboard.up("Shift");

    await expect.poll(() => selectedCount(window)).toBe(4);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — Marquee drag-select in masonry mode
// ---------------------------------------------------------------------------

test("marquee-selects in masonry mode", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(4);
  try {
    await createAndImport(window, "框选瀑布流验收", 4);

    // Switch to masonry mode
    const masonryButton = window.getByRole("button", {
      name: "瀑布流视图",
    });
    await masonryButton.click();
    await expect(masonryButton).toHaveAttribute("aria-pressed", "true");

    // Wait for masonry layout to settle
    await window.waitForTimeout(500);

    const cvs = await canvasBox(window);
    const cards = window.locator(".asset-card");
    const firstCardBox = await cards.first().boundingBox();
    const lastCardBox = await cards.last().boundingBox();
    if (!firstCardBox || !lastCardBox)
      throw new Error("Masonry cards are not visible");

    // Start marquee from well within canvas, above-first-card area
    const startX = Math.max(cvs.x + 10, firstCardBox.x - 20);
    const startY = Math.max(cvs.y + 10, firstCardBox.y - 20);

    // End point covering all cards
    const endX = Math.min(
      cvs.x + cvs.width - 10,
      Math.max(lastCardBox.x + lastCardBox.width, firstCardBox.x + firstCardBox.width) + 20,
    );
    const endY = Math.min(
      cvs.y + cvs.height - 10,
      lastCardBox.y + lastCardBox.height + 20,
    );

    await window.mouse.move(startX, startY);
    await window.mouse.down();
    await window.mouse.move(endX, endY, { steps: 20 });
    await window.mouse.up();

    // Cards intersected should be selected
    const selectedCount = await window
      .locator(".asset-card.is-selected")
      .count();
    expect(selectedCount).toBeGreaterThanOrEqual(1);
    expect(selectedCount).toBeLessThanOrEqual(4);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — Ctrl/Cmd+Shift+click appends a range to existing selection
// ---------------------------------------------------------------------------

test("Ctrl/Cmd+Shift+click appends range to existing selection", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(4);
  try {
    await createAndImport(window, "追加范围验收", 4);
    const additiveModifier =
      process.platform === "darwin" ? "Meta" : "Control";

    const cards = window.locator(".asset-card");

    // Step 1: Click first card normally (single selection)
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Step 2: Ctrl/Cmd+Shift+click last card — should append range
    await cards.last().click({
      modifiers: ["Shift", additiveModifier],
    });

    // All 4 cards should now be selected (range from 0 to 3 appended to existing [0])
    await expect.poll(() => selectedCount(window)).toBe(4);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4 — Esc clears selection
// ---------------------------------------------------------------------------

test("Esc clears selection", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(2);
  try {
    await createAndImport(window, "Esc清选验收", 2);

    const cards = window.locator(".asset-card");

    // Plain click selects one
    await cards.first().click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Escape clears
    await window.keyboard.press("Escape");
    await expect.poll(() => selectedCount(window)).toBe(0);

    // Range-select both via Shift+click
    await cards.first().click();
    await cards.last().click({ modifiers: ["Shift"] });
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Escape clears again
    await window.keyboard.press("Escape");
    await expect.poll(() => selectedCount(window)).toBe(0);

    // Verify selection is empty — clicking a card selects anew
    await cards.first().click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Right-clicking an unselected card selects it
    await window.keyboard.press("Escape");
    await expect.poll(() => selectedCount(window)).toBe(0);
    await cards.first().click({ button: "right" });
    // The right-click handler selects the card before opening context menu
    // Verify the context menu appears (implies selection was set)
    await expect(
      window.getByRole("menuitem", { name: "打开" }),
    ).toBeVisible();
    // Close with Escape
    await window.keyboard.press("Escape");
    await expect(
      window.getByRole("menuitem", { name: "打开" }),
    ).toHaveCount(0, { timeout: 3000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5 — Ctrl/Cmd+click toggle deselects a single selected card
// ---------------------------------------------------------------------------

test("Ctrl/Cmd+click toggle deselects and re-selects a card", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(3);
  try {
    await createAndImport(window, "切换取消验收", 3);
    const mod = process.platform === "darwin" ? "Meta" : "Control";

    const cards = window.locator(".asset-card");

    // Select card 0 with plain click
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Ctrl/Cmd+click card 0 — toggle DESELECT
    await cards.nth(0).click({ modifiers: [mod] });
    await expect.poll(() => selectedCount(window)).toBe(0);

    // Ctrl/Cmd+click card 0 again — toggle re-add
    await cards.nth(0).click({ modifiers: [mod] });
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Plain click on already-selected sole card keeps it selected (no deselect)
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Ctrl/Cmd+click card 1 — add to multi-selection
    await cards.nth(1).click({ modifiers: [mod] });
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Ctrl/Cmd+click card 1 — toggle remove from multi-selection
    await cards.nth(1).click({ modifiers: [mod] });
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Plain click card 2 — replace single selection
    await cards.nth(2).click();
    await expect.poll(() => selectedCount(window)).toBe(1);
    await expect(cards.nth(2)).toHaveClass(/is-selected/);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6 — Marquee then Shift+click extends correctly from the marquee anchor
// ---------------------------------------------------------------------------

test("marquee then Shift+click extends correctly", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(6);
  try {
    await createAndImport(window, "框选后Shift扩展验收", 6);

    const canvas = await canvasBox(window);
    const cards = window.locator(".asset-card");

    // Marquee-drag to select cards 2-4
    const card2Box = await cards.nth(2).boundingBox();
    const card4Box = await cards.nth(4).boundingBox();
    if (!card2Box || !card4Box) throw new Error("Cards 2-4 not visible");

    const mqStartX = card2Box.x - 10;
    const mqStartY = card2Box.y - 10;
    const mqEndX = card4Box.x + card4Box.width + 10;
    const mqEndY = card4Box.y + card4Box.height + 10;

    await window.mouse.move(mqStartX, mqStartY);
    await window.mouse.down();
    await window.mouse.move(mqEndX, mqEndY, { steps: 15 });
    await window.mouse.up();

    await expect.poll(() => selectedCount(window)).toBe(3);

    // Shift+click card 5 — should extend range from marquee anchor (card 2) through card 5
    await cards.nth(5).click({ modifiers: ["Shift"] });

    // Range from card 2 to card 5 = 4 cards
    await expect.poll(() => selectedCount(window)).toBe(4);

    // Clear and verify: click empty canvas
    await window.mouse.click(canvas.x + 5, canvas.y + 5);
    await expect.poll(() => selectedCount(window)).toBe(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7 — Selection survives view-switch (grid↔masonry) and card-size zoom
// ---------------------------------------------------------------------------

test("selection survives view-switch and card-size zoom", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(4);
  try {
    await createAndImport(window, "选择生存验收", 4);

    const gridButton = window.getByRole("button", { name: "平铺视图" });
    const masonryButton = window.getByRole("button", {
      name: "瀑布流视图",
    });

    // Select 2 cards in grid mode
    const cards = window.locator(".asset-card");
    await cards.nth(0).click();
    await cards.nth(1).click({
      modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
    });
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Switch to masonry — selection must survive
    await masonryButton.click();
    await expect(masonryButton).toHaveAttribute("aria-pressed", "true");
    await window.waitForTimeout(500);
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Switch back to grid — selection must survive
    await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");
    await window.waitForTimeout(500);
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Card-size zoom via Ctrl+wheel — selection must survive
    const canvas = await canvasBox(window);
    const cx = canvas.x + canvas.width / 2;
    const cy = canvas.y + canvas.height / 2;
    await window.mouse.move(cx, cy);
    await window.mouse.wheel(0, -100); // zoom in
    await window.waitForTimeout(200);
    await expect.poll(() => selectedCount(window)).toBe(2);
    await window.mouse.wheel(0, 100); // zoom out
    await window.waitForTimeout(200);
    await expect.poll(() => selectedCount(window)).toBe(2);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 8 — Ctrl/Cmd toggle: ADD then REMOVE on the same card end-to-end
// ---------------------------------------------------------------------------

test("Ctrl/Cmd toggle adds then removes the same card", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(3);
  try {
    await createAndImport(window, "切换增删验收", 3);
    const mod = process.platform === "darwin" ? "Meta" : "Control";

    const cards = window.locator(".asset-card");

    // Start with card 0 selected
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Ctrl+click card 1 — add to selection
    await cards.nth(1).click({ modifiers: [mod] });
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Ctrl+click card 1 again — remove from selection, keep card 0
    await cards.nth(1).click({ modifiers: [mod] });
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Verify card 0 is still selected (the sole selected card)
    await expect(cards.nth(0)).toHaveClass(/is-selected/);

    // Ctrl+click card 0 — remove it, selection should be empty
    await cards.nth(0).click({ modifiers: [mod] });
    await expect.poll(() => selectedCount(window)).toBe(0);

    // Plain click card 2 — fresh selection
    await cards.nth(2).click();
    await expect.poll(() => selectedCount(window)).toBe(1);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 9 — Masonry-mode auto-scroll during marquee
// ---------------------------------------------------------------------------

test("masonry marquee auto-scroll preserves first, last, and along-path selections", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(40);
  try {
    await createAndImport(window, "自动滚动画布验收", 40);

    // Switch to masonry mode
    const masonryButton = window.getByRole("button", {
      name: "瀑布流视图",
    });
    await masonryButton.click();
    await expect(masonryButton).toHaveAttribute("aria-pressed", "true");
    await window.waitForTimeout(500);

    const cvs = await canvasBox(window);

    // Record which asset IDs are visible before the marquee.
    const initialVisibleIds: string[] = await window.evaluate(() => {
      const cards = document.querySelectorAll<HTMLElement>(".asset-card");
      const canvas = document.querySelector(".workspace-canvas");
      if (!canvas) return [];
      const canvasRect = canvas.getBoundingClientRect();
      const visible: string[] = [];
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (
          rect.bottom > canvasRect.top &&
          rect.top < canvasRect.bottom &&
          rect.left < canvasRect.right &&
          rect.right > canvasRect.left
        ) {
          const id = card.dataset.assetId;
          if (id) visible.push(id);
        }
      }
      return visible;
    });

    // Start marquee above the topmost visible card.
    const safeStartY = await window.evaluate((canvasTop: number) => {
      const cards = document.querySelectorAll<HTMLElement>(".asset-card");
      let minY = Infinity;
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (rect.top < minY) minY = rect.top;
      }
      return Math.max(canvasTop + 5, minY - 15);
    }, cvs.y);
    const startX = cvs.x + 30;
    const startY = safeStartY;
    await window.mouse.move(startX, startY);
    await window.mouse.down();

    // Drag down into the auto-scroll zone at the bottom edge of the canvas
    const endX = cvs.x + cvs.width - 50;
    const endY = cvs.y + cvs.height - 5; // inside auto-scroll zone
    await window.mouse.move(endX, endY, { steps: 20 });

    // Keep the pointer still at the edge. The RAF loop must continue scrolling
    // without any additional mousemove events until the bottom is reached.
    await expect
      .poll(
        () =>
          window.evaluate(() => {
            const canvas = document.querySelector(".workspace-canvas");
            if (!canvas) return false;
            return (
              canvas.scrollTop >=
              canvas.scrollHeight - canvas.clientHeight - 2
            );
          }),
        // CI can briefly throttle Electron's RAF loop while other test
        // processes finish. Keep the assertion on reaching the true bottom,
        // but allow enough wall time for a throttled renderer.
        { timeout: 20_000 },
      )
      .toBe(true);

    const finalScroll = await window.evaluate(
      () => document.querySelector(".workspace-canvas")?.scrollTop ?? 0,
    );

    // Auto-scroll should have moved the scroll position
    expect(finalScroll).toBeGreaterThan(0);

    await window.mouse.up();

    // The selection must retain the first card encountered before scrolling,
    // include the final card at the bottom, and include cards along the path.
    const cards = window.locator(".asset-card");
    await expect(cards.first()).toHaveClass(/is-selected/);
    await expect(cards.last()).toHaveClass(/is-selected/);
    expect(await selectedCount(window)).toBeGreaterThan(2);

    // At least one selected asset was NOT visible before the auto-scroll.
    const selectedIds: string[] = await window.evaluate(() => {
      const cards = document.querySelectorAll<HTMLElement>(
        ".asset-card.is-selected",
      );
      return Array.from(cards)
        .map((c) => c.dataset.assetId ?? "")
        .filter(Boolean);
    });
    const newlyVisibleSelected = selectedIds.filter(
      (id) => !initialVisibleIds.includes(id),
    );
    expect(newlyVisibleSelected.length).toBeGreaterThan(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 10 — Context-menu Escape: menu closes, selection preserved;
//            second Escape clears selection
// ---------------------------------------------------------------------------

test("context-menu Escape dismisses menu then second Escape clears selection", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(2);
  try {
    await createAndImport(window, "菜单Esc序贯验收", 2);

    const cards = window.locator(".asset-card");

    // Select a card
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Right-click opens context menu (selects the card)
    await cards.nth(0).click({ button: "right" });
    await expect(
      window.getByRole("menuitem", { name: "打开" }),
    ).toBeVisible();

    // First Escape: closes the context menu, selection MUST be preserved
    await window.keyboard.press("Escape");
    await expect(
      window.getByRole("menuitem", { name: "打开" }),
    ).toHaveCount(0, { timeout: 3000 });
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Second Escape: now clears the selection
    await window.keyboard.press("Escape");
    await expect.poll(() => selectedCount(window)).toBe(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 11 — Delete key trashes selected managed assets via keyboard
// ---------------------------------------------------------------------------

test("Delete key trashes selected managed assets", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(3);
  try {
    await createAndImport(window, "删除键验收", 3);

    // Select two cards via Cmd+click
    const cards = window.locator(".asset-card");
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);
    const multiSelectModifier: "Meta" | "Control" =
      process.platform === "darwin" ? "Meta" : "Control";
    await cards.nth(1).click({ modifiers: [multiSelectModifier] });
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Press Delete — should move selected managed assets to trash
    await window.keyboard.press("Delete");
    await expect(window.locator(".toast")).toContainText("已移入回收站", {
      timeout: 10_000,
    });
    await expect.poll(() => selectedCount(window)).toBe(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
