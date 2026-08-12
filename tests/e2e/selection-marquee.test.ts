import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

/**
 * Use distinct text payloads for selection-only E2E fixtures. The tests cover
 * geometry and keyboard selection, not media decoding, so a plain text asset
 * avoids routing malformed image fixtures through the thumbnail worker.
 */
function textWithToken(token: string): Buffer {
  return Buffer.from(`marquee-${token}`, "utf8");
}

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
      `marquee-${index.toString().padStart(2, "0")}.txt`,
    );
    writeFileSync(sourcePath, textWithToken(index.toString().padStart(2, "0")));
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
  await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
  await window.getByRole("button", { name: "创建", exact: true }).click();
  await window
    .getByRole("button", { name: "导入文件", exact: true })
    .first()
    .click();
  await expect(window.locator(".asset-card")).toHaveCount(expectedCardCount, {
    timeout: 30_000,
  });
  // Import reveal intentionally selects the imported set. Each selection
  // contract below starts from an empty selection so the gesture under test is
  // the only source of selected cards.
  await window.keyboard.press("Escape");
  await expect.poll(() => selectedCount(window)).toBe(0);
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

test("masonry Tab follows the left-to-right reading order", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(5);
  try {
    await createAndImport(window, "瀑布流键盘顺序验收", 5);
    const masonryButton = window.getByRole("button", { name: "瀑布流视图" });
    if ((await masonryButton.getAttribute("aria-pressed")) !== "true") {
      await masonryButton.click();
    }
    await expect(masonryButton).toHaveAttribute("aria-pressed", "true");
    await expect(window.locator(".masonry-columns")).toBeVisible();

    const firstCard = window.locator('.asset-card[title="marquee-00.txt"]');
    const secondCard = window.locator('.asset-card[title="marquee-01.txt"]');
    await firstCard.click();
    await expect(firstCard).toHaveClass(/is-selected/);
    await firstCard.focus();
    await window.keyboard.press("Tab");
    await expect(secondCard).toBeFocused();
    await expect(firstCard).toHaveClass(/is-selected/);
    await expect(secondCard).not.toHaveClass(/is-selected/);
    await window.keyboard.press("Shift+Tab");
    await expect(firstCard).toBeFocused();
    await expect(firstCard).toHaveClass(/is-selected/);
    await expect(secondCard).not.toHaveClass(/is-selected/);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

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

test("marquee keeps its viewport range aligned after the canvas is scrolled", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(40);
  try {
    await createAndImport(window, "滚动后框选坐标验收", 40);

    const gridButton = window.getByRole("button", { name: "平铺视图" });
    if ((await gridButton.getAttribute("aria-pressed")) !== "true") {
      await gridButton.click();
    }

    const geometry = await window.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      if (!canvas) throw new Error("workspace-canvas is not visible");
      canvas.scrollTop = Math.min(360, canvas.scrollHeight - canvas.clientHeight);
      const canvasRect = canvas.getBoundingClientRect();
      const cards = Array.from(
        canvas.querySelectorAll<HTMLElement>(".asset-card[data-asset-id]"),
      )
        .map((card) => {
          const rect = card.getBoundingClientRect();
          return {
            id: card.dataset.assetId ?? "",
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          };
        })
        .filter(
          (card) =>
            card.id &&
            card.top > canvasRect.top + 50 &&
            card.bottom < canvasRect.bottom - 50,
        );
      const first = cards[0];
      if (!first) throw new Error("No fully visible card after scrolling");
      const second = cards.find(
        (card) => Math.abs(card.top - first.top) < 2 && card.left > first.right,
      );
      if (!second) throw new Error("No second card in the visible row");
      const start = { x: first.left - 8, y: first.top - 8 };
      const end = { x: second.right + 8, y: second.bottom + 8 };
      const expected = cards
        .filter(
          (card) =>
            card.left < end.x &&
            card.right > start.x &&
            card.top < end.y &&
            card.bottom > start.y,
        )
        .map((card) => card.id);
      return {
        canvas: {
          left: canvasRect.left,
          top: canvasRect.top,
          right: canvasRect.right,
          bottom: canvasRect.bottom,
        },
        start,
        end,
        expected,
        scrollTop: canvas.scrollTop,
      };
    });
    expect(geometry.scrollTop).toBeGreaterThan(0);
    expect(geometry.start.x).toBeGreaterThan(geometry.canvas.left);
    expect(geometry.start.y).toBeGreaterThan(geometry.canvas.top);

    await window.mouse.move(geometry.start.x, geometry.start.y);
    await window.mouse.down();
    await window.mouse.move(geometry.end.x, geometry.end.y, { steps: 12 });

    const marquee = window.locator(".marquee-selection-box");
    await expect(marquee).toBeVisible();
    const marqueeBox = await marquee.boundingBox();
    expect(marqueeBox).not.toBeNull();
    expect(marqueeBox!.x).toBeCloseTo(geometry.start.x, 0);
    expect(marqueeBox!.y).toBeCloseTo(geometry.start.y, 0);
    expect(marqueeBox!.width).toBeCloseTo(geometry.end.x - geometry.start.x, 0);
    expect(marqueeBox!.height).toBeCloseTo(geometry.end.y - geometry.start.y, 0);

    await window.mouse.up();
    const selectedIds = await window.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".asset-card.is-selected"))
        .map((card) => card.dataset.assetId ?? "")
        .filter(Boolean),
    );
    expect(selectedIds.sort()).toEqual([...geometry.expected].sort());
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("marquee keeps its anchor attached while auto-scroll moves the canvas", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(40);
  try {
    await createAndImport(window, "滚动中框选锚点验收", 40);

    const gridButton = window.getByRole("button", { name: "平铺视图" });
    if ((await gridButton.getAttribute("aria-pressed")) !== "true") {
      await gridButton.click();
    }

    const geometry = await window.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      if (!canvas) throw new Error("workspace-canvas is not visible");
      const maxScrollTop = canvas.scrollHeight - canvas.clientHeight;
      canvas.scrollTop = Math.min(300, maxScrollTop);
      const rect = canvas.getBoundingClientRect();
      return {
        canvas: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        initialScrollTop: canvas.scrollTop,
        start: {
          x: rect.left + 5,
          y: rect.top + rect.height / 2,
        },
        end: {
          x: rect.right - 24,
          y: rect.bottom - 5,
        },
      };
    });
    expect(geometry.initialScrollTop).toBeGreaterThan(0);

    await window.mouse.move(geometry.start.x, geometry.start.y);
    await window.mouse.down();
    await window.mouse.move(geometry.end.x, geometry.end.y, { steps: 20 });

    await expect
      .poll(
        () =>
          window.evaluate(() => {
            const canvas = document.querySelector<HTMLElement>(
              ".workspace-canvas",
            );
            if (!canvas) return false;
            return (
              canvas.scrollTop >=
              canvas.scrollHeight - canvas.clientHeight - 2
            );
          }),
        { timeout: 20_000 },
      )
      .toBe(true);

    const finalScrollTop = await window.evaluate(
      () => document.querySelector<HTMLElement>(".workspace-canvas")?.scrollTop ?? 0,
    );
    expect(finalScrollTop).toBeGreaterThan(geometry.initialScrollTop);

    const marquee = window.locator(".marquee-selection-box");
    await expect(marquee).toBeVisible();
    const marqueeBox = await marquee.boundingBox();
    expect(marqueeBox).not.toBeNull();

    // The drag anchor is content-local. Once scrolling moves it above the
    // viewport, the visible marquee must be clipped to the canvas top rather
    // than remaining at the anchor's old clientY.
    expect(marqueeBox!.y).toBeCloseTo(geometry.canvas.top, 0);

    await window.mouse.up();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("marquee refreshes its visible range when the canvas scrolls during a drag", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(40);
  try {
    await createAndImport(window, "拖拽中滚动画布验收", 40);

    const gridButton = window.getByRole("button", { name: "平铺视图" });
    if ((await gridButton.getAttribute("aria-pressed")) !== "true") {
      await gridButton.click();
    }

    const geometry = await window.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      if (!canvas) throw new Error("workspace-canvas is not visible");
      const maxScrollTop = canvas.scrollHeight - canvas.clientHeight;
      canvas.scrollTop = Math.min(250, maxScrollTop);
      const rect = canvas.getBoundingClientRect();
      const start = {
        x: rect.left + 5,
        y: rect.top + rect.height * 0.35,
      };
      const end = {
        x: rect.right - 24,
        y: rect.top + rect.height * 0.65,
      };
      return {
        start,
        end,
        initialScrollTop: canvas.scrollTop,
      };
    });

    await window.mouse.move(geometry.start.x, geometry.start.y);
    await window.mouse.down();
    await window.mouse.move(geometry.end.x, geometry.end.y, { steps: 12 });

    const marquee = window.locator(".marquee-selection-box");
    await expect(marquee).toBeVisible();
    const beforeScrollBox = await marquee.boundingBox();
    expect(beforeScrollBox).not.toBeNull();

    const scrollDelta = await window.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      if (!canvas) throw new Error("workspace-canvas is not visible");
      const previous = canvas.scrollTop;
      canvas.scrollTop = Math.min(
        previous + 120,
        canvas.scrollHeight - canvas.clientHeight,
      );
      return canvas.scrollTop - previous;
    });
    expect(scrollDelta).toBeGreaterThan(0);

    await expect
      .poll(async () => (await marquee.boundingBox())?.y ?? null)
      .toBeCloseTo(beforeScrollBox!.y - scrollDelta, 0);

    await window.mouse.up();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 1b — Plain marquee (no modifier) replaces an existing selection
// ---------------------------------------------------------------------------

test("blank-drag marquee without modifiers replaces the existing selection", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(4);
  try {
    await createAndImport(window, "框选替换验收", 4);
    const additiveModifier =
      process.platform === "darwin" ? "Meta" : "Control";

    const gridButton = window.getByRole("button", { name: "平铺视图" });
    const isGrid = (await gridButton.getAttribute("aria-pressed")) === "true";
    if (!isGrid) await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");

    const cards = window.locator(".asset-card");

    // Pre-select cards 0 and 1 via click + additive-modifier click.
    await cards.nth(0).click();
    await cards.nth(1).click({ modifiers: [additiveModifier] });
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Marquee-drag over cards 2-3 only, with NO modifier held.
    const card2Box = await cards.nth(2).boundingBox();
    const card3Box = await cards.nth(3).boundingBox();
    if (!card2Box || !card3Box) throw new Error("Cards 2-3 not visible");

    await window.mouse.move(card2Box.x - 10, card2Box.y - 10);
    await window.mouse.down();
    await window.mouse.move(
      card3Box.x + card3Box.width + 10,
      card3Box.y + card3Box.height + 10,
      { steps: 15 },
    );
    await window.mouse.up();

    // Selection must be REPLACED by the marquee hit set — cards 0/1 are
    // deselected, only cards 2/3 remain selected.
    await expect.poll(() => selectedCount(window)).toBe(2);
    await expect(cards.nth(0)).not.toHaveClass(/is-selected/);
    await expect(cards.nth(1)).not.toHaveClass(/is-selected/);
    await expect(cards.nth(2)).toHaveClass(/is-selected/);
    await expect(cards.nth(3)).toHaveClass(/is-selected/);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 1c — Ctrl/Cmd-held marquee toggles the hit set against the existing
//            selection, without changing the operation if the key is
//            released mid-drag (modifier snapshot is taken at mousedown).
// ---------------------------------------------------------------------------

test("Ctrl/Cmd-held marquee toggles hit assets and snapshots the modifier", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(4);
  try {
    await createAndImport(window, "框选并集验收", 4);
    const additiveModifier =
      process.platform === "darwin" ? "Meta" : "Control";

    const gridButton = window.getByRole("button", { name: "平铺视图" });
    const isGrid = (await gridButton.getAttribute("aria-pressed")) === "true";
    if (!isGrid) await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");

    const cards = window.locator(".asset-card");

    // Pre-select card 0 only.
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Ctrl/Cmd-held marquee over cards 0-2. Card 0 starts selected, so it must
    // be removed while cards 1-2 are added. Release
    // the modifier key before mouseup to prove the op was snapshotted at
    // mousedown and does not flip back to "replace" mid-drag.
    const card0Box = await cards.nth(0).boundingBox();
    const card2Box = await cards.nth(2).boundingBox();
    if (!card0Box || !card2Box) throw new Error("Cards 0-2 not visible");

    await window.keyboard.down(additiveModifier);
    await window.mouse.move(card0Box.x - 10, card0Box.y - 10);
    await window.mouse.down();
    await window.mouse.move(
      card2Box.x + card2Box.width + 10,
      card2Box.y + card2Box.height + 10,
      { steps: 15 },
    );
    await window.keyboard.up(additiveModifier);
    await window.mouse.up();

    await expect.poll(() => selectedCount(window)).toBe(2);
    await expect(cards.nth(0)).not.toHaveClass(/is-selected/);
    await expect(cards.nth(1)).toHaveClass(/is-selected/);
    await expect(cards.nth(2)).toHaveClass(/is-selected/);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 1d — Shift-held marquee unions the hit set into the existing
//            selection (same union semantics as Ctrl/Cmd for marquee).
// ---------------------------------------------------------------------------

test("Shift-held marquee unions the hit set into the existing selection", async () => {
  const { temporaryRoot, application, window } = await setupLibrary(4);
  try {
    await createAndImport(window, "框选Shift并集验收", 4);

    const gridButton = window.getByRole("button", { name: "平铺视图" });
    const isGrid = (await gridButton.getAttribute("aria-pressed")) === "true";
    if (!isGrid) await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");

    const cards = window.locator(".asset-card");

    // Pre-select card 0 only.
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);

    // Shift-held marquee over cards 2-3 (not touching card 0).
    const card2Box = await cards.nth(2).boundingBox();
    const card3Box = await cards.nth(3).boundingBox();
    if (!card2Box || !card3Box) throw new Error("Cards 2-3 not visible");

    // Reproduce the real navigation-to-canvas journey: the current-folder
    // button can still own focus when Shift changes Chromium to keyboard focus
    // modality. Starting the marquee must release that focus so the folder
    // does not gain an unrelated focus highlight while asset selection is in
    // progress.
    const activeFolder = window.locator(".nav-row.is-active").first();
    await activeFolder.focus();
    await expect(activeFolder).toBeFocused();

    await window.keyboard.down("Shift");
    await window.mouse.move(card2Box.x - 10, card2Box.y - 10);
    await window.mouse.down();
    await expect(activeFolder).not.toBeFocused();
    await window.mouse.move(
      card3Box.x + card3Box.width + 10,
      card3Box.y + card3Box.height + 10,
      { steps: 15 },
    );
    await window.mouse.up();
    await window.keyboard.up("Shift");

    // Selection must be the UNION of the initial selection (card 0) and the
    // hit set (cards 2-3) — card 0 stays selected alongside cards 2-3.
    await expect.poll(() => selectedCount(window)).toBe(3);
    await expect(cards.nth(0)).toHaveClass(/is-selected/);
    await expect(cards.nth(2)).toHaveClass(/is-selected/);
    await expect(cards.nth(3)).toHaveClass(/is-selected/);
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

    // Select 2 cards in grid mode. Import auto-selects all 4 and re-applies
    // that reveal selection on a 280ms settle timer (use-pending-asset-reveal),
    // so wait out the settle, clear the reveal selection with a blank-canvas
    // click, then build a clean 2-selection.
    const cards = window.locator(".asset-card");
    await window.waitForTimeout(600);
    const canvasForClear = await canvasBox(window);
    await window.mouse.click(
      canvasForClear.x + canvasForClear.width - 8,
      canvasForClear.y + canvasForClear.height - 8,
    );
    await expect.poll(() => selectedCount(window)).toBe(0);
    await cards.nth(0).click();
    await expect.poll(() => selectedCount(window)).toBe(1);
    await cards.nth(1).click({
      modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
    });
    await expect.poll(() => selectedCount(window)).toBe(2);

    // Switch to masonry — selection must survive. Re-query .asset-card after
    // each switch because the grid fully re-mounts the cards on view change.
    await masonryButton.click();
    await expect(masonryButton).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => selectedCount(window), { timeout: 10_000 })
      .toBe(2);

    // Switch back to grid — selection must survive
    await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => selectedCount(window), { timeout: 10_000 })
      .toBe(2);

    // Card-size zoom via Ctrl+wheel — selection must survive. The zoom handler
    // requires ctrlKey, so hold the modifier key across the wheel events
    // (mouse.wheel's own modifier option does not reach the DOM wheel event).
    const canvas = await canvasBox(window);
    const cx = canvas.x + canvas.width / 2;
    const cy = canvas.y + canvas.height / 2;
    const zoomModifier = process.platform === "darwin" ? "Meta" : "Control";
    await window.mouse.move(cx, cy);
    await window.keyboard.down(zoomModifier);
    await window.mouse.wheel(0, -480); // zoom in (several notches)
    await window.keyboard.up(zoomModifier);
    await window.waitForTimeout(500);
    await expect
      .poll(() => selectedCount(window), { timeout: 10_000 })
      .toBe(2);
    await window.keyboard.down(zoomModifier);
    await window.mouse.wheel(0, 480); // zoom out
    await window.keyboard.up(zoomModifier);
    await window.waitForTimeout(500);
    await expect
      .poll(() => selectedCount(window), { timeout: 10_000 })
      .toBe(2);
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
    await window.keyboard.press(
      process.platform === "darwin" ? "Meta+Backspace" : "Delete",
    );
    await expect(window.locator(".workspace-notice")).toContainText("已移入回收站", {
      timeout: 10_000,
    });
    await expect.poll(() => selectedCount(window)).toBe(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
