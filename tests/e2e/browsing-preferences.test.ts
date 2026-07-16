import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import sharp from "sharp";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const MIXED_ASPECT_DIMENSIONS = [
  { width: 320, height: 180 },
  { width: 180, height: 320 },
  { width: 240, height: 240 },
  { width: 360, height: 240 },
  { width: 240, height: 360 },
] as const;

async function writeMixedAspectPng(sourcePath: string, index: number) {
  const dimensions =
    MIXED_ASPECT_DIMENSIONS[index % MIXED_ASPECT_DIMENSIONS.length]!;
  await sharp({
    create: {
      ...dimensions,
      channels: 4,
      background: {
        r: (index * 37) % 255,
        g: (index * 71) % 255,
        b: (index * 109) % 255,
        alpha: 1,
      },
    },
  })
    .png()
    .toFile(sourcePath);
}

// ---------------------------------------------------------------------------
// LOCATOR NOTES:
//
// Asset cards are `<button class="asset-card" data-asset-id="...">`.
// When fields.name is TRUE: card has NO aria-label; text content includes
//   filename + size + date, e.g. "automatic.png 70 B · 07/14".
// When fields.name is FALSE: card HAS aria-label=displayName; text content
//   includes only size + date, e.g. "70 B · 07/14".
//
// To locate a card robustly across both states:
//   - getByRole('button', {name: /filename/}) — uses accessible name
//     (aria-label when name hidden, text content when name visible)
//   - locator('.asset-card[data-asset-id="..."]') — precise, always works
//
// Avoid .filter({hasText: filename}) when name may be hidden, because the
// text content won't include the filename.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test 1 — Restart persistence (acceptance criteria #1 and #7)
// ---------------------------------------------------------------------------

test("restores canvas preferences after a full restart", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-prefs-restart-"),
  );
  const libraryName = "偏好持久化";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const profilePath = path.join(temporaryRoot, "profile");
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(profilePath);
  mkdirSync(sourceRoot);
  const sourcePath = path.join(sourceRoot, "persist-test.png");
  writeFileSync(sourcePath, VALID_PNG);

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_RESTORE_RECENT: "1",
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_IMPORT_FILES: sourcePath,
      },
    });

  let application = await launch();
  try {
    let window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();

    // Import the asset
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    // Wait for the asset card to appear (name is ON by default, so hasText works)
    const assetCard = window
      .locator(".asset-card")
      .filter({ hasText: "persist-test.png" });
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

    // Capture the card's data-asset-id for robust location after name is hidden
    const cardId = await assetCard.getAttribute("data-asset-id");
    expect(cardId).toBeTruthy();

    // Set masonry mode
    const masonryButton = window.getByRole("button", {
      name: "瀑布流视图",
    });
    await expect(masonryButton).toHaveAttribute("aria-pressed", "false");
    await masonryButton.click();
    await expect(masonryButton).toHaveAttribute("aria-pressed", "true");

    // Set cardSize to 200 via the slider
    const sizeSlider = window.getByLabel("资产缩略图大小");
    await sizeSlider.fill("200");
    await expect(sizeSlider).toHaveValue("200");

    // Toggle every field independently so restart persistence cannot pass by
    // exercising only one member of the fields object.
    const nameToggle = window.getByRole("button", { name: "文件名" });
    const sizeToggle = window.getByRole("button", { name: "文件大小" });
    const dateToggle = window.getByRole("button", { name: "修改日期" });
    await expect(nameToggle).toHaveAttribute("aria-pressed", "true");
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "true");

    await nameToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "true");

    await sizeToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "true");

    await dateToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "false");

    // Close the app
    await application.close();

    // Re-launch with the same stable profile
    application = await launch();
    window = await application.firstWindow();

    // Wait for library to restore
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Locate the card by accessible name (works with name hidden via aria-label)
    const restoredCard = window.getByRole("button", {
      name: /persist-test/,
    });
    await expect(restoredCard).toBeVisible({ timeout: 15_000 });

    // Assert masonry mode restored
    const restoredMasonry = window.getByRole("button", {
      name: "瀑布流视图",
    });
    await expect(restoredMasonry).toHaveAttribute("aria-pressed", "true");

    // Assert cardSize restored to 200
    const restoredSlider = window.getByLabel("资产缩略图大小");
    await expect(restoredSlider).toHaveValue("200");

    // Assert field toggles restored
    const restoredNameToggle = window.getByRole("button", { name: "文件名" });
    const restoredSizeToggle = window.getByRole("button", { name: "文件大小" });
    const restoredDateToggle = window.getByRole("button", { name: "修改日期" });
    await expect(restoredNameToggle).toHaveAttribute("aria-pressed", "false");
    await expect(restoredSizeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(restoredDateToggle).toHaveAttribute("aria-pressed", "false");
    await expect(restoredCard.locator(".asset-caption")).toHaveCount(0);

    // Verify localStorage contains the correct persisted object
    const storedPrefs = await window.evaluate(() => {
      const raw = localStorage.getItem("serpent.canvas-prefs.v1");
      return raw ? JSON.parse(raw) : null;
    });
    expect(storedPrefs).toEqual({
      version: 1,
      viewMode: "masonry",
      cardSize: 200,
      fields: { name: false, size: false, date: false },
    });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("lays out a sparse masonry folder from left to right", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-prefs-sparse-masonry-"),
  );
  const libraryName = "稀疏瀑布流";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(sourceRoot);
  const sourcePaths = Array.from({ length: 3 }, (_, index) =>
    path.join(sourceRoot, `sparse-${index}.png`),
  );
  await Promise.all(
    sourcePaths.map((sourcePath, index) =>
      writeMixedAspectPng(sourcePath, index),
    ),
  );

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.setViewportSize({ width: 1440, height: 720 });
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    await expect(window.locator(".asset-card")).toHaveCount(3, {
      timeout: 30_000,
    });

    await window.getByRole("button", { name: "瀑布流视图" }).click();
    const sizeSlider = window.getByLabel("资产缩略图大小");
    await sizeSlider.fill("96");
    await expect(sizeSlider).toHaveValue("96");
    await expect
      .poll(() => window.locator(".masonry-column").count())
      .toBeGreaterThanOrEqual(3);

    const boxes = await Promise.all(
      sourcePaths.map(async (_, index) => {
        const box = await window
          .getByRole("button", { name: new RegExp(`^sparse-${index}\\.png`) })
          .boundingBox();
        if (!box) throw new Error(`Sparse asset ${index} has no layout box`);
        return box;
      }),
    );
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    expect(
      Math.max(...boxes.map((box) => box.y)) -
        Math.min(...boxes.map((box) => box.y)),
    ).toBeLessThanOrEqual(1);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — All-scope consistency, accessible names, Ctrl+wheel, masonry,
//          and no-requery (acceptance criteria #2, #3, #4, #5, #6, #7)
// ---------------------------------------------------------------------------

test("maintains consistent preferences, accessible names, zoom behavior, and avoids re-query", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-prefs-live-"),
  );
  const libraryName = "实时偏好验证";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(sourceRoot);
  const assetCount = 36;
  const sourcePaths = Array.from({ length: assetCount }, (_, index) => {
    const sourcePath = path.join(
      sourceRoot,
      `automatic-${index.toString().padStart(3, "0")}.png`,
    );
    return sourcePath;
  });
  await Promise.all(
    sourcePaths.map((sourcePath, index) =>
      writeMixedAspectPng(sourcePath, index),
    ),
  );
  const targetName = "automatic-000.png";

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();

    // Create library
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();

    // Import the mixed-aspect assets.
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    await expect(window.locator(".asset-card")).toHaveCount(assetCount, {
      timeout: 30_000,
    });
    const assetCard = window.locator(".asset-card").filter({ hasText: targetName });
    await expect(assetCard).toBeVisible();

    // Capture the card's ID for robust location when name is hidden
    const cardId = await assetCard.getAttribute("data-asset-id");
    expect(cardId).toBeTruthy();
    const cardById = window.locator(`.asset-card[data-asset-id="${cardId!}"]`);

    // Set masonry mode
    const masonryButton = window.getByRole("button", {
      name: "瀑布流视图",
    });
    await masonryButton.click();
    await expect(masonryButton).toHaveAttribute("aria-pressed", "true");

    const sizeSlider = window.getByLabel("资产缩略图大小");
    const nameToggle = window.getByRole("button", { name: "文件名" });

    async function firstThreeAssetBoxes() {
      return Promise.all(
        [0, 1, 2].map(async (index) => {
          const box = await window
            .getByRole("button", {
              name: new RegExp(
                `^automatic-${index.toString().padStart(3, "0")}\\.png`,
              ),
            })
            .boundingBox();
          if (!box) throw new Error(`Asset ${index} has no layout box`);
          return box;
        }),
      );
    }

    // -------------------------------------------------------------------
    // 2a. Accessible name when name is hidden, then when name is visible
    //     (criterion #7)
    // -------------------------------------------------------------------

    // With name ON initially: card has NO aria-label, accessible name from
    // text content which includes filename + size + date
    const ariaBefore = await cardById.getAttribute("aria-label");
    expect(ariaBefore).toBeNull();

    // Card text should include filename + size info
    const visibleText = await cardById.textContent();
    expect(visibleText).toContain(targetName);
    expect(visibleText).toMatch(/\d/); // size or date present

    // Toggle name OFF
    await nameToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");

    // Now card should have aria-label = displayName
    await expect(cardById).toHaveAttribute("aria-label", targetName);

    // Card should still be locatable by accessible name (which is the aria-label)
    const cardByAccessibleName = window.getByRole("button", {
      name: new RegExp(`^${targetName.replace(".", "\\.")}$`),
    });
    await expect(cardByAccessibleName).toBeVisible();

    // Toggle name back ON
    await nameToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "true");

    // Aria-label should be gone again
    const ariaAfter = await cardById.getAttribute("aria-label");
    expect(ariaAfter).toBeNull();

    // -------------------------------------------------------------------
    // 2b. Ctrl+wheel bounds, direction, and zoom (criteria #3 and #4)
    // -------------------------------------------------------------------
    // Reset slider to a known starting point
    await sizeSlider.fill("200");
    await expect(sizeSlider).toHaveValue("200");

    // Bring the workspace canvas into focus for wheel events
    const canvas = window.locator(".workspace-canvas");
    await canvas.click();

    // Ctrl+wheel DOWN (negative deltaY) → zoom IN → cardSize INCREASES
    await window.keyboard.down("Control");
    await window.mouse.wheel(0, -600);
    await window.keyboard.up("Control");
    const afterZoomIn = await sizeSlider.inputValue();
    expect(Number(afterZoomIn)).toBeGreaterThan(200);

    // Ctrl+wheel UP (positive deltaY) → zoom OUT → cardSize DECREASES
    await window.keyboard.down("Control");
    await window.mouse.wheel(0, 600);
    await window.keyboard.up("Control");
    const afterZoomOut = await sizeSlider.inputValue();
    expect(Number(afterZoomOut)).toBeLessThan(Number(afterZoomIn));

    // Zoom out hard repeatedly → clamp at 96
    for (let i = 0; i < 10; i++) {
      await window.keyboard.down("Control");
      await window.mouse.wheel(0, 400);
      await window.keyboard.up("Control");
    }
    await expect(sizeSlider).toHaveValue("96");

    // Zoom in hard repeatedly → clamp at 320
    for (let i = 0; i < 20; i++) {
      await window.keyboard.down("Control");
      await window.mouse.wheel(0, -400);
      await window.keyboard.up("Control");
    }
    await expect(sizeSlider).toHaveValue("320");

    // Actual card width assertions at all three reference points. Measure the
    // rendered card itself rather than inferring layout from a CSS declaration.
    const gridButton = window.getByRole("button", { name: "平铺视图" });
    await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");

    async function measureCardWidth(size: 96 | 160 | 320): Promise<number> {
      await sizeSlider.fill(String(size));
      await expect(sizeSlider).toHaveValue(String(size));
      await expect
        .poll(async () => (await cardById.boundingBox())?.width ?? 0)
        .toBeGreaterThan(0);
      return (await cardById.boundingBox())!.width;
    }

    const gridWidths = [];
    for (const size of [96, 160, 320] as const) {
      const width = await measureCardWidth(size);
      expect(width).toBeGreaterThanOrEqual(size - 1);
      expect(width).toBeLessThan(size * 2 + 12);
      gridWidths.push(width);
    }
    expect(gridWidths[0]).toBeLessThan(gridWidths[1]!);
    expect(gridWidths[1]).toBeLessThan(gridWidths[2]!);

    // A full first row must consume the available grid width at narrow,
    // typical, and wide window sizes. This catches the old fixed-width
    // columns that left a conspicuous blank strip on the right.
    await sizeSlider.fill("96");
    for (const viewportWidth of [900, 1200, 1600]) {
      await window.setViewportSize({ width: viewportWidth, height: 720 });
      await canvas.evaluate((element) => { element.scrollTop = 0; });
      await canvas.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      const fill = await window.locator(".asset-grid").evaluate((grid) => {
        const gridRect = grid.getBoundingClientRect();
        const paddingRight = Number.parseFloat(getComputedStyle(grid).paddingRight);
        const cards = Array.from(grid.querySelectorAll<HTMLElement>(".asset-card"))
          .map((card) => card.getBoundingClientRect());
        const firstTop = Math.min(...cards.map((card) => card.top));
        const firstRow = cards.filter((card) => Math.abs(card.top - firstTop) < 2);
        return {
          gridRight: gridRect.right - paddingRight,
          lastRight: Math.max(...firstRow.map((card) => card.right)),
          firstRowCount: firstRow.length,
        };
      });
      expect(fill.firstRowCount).toBeGreaterThan(1);
      expect(Math.abs(fill.gridRight - fill.lastRight)).toBeLessThanOrEqual(1.5);
    }
    await window.setViewportSize({ width: 1280, height: 720 });

    // Normal wheel (no Ctrl) should NOT change card size — only scrolls
    await sizeSlider.fill("200");
    await expect(sizeSlider).toHaveValue("200");
    await window.mouse.wheel(0, -400);
    // Slider value should remain unchanged after a non-Ctrl wheel
    await expect(sizeSlider).toHaveValue("200");

    // -------------------------------------------------------------------
    // 2c. Masonry first/last completeness (criterion #5)
    // -------------------------------------------------------------------
    // Ensure we're in masonry mode
    const masonryState = await masonryButton.getAttribute("aria-pressed");
    if (masonryState !== "true") {
      await masonryButton.click();
      await expect(masonryButton).toHaveAttribute("aria-pressed", "true");
    }

    // Explicit masonry columns must remain bounded by the canvas at every
    // supported size, across a compact and a wide window.  At 96px both
    // windows have room for at least three columns; the first three imported
    // assets must seed those columns from left to right instead of forming a
    // single vertical stack at the left edge.
    for (const viewportWidth of [1054, 1440]) {
      await window.setViewportSize({ width: viewportWidth, height: 720 });
      const masonryWidths = [];
      for (const size of [96, 160, 320] as const) {
        const width = await measureCardWidth(size);
        expect(width).toBeGreaterThanOrEqual(size - 1);
        expect(width).toBeLessThanOrEqual(size * 2 + 12);
        masonryWidths.push(width);

        const bounds = await window.locator(".masonry-columns").evaluate(
          (columns) => {
            const canvas = columns.closest<HTMLElement>(".workspace-canvas");
            if (!canvas) throw new Error("Missing workspace canvas");
            const canvasRect = canvas.getBoundingClientRect();
            const columnRects = Array.from(
              columns.querySelectorAll<HTMLElement>(".masonry-column"),
              (column) => column.getBoundingClientRect(),
            );
            return {
              canvasLeft: canvasRect.left,
              canvasRight: canvasRect.right,
              columnCount: columnRects.length,
              left: Math.min(...columnRects.map((rect) => rect.left)),
              right: Math.max(...columnRects.map((rect) => rect.right)),
            };
          },
        );
        expect(bounds.left).toBeGreaterThanOrEqual(bounds.canvasLeft - 1);
        expect(bounds.right).toBeLessThanOrEqual(bounds.canvasRight + 1);

        if (size === 96) {
          expect(bounds.columnCount).toBeGreaterThanOrEqual(3);
          const firstRow = await firstThreeAssetBoxes();
          expect(firstRow[0]!.x).toBeLessThan(firstRow[1]!.x);
          expect(firstRow[1]!.x).toBeLessThan(firstRow[2]!.x);
          expect(Math.abs(firstRow[0]!.y - firstRow[1]!.y)).toBeLessThanOrEqual(
            1,
          );
          expect(Math.abs(firstRow[1]!.y - firstRow[2]!.y)).toBeLessThanOrEqual(
            1,
          );
        }
      }
      expect(masonryWidths[0]).toBeLessThan(masonryWidths[1]!);
      expect(masonryWidths[1]).toBeLessThan(masonryWidths[2]!);
    }
    await window.setViewportSize({ width: 1280, height: 720 });

    await sizeSlider.fill("160");
    await expect(sizeSlider).toHaveValue("160");
    await canvas.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    // Scroll to top and assert first card is fully visible (not clipped at top)
    await canvas.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect
      .poll(() => canvas.evaluate((el) => el.scrollTop))
      .toBe(0);

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    const topmostCardY = await window.locator(".asset-card").evaluateAll(
      (cards) =>
        Math.min(
          ...cards.map((card) => card.getBoundingClientRect().top),
        ),
    );
    expect(topmostCardY).toBeGreaterThanOrEqual(canvasBox!.y - 1);

    // Scroll to bottom and assert last card is fully visible (not clipped at bottom)
    const scrollDimensions = await canvas.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollDimensions.scrollHeight).toBeGreaterThan(
      scrollDimensions.clientHeight,
    );
    const maxScrollTop =
      scrollDimensions.scrollHeight - scrollDimensions.clientHeight;
    await canvas.evaluate(
      (el, top) => {
        el.scrollTop = top;
      },
      maxScrollTop,
    );
    await expect
      .poll(() => canvas.evaluate((el) => el.scrollTop))
      .toBe(maxScrollTop);

    // The deepest card is not necessarily the last DOM node once assets are
    // balanced across explicit columns.  Assert the true visual bottom.
    const deepestCardBottom = await window.locator(".asset-card").evaluateAll(
      (cards) =>
        Math.max(
          ...cards.map((card) => card.getBoundingClientRect().bottom),
        ),
    );
    const canvasBottom = canvasBox!.y + canvasBox!.height;
    expect(deepestCardBottom).toBeLessThanOrEqual(canvasBottom + 1);

    // -------------------------------------------------------------------
    // 2d. No-requery on field toggle (criterion #6)
    // -------------------------------------------------------------------
    const assetSearchRequestCount = () =>
      window.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            serpent: {
              e2e: {
                getRequestCount(type: "asset.search.request"): number;
              };
            };
          }
        ).serpent.e2e.getRequestCount("asset.search.request"),
      );
    const searchRequestsBefore = await assetSearchRequestCount();

    // Toggle "文件大小" OFF
    const sizeToggle = window.getByRole("button", { name: "文件大小" });
    await sizeToggle.click();
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "false");

    await window.waitForTimeout(300);
    expect(await assetSearchRequestCount()).toBe(searchRequestsBefore);

    // -------------------------------------------------------------------
    // 2e. Narrow-window layout keeps the canvas controls visible and the
    //     workspace title on one line (Computer Use regression).
    // -------------------------------------------------------------------
    await window.setViewportSize({ width: 1054, height: 720 });
    const workspaceTitle = window.locator(".workspace-title");
    const canvasControls = window.locator(".canvas-controls");
    const workspaceBar = window.locator(".workspace-bar");
    await expect(workspaceTitle).toHaveCSS("white-space", "nowrap");
    const [controlsBox, barBox] = await Promise.all([
      canvasControls.boundingBox(),
      workspaceBar.boundingBox(),
    ]);
    expect(controlsBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(controlsBox!.x).toBeGreaterThanOrEqual(barBox!.x);
    expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(
      barBox!.x + barBox!.width + 1,
    );
    await window.setViewportSize({ width: 1280, height: 720 });

    // -------------------------------------------------------------------
    // 2f. All-scope consistency (criterion #2)
    // -------------------------------------------------------------------
    // Set distinctive prefs: masonry + name OFF
    const currentMasonry = await masonryButton.getAttribute("aria-pressed");
    if (currentMasonry !== "true") {
      await masonryButton.click();
      await expect(masonryButton).toHaveAttribute("aria-pressed", "true");
    }
    const currentName = await nameToggle.getAttribute("aria-pressed");
    if (currentName !== "false") {
      await nameToggle.click();
      await expect(nameToggle).toHaveAttribute("aria-pressed", "false");
    }

    // Helper: assert current toolbar toggle states
    async function assertToggleStates(
      masonryPressed: string,
      namePressed: string,
      sizePressed: string,
      datePressed: string,
    ) {
      await expect(
        window.getByRole("button", { name: "瀑布流视图" }),
      ).toHaveAttribute("aria-pressed", masonryPressed);
      await expect(
        window.getByRole("button", { name: "文件名" }),
      ).toHaveAttribute("aria-pressed", namePressed);
      await expect(
        window.getByRole("button", { name: "文件大小" }),
      ).toHaveAttribute("aria-pressed", sizePressed);
      await expect(
        window.getByRole("button", { name: "修改日期" }),
      ).toHaveAttribute("aria-pressed", datePressed);
    }

    async function assertHiddenFieldPresentation(
      expectDate: boolean,
      expectNameHidden = true,
    ) {
      const scopedCard = window.locator(
        `.asset-card[data-asset-id="${cardId!}"]`,
      );
      await expect(scopedCard).toBeVisible({ timeout: 10_000 });
      await expect(scopedCard).toHaveAttribute("aria-label", targetName);
      await expect(scopedCard).toHaveAttribute("title", targetName);
      if (expectNameHidden) {
        await expect(scopedCard).not.toContainText(targetName);
      }
      await expect(scopedCard).not.toContainText(`${VALID_PNG.length} B`);
      if (expectDate) {
        await expect(scopedCard.locator(".asset-caption")).toContainText(
          /\d{2}\/\d{2}/,
        );
      }
    }

    // Verify initial state on "所有资产" scope
    await assertToggleStates("true", "false", "false", "true");
    await assertHiddenFieldPresentation(true);

    // Navigate to "资源库根目录" folder scope
    await window.getByRole("button", { name: /资源库根目录/ }).click();
    await assertToggleStates("true", "false", "false", "true");
    await assertHiddenFieldPresentation(true);

    // Navigate back to 所有资产 before creating org items
    await window.getByRole("button", { name: /所有资产/ }).click();
    await assertHiddenFieldPresentation(true);

    // --- Tag scope ---
    // Create a tag and assign it to the asset
    await window.getByRole("button", { name: "添加标签" }).click();
    await window
      .getByPlaceholder("输入标签名称，回车创建")
      .fill("偏好测试标签");
    await window
      .getByPlaceholder("输入标签名称，回车创建")
      .press("Enter");
    await expect(
      window.getByRole("button", { name: /偏好测试标签/ }),
    ).toBeVisible();

    // Assign the tag via right-click context menu
    await cardById.click({ button: "right" });
    await window
      .getByRole("menuitem", { name: "添加标签：偏好测试标签" })
      .click();
    await expect(window.locator(".toast")).toContainText("标签已添加");

    // Navigate to tag scope through sidebar and verify consistency
    await window.getByRole("button", { name: /偏好测试标签/ }).click();
    await assertToggleStates("true", "false", "false", "true");
    await assertHiddenFieldPresentation(true);

    // Return to 所有资产
    await window.getByRole("button", { name: /所有资产/ }).click();
    await assertHiddenFieldPresentation(true);

    // --- Collection scope ---
    // Create a collection and add the asset to it
    await window.getByRole("button", { name: "添加合集" }).click();
    await window
      .getByPlaceholder("输入合集名称，回车创建")
      .fill("偏好测试合集");
    await window
      .getByPlaceholder("输入合集名称，回车创建")
      .press("Enter");
    await expect(
      window.getByRole("button", { name: /偏好测试合集/ }),
    ).toBeVisible();

    await cardById.click({ button: "right" });
    await window
      .getByRole("menuitem", { name: "加入合集：偏好测试合集" })
      .click();
    await expect(window.locator(".toast")).toContainText("资产已加入合集");

    // Navigate to collection scope through sidebar and verify consistency
    await window.getByRole("button", { name: /偏好测试合集/ }).click();
    await assertToggleStates("true", "false", "false", "true");
    await assertHiddenFieldPresentation(true);

    // Return to 所有资产
    await window.getByRole("button", { name: /所有资产/ }).click();
    await assertHiddenFieldPresentation(true);

    // Get the library ID for direct API calls
    const libraryId: string | null = await window.evaluate(async () => {
      const result = await (
        globalThis as unknown as {
          serpent: {
            library: {
              listOpen(): Promise<{
                ok: boolean;
                value: Array<{ libraryId: string }>;
              }>;
            };
          };
        }
      ).serpent.library.listOpen();
      return result.ok ? (result.value[0]?.libraryId ?? null) : null;
    });
    expect(libraryId).toBeTruthy();
    if (!libraryId) throw new Error("Could not determine library ID");

    const smartCollectionCreated = await window.evaluate(
      ({ libId }) =>
        (
          globalThis as unknown as {
            serpent: {
              library: {
                createSmartCollection(input: {
                  libraryId: string;
                  name: string;
                  queryDefinitionJson: string;
                }): Promise<{ ok: boolean }>;
              };
            };
          }
        ).serpent.library.createSmartCollection({
          libraryId: libId,
          name: "偏好测试智能合集",
          queryDefinitionJson: "{}",
        }),
      { libId: libraryId },
    );
    expect(smartCollectionCreated.ok).toBe(true);

    // Re-entering a normal scope refreshes organization summaries in the sidebar.
    await window.getByRole("button", { name: /资源库根目录/ }).click();
    await window.getByRole("button", { name: /所有资产/ }).click();
    await window
      .getByRole("button", { name: "偏好测试智能合集", exact: true })
      .click();
    await assertToggleStates("true", "false", "false", "true");
    await assertHiddenFieldPresentation(true);

    // Trash an asset so we can navigate to trash scope
    await window.evaluate(
      ({ libId, assetId }) =>
        (
          globalThis as unknown as {
            serpent: {
              library: {
                trashAssets(input: {
                  libraryId: string;
                  assetIds: string[];
                }): Promise<unknown>;
              };
            };
          }
        ).serpent.library.trashAssets({
          libraryId: libId,
          assetIds: [assetId],
        }),
      { libId: libraryId, assetId: cardId! },
    );

    // Navigate to trash
    await window.getByRole("button", { name: /回收站/ }).click();
    await expect(cardById).toHaveClass(/is-trashed/);
    await assertToggleStates("true", "false", "false", "true");
    // Trash cards intentionally show their former path (which includes the
    // filename) instead of date. Size visibility and accessible naming still
    // exercise real card presentation rather than toolbar state alone.
    await assertHiddenFieldPresentation(false, false);

    // Navigate back to "所有资产"
    await window.getByRole("button", { name: /所有资产/ }).click();
    // Confirm we're back with content
    await expect(
      window.getByRole("button", { name: "automatic-001.png", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // Assert toggle states still unchanged
    await assertToggleStates("true", "false", "false", "true");

    // Also verify the grid view button is NOT pressed (we're in masonry)
    await expect(
      window.getByRole("button", { name: "平铺视图" }),
    ).toHaveAttribute("aria-pressed", "false");
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
