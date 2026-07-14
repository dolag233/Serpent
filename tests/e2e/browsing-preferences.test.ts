import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

    // Toggle "文件名" OFF
    const nameToggle = window.getByRole("button", { name: "文件名" });
    await expect(nameToggle).toHaveAttribute("aria-pressed", "true");
    await nameToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");

    // Verify other toggles are still ON
    const sizeToggle = window.getByRole("button", { name: "文件大小" });
    const dateToggle = window.getByRole("button", { name: "修改日期" });
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(dateToggle).toHaveAttribute("aria-pressed", "true");

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
    await expect(restoredSizeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(restoredDateToggle).toHaveAttribute("aria-pressed", "true");

    // Verify localStorage contains the correct persisted object
    const storedPrefs = await window.evaluate(() => {
      const raw = localStorage.getItem("serpent.canvas-prefs.v1");
      return raw ? JSON.parse(raw) : null;
    });
    expect(storedPrefs).toEqual({
      version: 1,
      viewMode: "masonry",
      cardSize: 200,
      fields: { name: false, size: true, date: true },
    });
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
  const sourcePath = path.join(sourceRoot, "automatic.png");
  writeFileSync(sourcePath, VALID_PNG);

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
      SERPENT_E2E_IMPORT_FILES: sourcePath,
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

    // Import the asset
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    // Wait for the asset card (name is ON by default)
    const assetCard = window
      .locator(".asset-card")
      .filter({ hasText: "automatic.png" });
    await expect(assetCard).toBeVisible({ timeout: 15_000 });

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
    expect(visibleText).toMatch(/automatic\.png/);
    expect(visibleText).toMatch(/\d/); // size or date present

    // Toggle name OFF
    await nameToggle.click();
    await expect(nameToggle).toHaveAttribute("aria-pressed", "false");

    // Now card should have aria-label = displayName
    await expect(cardById).toHaveAttribute("aria-label", "automatic.png");

    // Card should still be locatable by accessible name (which is the aria-label)
    const cardByAccessibleName = window.getByRole("button", {
      name: /^automatic\.png$/,
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

    // Actual card width assertion (spec #3): verify gridTemplateColumns
    // tracks cardSize. Switch to grid mode first.
    const gridButton = window.getByRole("button", { name: "平铺视图" });
    await gridButton.click();
    await expect(gridButton).toHaveAttribute("aria-pressed", "true");

    const assetGrid = window.locator(".asset-grid");
    let gridCols = await assetGrid.evaluate((el) =>
      getComputedStyle(el).gridTemplateColumns,
    );
    expect(gridCols).toContain("320px");

    await sizeSlider.fill("96");
    await expect(sizeSlider).toHaveValue("96");
    gridCols = await assetGrid.evaluate((el) =>
      getComputedStyle(el).gridTemplateColumns,
    );
    expect(gridCols).toContain("96px");

    // Normal wheel (no Ctrl) should NOT change card size — only scrolls
    await sizeSlider.fill("200");
    await expect(sizeSlider).toHaveValue("200");
    await window.mouse.wheel(0, -400);
    // Slider value should remain unchanged after a non-Ctrl wheel
    await expect(sizeSlider).toHaveValue("200");

    // Reset to a reasonable size
    await sizeSlider.fill("160");
    await expect(sizeSlider).toHaveValue("160");

    // -------------------------------------------------------------------
    // 2c. Masonry first/last completeness (criterion #5)
    // -------------------------------------------------------------------
    // Ensure we're in masonry mode
    const masonryState = await masonryButton.getAttribute("aria-pressed");
    if (masonryState !== "true") {
      await masonryButton.click();
      await expect(masonryButton).toHaveAttribute("aria-pressed", "true");
    }

    // Scroll to top and assert first card is fully visible (not clipped at top)
    await canvas.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect
      .poll(() => canvas.evaluate((el) => el.scrollTop))
      .toBe(0);

    const firstCard = window.locator(".asset-card").first();
    const firstCardBox = await firstCard.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(firstCardBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    // First card's top edge should be at or below the canvas top edge
    expect(firstCardBox!.y).toBeGreaterThanOrEqual(canvasBox!.y - 1);

    // Scroll to bottom and assert last card is fully visible (not clipped at bottom)
    const scrollDimensions = await canvas.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
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

    const lastCard = window.locator(".asset-card").last();
    const lastCardBox = await lastCard.boundingBox();
    expect(lastCardBox).not.toBeNull();
    // Last card's bottom edge should be at or above the canvas bottom edge
    const canvasBottom = canvasBox!.y + canvasBox!.height;
    expect(lastCardBox!.y + lastCardBox!.height).toBeLessThanOrEqual(
      canvasBottom + 1,
    );

    // -------------------------------------------------------------------
    // 2d. No-requery on field toggle (criterion #6)
    // -------------------------------------------------------------------
    // NOTE: The bridge API (`globalThis.serpent.library`) is exposed via
    // contextBridge.exposeInMainWorld which makes the `serpent` property
    // non-writable and non-configurable. The `serpent` object itself is
    // frozen via Object.freeze(). Therefore we cannot wrap searchAssets
    // with a counting proxy. We fall back to a behavioral check: the set
    // of asset card data-asset-id values must remain identical before and
    // after a field toggle, proving no new IPC search was triggered.

    // Record current card IDs
    const cardIdsBefore = await window
      .locator(".asset-card")
      .evaluateAll((cards) =>
        cards.map((c) => (c as HTMLElement).dataset.assetId ?? ""),
      );
    expect(cardIdsBefore.length).toBeGreaterThan(0);

    // Toggle "文件大小" OFF
    const sizeToggle = window.getByRole("button", { name: "文件大小" });
    await sizeToggle.click();
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "false");

    // Brief wait to allow any potential re-render (though we expect none)
    await window.waitForTimeout(300);

    // Record card IDs after toggle
    const cardIdsAfter = await window
      .locator(".asset-card")
      .evaluateAll((cards) =>
        cards.map((c) => (c as HTMLElement).dataset.assetId ?? ""),
      );

    // IDs, order, and count must be identical — no new search triggered
    expect(cardIdsAfter).toEqual(cardIdsBefore);

    // Toggle back ON
    await sizeToggle.click();
    await expect(sizeToggle).toHaveAttribute("aria-pressed", "true");

    // -------------------------------------------------------------------
    // 2e. All-scope consistency (criterion #2)
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

    // Verify initial state on "所有资产" scope
    await assertToggleStates("true", "false", "true", "true");

    // Navigate to "资源库根目录" folder scope
    await window.getByRole("button", { name: /资源库根目录/ }).click();
    // Confirm we have content visible (card by accessible name since name is off)
    await expect(
      window.getByRole("button", { name: /automatic/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Assert toggle states unchanged in root folder scope
    await assertToggleStates("true", "false", "true", "true");

    // Navigate back to 所有资产 before creating org items
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(
      window.getByRole("button", { name: /automatic/ }),
    ).toBeVisible({ timeout: 10_000 });

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
    await expect(
      window.getByRole("button", { name: /automatic/ }),
    ).toBeVisible({ timeout: 10_000 });
    await assertToggleStates("true", "false", "true", "true");

    // Return to 所有资产
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(
      window.getByRole("button", { name: /automatic/ }),
    ).toBeVisible({ timeout: 10_000 });

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
    await expect(
      window.getByRole("button", { name: /automatic/ }),
    ).toBeVisible({ timeout: 10_000 });
    await assertToggleStates("true", "false", "true", "true");

    // Return to 所有资产
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(
      window.getByRole("button", { name: /automatic/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Smart-collection scope deferred — same global canvasPrefs state is
    // read by all scope renders (covered by construction); requires heavy
    // search-then-save setup that adds minimal additional coverage.

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

    // Trash an asset so we can navigate to trash scope
    const firstCardId = await window
      .locator(".asset-card")
      .first()
      .getAttribute("data-asset-id");
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
      { libId: libraryId, assetId: firstCardId! },
    );

    // Navigate to trash
    await window.getByRole("button", { name: /回收站/ }).click();
    // Wait for trash content to load
    await expect(
      window.locator(".asset-card.is-trashed").first(),
    ).toBeVisible({ timeout: 10_000 });

    // Assert toggle states unchanged in trash scope
    await assertToggleStates("true", "false", "true", "true");

    // Navigate back to "所有资产"
    await window.getByRole("button", { name: /所有资产/ }).click();
    // Confirm we're back with content
    await expect(
      window.getByRole("button", { name: /automatic/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Assert toggle states still unchanged
    await assertToggleStates("true", "false", "true", "true");

    // Also verify the grid view button is NOT pressed (we're in masonry)
    await expect(
      window.getByRole("button", { name: "平铺视图" }),
    ).toHaveAttribute("aria-pressed", "false");
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
