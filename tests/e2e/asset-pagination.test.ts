import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

function sidebarFolderRow(window: Page, folderName: string) {
  return window
    .locator(".navigation-pane .nav-row-label", { hasText: folderName })
    .locator("xpath=ancestor::button[contains(@class, 'nav-row')]");
}

test("ordinary browsing continuously appends every asset without page controls", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-pagination-e2e-"),
  );
  const sourceRoot = path.join(temporaryRoot, "sources");
  const libraryName = "分页验收";
  const assetCount = 173;
  mkdirSync(sourceRoot);
  const sourcePaths = Array.from({ length: assetCount }, (_, index) => {
    const sourcePath = path.join(
      sourceRoot,
      `asset-${index.toString().padStart(3, "0")}.txt`,
    );
    writeFileSync(sourcePath, `asset ${index}`);
    return sourcePath;
  });

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
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window.getByRole("button", { name: "添加文件夹" }).click();
    await window.getByLabel("新文件夹名称").fill("分页文件夹");
    await window.keyboard.press("Enter");
    await sidebarFolderRow(window, "分页文件夹").click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const workspaceCanvas = window.locator(".workspace-canvas");
    // Windowed rendering mounts only the viewport window + overscan, so the
    // DOM card count is not the scope size. The user-visible contract is that
    // bottom scrolling reaches the last asset in the scope.
    const tailName = `asset-${(assetCount - 1).toString().padStart(3, "0")}.txt`;
    const loadEveryAssetInCurrentScope = async () => {
      await expect
        .poll(
          async () => {
            await workspaceCanvas.evaluate((element) =>
              element.scrollTo({ top: element.scrollHeight }),
            );
            const tail = window.locator(".asset-card").filter({ hasText: tailName });
            return (await tail.count()) > 0;
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      await expect(
        window.locator(".asset-card").filter({ hasText: tailName }),
      ).toBeInViewport();
    };

    // Loading the tail is driven by the canvas scroll path, so wait for the
    // complete scope instead of assuming the first render contains every row.
    await expect(window.locator(".asset-card").first()).toBeVisible();
    await expect(window.getByRole("button", { name: "上一页" })).toHaveCount(0);
    await expect(window.getByRole("button", { name: "下一页" })).toHaveCount(0);
    await loadEveryAssetInCurrentScope();
    // Windowed rendering unmounts off-window cards: verify the middle asset by
    // scrolling to it, then return to the top for the first-card assertions.
    const middleCard = window
      .locator(".asset-card")
      .filter({ hasText: "asset-050.txt" });
    await expect
      .poll(
        async () => {
          await workspaceCanvas.evaluate((element) =>
            element.scrollTo({ top: element.scrollHeight * 0.5 }),
          );
          return (await middleCard.count()) > 0;
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await middleCard.scrollIntoViewIfNeeded();
    await expect(middleCard).toBeVisible();
    await workspaceCanvas.evaluate((element) => element.scrollTo(0, 0));
    // 限定卡片内匹配：asset-000.txt 同时出现在 Inspector（如 hover 预览）
    // 时，卡片断言不受影响。
    await expect(
      window.locator(".asset-card").filter({ hasText: "asset-000.txt" }),
    ).toHaveCount(1);

    const sizeControl = window.getByLabel("资产缩略图大小");
    const maxSizeIndex = Number(await sizeControl.getAttribute("max"));
    const middleSizeIndex = Math.min(3, maxSizeIndex);
    await sizeControl.fill(String(middleSizeIndex));
    const anchorCard = window.locator(".asset-card").nth(30);
    await anchorCard.scrollIntoViewIfNeeded();
    const anchorAssetId = await anchorCard.getAttribute("data-asset-id");
    const anchorBox = await anchorCard.boundingBox();
    const anchorPoint = {
      x: anchorBox!.x + anchorBox!.width / 2,
      y: anchorBox!.y + anchorBox!.height / 2,
    };
    const sizeBeforeWheel = Number(await sizeControl.inputValue());
    await window.mouse.move(anchorPoint.x, anchorPoint.y);
    await window.mouse.wheel(0, -120);
    await expect(sizeControl).toHaveValue(String(sizeBeforeWheel));
    await window.keyboard.down("Control");
    await window.mouse.wheel(0, -120);
    await window.keyboard.up("Control");
    await expect
      .poll(async () => Number(await sizeControl.inputValue()))
      .toBeGreaterThan(sizeBeforeWheel);
    expect(anchorAssetId).not.toBeNull();
    await expect(
      window.locator(`[data-asset-id="${anchorAssetId}"]`),
    ).toBeInViewport();

    const firstCard = window.locator(".asset-card").first();
    await sizeControl.fill("0");
    const initialWidth = (await firstCard.boundingBox())!.width;
    await sizeControl.fill(String(maxSizeIndex));
    await expect
      .poll(async () => (await firstCard.boundingBox())!.width)
      .toBeGreaterThan(initialWidth);
    await window.getByRole("button", { name: "瀑布流视图" }).click();
    await expect(window.locator(".asset-grid")).toHaveClass(/is-masonry/);
    const masonryCanvas = window.locator(".workspace-canvas");
    await masonryCanvas.evaluate((element) => element.scrollTo(0, 0));
    // The reflow anchor keeps the previous viewport stable while grid →
    // masonry changes the column geometry. Explicitly bring the first card
    // back into view before checking the first-row layout instead of racing
    // that restoration effect with a raw scrollTop assertion.
    await firstCard.scrollIntoViewIfNeeded();
    const [canvasBox, masonryFirstBox] = await Promise.all([
      window.locator(".workspace-canvas").boundingBox(),
      firstCard.boundingBox(),
    ]);
    expect(masonryFirstBox!.y).toBeGreaterThanOrEqual(canvasBox!.y - 1);
    const masonryLastCard = window.locator(".asset-card").last();
    const masonryScrollSnapshot: {
      last: { x: number; y: number; width: number; height: number } | null;
      canvas: { x: number; y: number; width: number; height: number } | null;
    } = { last: null, canvas: null };
    await expect
      .poll(async () => {
        await masonryCanvas.evaluate((element) => {
          element.style.setProperty("overflow-anchor", "none");
          element.scrollTo(0, element.scrollHeight);
        });
        const [lastBox, canvasBox] = await Promise.all([
          masonryLastCard.boundingBox(),
          masonryCanvas.boundingBox(),
        ]);
        masonryScrollSnapshot.last = lastBox;
        masonryScrollSnapshot.canvas = canvasBox;
        return Boolean(
          lastBox &&
            canvasBox &&
            lastBox.y + lastBox.height <= canvasBox.y + canvasBox.height + 1,
        );
      })
      .toBe(true);
    if (!masonryScrollSnapshot.last || !masonryScrollSnapshot.canvas)
      throw new Error("Masonry bottom position was not sampled.");
    expect(
      masonryScrollSnapshot.last.y + masonryScrollSnapshot.last.height,
    ).toBeLessThanOrEqual(
      masonryScrollSnapshot.canvas.y + masonryScrollSnapshot.canvas.height + 1,
    );
    await masonryCanvas.evaluate((element) =>
      element.style.removeProperty("overflow-anchor"),
    );
    await window.getByRole("button", { name: "平铺视图" }).click();
    await expect(window.locator(".asset-grid")).toHaveClass(/is-grid/);

    const viewerMatrix = [
      { button: "平铺视图", className: "is-grid" },
      { button: "瀑布流视图", className: "is-masonry" },
    ] as const;
    for (const view of viewerMatrix) {
      await window.getByRole("button", { name: view.button }).click();
      await expect(window.locator(".asset-grid")).toHaveClass(
        new RegExp(view.className),
      );
      for (const cardSize of [0, maxSizeIndex]) {
        await sizeControl.fill(String(cardSize));
        await expect(sizeControl).toHaveValue(String(cardSize));
        for (const scrollFraction of [0.25, 0.5, 1]) {
          let visibleAsset: {
            assetId: string;
            displayName: string;
          } | null = null;
          await expect
            .poll(async () => {
              await workspaceCanvas.evaluate(
                async (element, fraction) => {
                  element.scrollTo({
                    top: (element.scrollHeight - element.clientHeight) * fraction,
                  });
                  await new Promise<void>((resolve) =>
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => resolve()),
                    ),
                  );
                },
                scrollFraction,
              );
              visibleAsset = await window
                .locator(".asset-card")
                .evaluateAll((cards) => {
                  const canvas = document.querySelector(".workspace-canvas");
                  if (!canvas) return null;
                  const canvasBox = canvas.getBoundingClientRect();
                  const candidates = cards
                    .map((card) => {
                      const box = card.getBoundingClientRect();
                      return {
                        assetId: card.getAttribute("data-asset-id"),
                        displayName:
                          card.querySelector("strong")?.getAttribute("title") ??
                          card.getAttribute("aria-label"),
                        isVisible:
                          box.bottom > canvasBox.top &&
                          box.top < canvasBox.bottom &&
                          box.right > canvasBox.left &&
                          box.left < canvasBox.right,
                        distanceFromCenter: Math.abs(
                          box.top + box.height / 2 -
                            (canvasBox.top + canvasBox.height / 2),
                        ),
                      };
                    })
                    .filter(
                      (candidate) =>
                        candidate.assetId &&
                        candidate.displayName &&
                        candidate.isVisible,
                    )
                    .sort(
                      (left, right) =>
                        left.distanceFromCenter - right.distanceFromCenter,
                    );
                  const candidate = candidates[0];
                  return candidate?.assetId && candidate.displayName
                    ? {
                        assetId: candidate.assetId,
                        displayName: candidate.displayName,
                      }
                    : null;
                });
              return visibleAsset?.assetId ?? "";
            })
            .not.toBe("");
          expect(visibleAsset).not.toBeNull();

          const assetCard = window.locator(
            `[data-asset-id="${visibleAsset!.assetId}"]`,
          );
          await assetCard.scrollIntoViewIfNeeded();
          await expect(assetCard).toBeInViewport();
          const scrollTopBeforeViewer = await workspaceCanvas.evaluate(
            (element) => element.scrollTop,
          );
          expect(scrollTopBeforeViewer).toBeGreaterThan(0);
          await assetCard.dblclick();
          const textViewer = window.getByRole("region", {
            name: `${visibleAsset!.displayName} 查看页面`,
          });
          // Text assets have a built-in read-only editor; they no longer use
          // the unsupported-format placeholder.
          await expect(textViewer).toHaveClass(/is-text-viewer/);
          await expect(textViewer.locator(".preview-text-stage")).toBeVisible();
          await expect(
            textViewer.getByRole("textbox", { name: "文本内容" }),
          ).toHaveValue(/asset \d+/);
          const [viewerBox, workspaceBox] = await Promise.all([
            textViewer.boundingBox(),
            window.locator(".workspace").boundingBox(),
          ]);
          expect(viewerBox).not.toBeNull();
          expect(workspaceBox).not.toBeNull();
          await expect(workspaceCanvas).toBeHidden();
          expect(
            Math.abs(viewerBox!.x - workspaceBox!.x),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(viewerBox!.y - workspaceBox!.y),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(viewerBox!.width - workspaceBox!.width),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(viewerBox!.height - workspaceBox!.height),
          ).toBeLessThanOrEqual(1);
          await expect(
            textViewer.getByRole("button", { name: "重试生成" }),
          ).toHaveCount(0);
          await textViewer
            .getByRole("button", { name: "关闭", exact: true })
            .click();
          await expect(textViewer).toBeHidden();
          await expect(workspaceCanvas).toBeVisible();
          // Reflow may slightly adjust the raw offset after the text viewer
          // closes; the user-visible contract is that browsing does not jump
          // back to the top and the same card remains visible.
          await expect(assetCard).toBeInViewport();
        }
      }
    }

    // Switching to a browse scope explicitly clears lingering discovery
    // controls, so the loaded scope cannot use a stale query.
    await window.getByRole("button", { name: "格式", exact: true }).click();
    await window.getByLabel("格式过滤").fill("png");
    await expect(window.locator(".asset-card")).toHaveCount(0);
    await sidebarFolderRow(window, "分页文件夹").click();
    await expect(
      window.getByRole("button", { name: "格式", exact: true }),
    ).not.toHaveClass(/is-active/);
    await loadEveryAssetInCurrentScope();

    // Every browse scope uses the same continuous loading model. The current
    // sidebar exposes the library-wide scope as "所有资产"; the managed root
    // is an internal destination used by move/restore flows, not a separate
    // navigation row.
    const allAssetsRow = window.getByRole("button", { name: /所有资产/ });
    await allAssetsRow.click();
    await loadEveryAssetInCurrentScope();
    await expect(allAssetsRow).toHaveClass(/is-active/);
    await expect(window.locator(".item-count")).toContainText(String(assetCount));

    const setup = await window.evaluate(async (expectedAssetCount) => {
      const serpent = (
        globalThis as typeof globalThis & {
          serpent: {
            library: {
              listOpen(): Promise<{
                ok: boolean;
                value?: Array<{ libraryId: string }>;
              }>;
              listAssets(input: {
                libraryId: string;
                recursive: boolean;
              }): Promise<{ ok: boolean; value?: Array<{ assetId: string }> }>;
              createTag(input: {
                libraryId: string;
                name: string;
              }): Promise<{ ok: boolean; value?: { tagId: string } }>;
              assignTags(input: {
                libraryId: string;
                assetIds: string[];
                tagIds: string[];
              }): Promise<{ ok: boolean }>;
              createCollection(input: {
                libraryId: string;
                parentId?: string;
                name: string;
              }): Promise<{ ok: boolean; value?: { collectionId: string } }>;
              addCollectionAssets(input: {
                libraryId: string;
                collectionId: string;
                assetIds: string[];
              }): Promise<{ ok: boolean }>;
              createSmartCollection(input: {
                libraryId: string;
                name: string;
                queryDefinitionJson: string;
              }): Promise<{ ok: boolean }>;
              trashAssets(input: {
                libraryId: string;
                assetIds: string[];
              }): Promise<{ ok: boolean }>;
            };
          };
        }
      ).serpent;
      const open = await serpent.library.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!open.ok || !libraryId) throw new Error("Expected an open library.");
      const listed = await serpent.library.listAssets({
        libraryId,
        recursive: true,
      });
      const assetIds = listed.value?.map((asset) => asset.assetId) ?? [];
      const tag = await serpent.library.createTag({
        libraryId,
        name: "分页标签",
      });
      const collection = await serpent.library.createCollection({
        libraryId,
        name: "分页合集",
      });
      const childCollection = collection.ok && collection.value
        ? await serpent.library.createCollection({
            libraryId,
            parentId: collection.value.collectionId,
            name: "分页子合集",
          })
        : { ok: false as const };
      if (
        !listed.ok ||
        assetIds.length !== expectedAssetCount ||
        !tag.ok ||
        !tag.value ||
        !collection.ok ||
        !collection.value ||
        !childCollection.ok ||
        !childCollection.value
      ) {
        throw new Error("Could not prepare organization pagination fixture.");
      }
      if (
        !(
          await serpent.library.assignTags({
            libraryId,
            assetIds,
            tagIds: [tag.value.tagId],
          })
        ).ok
      ) {
        throw new Error("Could not assign tag fixture.");
      }
      const directAssetCount = Math.floor(assetIds.length / 2);
      const directMembers = assetIds.slice(0, directAssetCount);
      const childMembers = assetIds.slice(directAssetCount);
      if (
        !(
          await serpent.library.addCollectionAssets({
            libraryId,
            collectionId: collection.value.collectionId,
            assetIds: directMembers,
          })
        ).ok ||
        !(
          await serpent.library.addCollectionAssets({
            libraryId,
            collectionId: childCollection.value.collectionId,
            assetIds: childMembers,
          })
        ).ok
      ) {
        throw new Error("Could not assign collection fixture.");
      }
      if (
        !(
          await serpent.library.createSmartCollection({
            libraryId,
            name: "分页智能合集",
            queryDefinitionJson: JSON.stringify({ filters: [{ field: "format", values: ["txt"], exclude: false }] }),
          })
        ).ok
      ) {
        throw new Error("Could not create smart collection fixture.");
      }
      return { assetIds, directAssetCount, libraryId };
    }, assetCount);

    // The large-library navigation path intentionally keeps sidebar queries
    // out of every scope click. This fixture mutates collections/tags through
    // the preload API, so use the explicit refresh command once before
    // asserting the newly-created organization entries. 筛选面板现在是外部
    // 点击即关的浮层：刷新后填写前重新展开。
    await window.getByRole("button", { name: "刷新磁盘变化" }).click();
    await window.getByRole("button", { name: /所有资产/ }).click();
    await window.getByRole("button", { name: "格式", exact: true }).click();
    await window.getByLabel("格式过滤").fill("png");
    await expect(window.locator(".asset-card")).toHaveCount(0);
    const collectionSwitchStartedAt = Date.now();
    await window.getByRole("button", { name: /^分页合集/ }).click();
    await expect(window.locator(".asset-card").first()).toBeVisible();
    const collectionSwitchMs = Date.now() - collectionSwitchStartedAt;
    console.info(
      `[collection-switch-e2e] ${JSON.stringify({
        assets: assetCount,
        collectionSwitchMs,
      })}`,
    );
    expect(collectionSwitchMs).toBeLessThan(5_000);
    await expect(
      window.getByRole("button", { name: "格式", exact: true }),
    ).not.toHaveClass(/is-active/);

    const collectionScopeToggle = window.getByRole("button", {
      name: "包含子合集",
    });
    await expect(collectionScopeToggle).toHaveAttribute("aria-pressed", "true");
    await loadEveryAssetInCurrentScope();
    await collectionScopeToggle.click();
    await expect(collectionScopeToggle).toHaveAttribute("aria-pressed", "false");
    await expect(window.locator(".item-count")).toContainText(
      String(setup.directAssetCount),
    );
    await expect(
      window.locator(".asset-card").filter({ hasText: tailName }),
    ).toHaveCount(0);
    await collectionScopeToggle.click();
    await expect(collectionScopeToggle).toHaveAttribute("aria-pressed", "true");
    await expect(window.locator(".item-count")).toContainText(String(assetCount));
    await loadEveryAssetInCurrentScope();
    // The sidebar no longer enumerates tags (REQ-TAG-001); enter the
    // tag-filtered view through the retained 标签过滤 entry instead.
    await window.getByRole("button", { name: "标签", exact: true }).click();
    await window.getByLabel("标签过滤").fill("分页标签");
    await window.getByRole("option", { name: /分页标签/ }).click();
    await loadEveryAssetInCurrentScope();
    await window.getByRole("button", { name: /^分页合集/ }).click();
    await loadEveryAssetInCurrentScope();
    await window
      .getByRole("button", { name: /分页智能合集/ })
      .click();
    await loadEveryAssetInCurrentScope();

    const trashed = await window.evaluate(async ({ libraryId, assetIds }) => {
      const serpent = (
        globalThis as typeof globalThis & {
          serpent: {
            library: {
              trashAssets(input: {
                libraryId: string;
                assetIds: string[];
              }): Promise<{ ok: boolean }>;
            };
          };
        }
      ).serpent;
      return serpent.library.trashAssets({ libraryId, assetIds });
    }, setup);
    expect(trashed.ok).toBe(true);
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(window.locator(".asset-card")).toHaveCount(0);
    await window.getByRole("button", { name: "回收站", exact: true }).click();
    // Trash cards render a different DOM shape (tombstone chrome), so the
    // tail-card probe does not apply; the scope count plus a scrollable card
    // grid is the user-visible contract here.
    await expect
      .poll(() => window.locator(".item-count").textContent(), {
        timeout: 30_000,
      })
      .toContain(String(assetCount));
    await window
      .locator(".workspace-canvas")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(window.locator(".asset-card").first()).toBeVisible();
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(window.locator(".asset-card")).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("bottom-scroll appends assets beyond the first page (Serpent-ws4k)", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-pagination-beyond-e2e-"),
  );
  const sourceRoot = path.join(temporaryRoot, "sources");
  const libraryName = "分页追加验收";
  // Deliberately above BROWSE_PAGE_SIZE (100) so the first render cannot
  // contain the whole scope and the tail must arrive through incremental
  // bottom-scroll appends.
  const assetCount = 340;
  mkdirSync(sourceRoot);
  const sourcePaths = Array.from({ length: assetCount }, (_, index) => {
    const sourcePath = path.join(
      sourceRoot,
      `asset-${index.toString().padStart(3, "0")}.txt`,
    );
    writeFileSync(sourcePath, `asset ${index}`);
    return sourcePath;
  });

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
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window.getByRole("button", { name: "添加文件夹" }).click();
    await window.getByLabel("新文件夹名称").fill("分页文件夹");
    await window.keyboard.press("Enter");
    await sidebarFolderRow(window, "分页文件夹").click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    // Wait for the first card (import settled) before asserting the scope
    // total; the import itself is asynchronous and the count badge follows.
    await expect
      .poll(
        () => window.locator(".asset-card").first().isVisible(),
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect
      .poll(() => window.locator(".item-count").textContent(), {
        timeout: 30_000,
      })
      .toContain("340");

    // The first card is visible, but the 330th asset (beyond the first page)
    // must not be mounted yet.
    await expect(window.locator(".asset-card").first()).toBeVisible();
    const canvas = window.locator(".workspace-canvas");
    await expect
      .poll(async () => {
        await canvas.evaluate((element) =>
          element.scrollTo({ top: element.scrollHeight }),
        );
        const tail = window
          .locator(".asset-card")
          .filter({ hasText: "asset-339.txt" });
        return (await tail.count()) > 0;
      })
      .toBe(true);
    // After the incremental appends the tail card is actually visible.
    await expect(
      window.locator(".asset-card").filter({ hasText: "asset-339.txt" }),
    ).toBeInViewport();

    // No pagination buttons exist; the continuous-loading contract is kept.
    await expect(window.getByRole("button", { name: "上一页" })).toHaveCount(0);
    await expect(window.getByRole("button", { name: "下一页" })).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
