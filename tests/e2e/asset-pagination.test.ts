import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

test("ordinary browsing continuously appends every asset without page controls", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-pagination-e2e-"),
  );
  const sourceRoot = path.join(temporaryRoot, "sources");
  const libraryName = "分页验收";
  const assetCount = 73;
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
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window.getByRole("button", { name: "添加文件夹" }).click();
    await window.getByLabel("名称").fill("分页文件夹");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "分页文件夹", exact: true })
      .click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    await expect(window.locator(".asset-card")).toHaveCount(73);
    await expect(window.getByRole("button", { name: "上一页" })).toHaveCount(0);
    await expect(window.getByRole("button", { name: "下一页" })).toHaveCount(0);
    await window
      .locator(".workspace-canvas")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await expect(
      window.getByText("asset-050.txt", { exact: true }),
    ).toBeVisible();
    await expect(
      window.getByText("asset-000.txt", { exact: true }),
    ).toHaveCount(1);

    const sizeControl = window.getByLabel("资产缩略图大小");
    await sizeControl.fill("160");
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
    await window.getByLabel("资产缩略图大小").fill("96");
    const initialWidth = (await firstCard.boundingBox())!.width;
    await window.getByLabel("资产缩略图大小").fill("320");
    await expect
      .poll(async () => (await firstCard.boundingBox())!.width)
      .toBeGreaterThan(initialWidth);
    await window.getByRole("button", { name: "瀑布流视图" }).click();
    await expect(window.locator(".asset-grid")).toHaveClass(/is-masonry/);
    await window
      .locator(".workspace-canvas")
      .evaluate((element) => element.scrollTo(0, 0));
    const [canvasBox, masonryFirstBox] = await Promise.all([
      window.locator(".workspace-canvas").boundingBox(),
      firstCard.boundingBox(),
    ]);
    expect(masonryFirstBox!.y).toBeGreaterThanOrEqual(canvasBox!.y - 1);
    await window
      .locator(".workspace-canvas")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    const masonryLastBox = await window
      .locator(".asset-card")
      .last()
      .boundingBox();
    const canvasBottomBox = await window
      .locator(".workspace-canvas")
      .boundingBox();
    expect(masonryLastBox!.y + masonryLastBox!.height).toBeLessThanOrEqual(
      canvasBottomBox!.y + canvasBottomBox!.height + 1,
    );
    await window.getByRole("button", { name: "平铺视图" }).click();
    await expect(window.locator(".asset-grid")).toHaveClass(/is-grid/);

    await window.getByText("asset-000.txt", { exact: true }).dblclick();
    const unsupportedViewer = window.getByRole("region", {
      name: "asset-000.txt 查看页面",
    });
    await expect(unsupportedViewer.getByText("不支持内置预览")).toBeVisible();
    await expect(
      unsupportedViewer.getByRole("button", { name: "重试生成" }),
    ).toHaveCount(0);
    await expect(
      unsupportedViewer.getByRole("button", { name: "使用外部应用打开" }),
    ).toBeVisible();
    await unsupportedViewer
      .getByRole("button", { name: "关闭查看页面" })
      .click();

    // Switching to a browse scope explicitly clears lingering discovery
    // controls, so page 1 and subsequent pages cannot use different queries.
    await window.getByText("筛选与排序", { exact: true }).click();
    await window.getByLabel("格式过滤").fill("png");
    await expect(window.locator(".asset-card")).toHaveCount(0);
    await window
      .getByRole("button", { name: "分页文件夹", exact: true })
      .click();
    await expect(window.getByLabel("格式过滤")).toHaveValue("");
    await expect(window.locator(".asset-card")).toHaveCount(73);

    // Every scope uses the same continuous loading model, while the managed
    // root remains distinct rather than leaking folder or linked assets.
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await window
      .getByRole("button", { name: "资源库根目录", exact: true })
      .click();
    await expect(window.locator(".asset-card")).toHaveCount(0);
    await expect(
      window.getByRole("heading", { name: "把第一批素材放进来" }),
    ).toBeVisible();

    const setup = await window.evaluate(async () => {
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
      if (
        !listed.ok ||
        assetIds.length !== 73 ||
        !tag.ok ||
        !tag.value ||
        !collection.ok ||
        !collection.value
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
      if (
        !(
          await serpent.library.addCollectionAssets({
            libraryId,
            collectionId: collection.value.collectionId,
            assetIds,
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
            queryDefinitionJson: "{}",
          })
        ).ok
      ) {
        throw new Error("Could not create smart collection fixture.");
      }
      return { assetIds, libraryId };
    });

    // Re-entering a normal scope refreshes sidebar organization data.
    await window.getByRole("button", { name: /所有资产/ }).click();
    await window.getByLabel("格式过滤").fill("png");
    await expect(window.locator(".asset-card")).toHaveCount(0);
    await window.getByRole("button", { name: /分页合集/ }).click();
    await expect(window.getByLabel("格式过滤")).toHaveValue("");
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await window.getByRole("button", { name: /分页标签/ }).click();
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await window
      .locator(".workspace-canvas")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await window.getByRole("button", { name: /分页合集/ }).click();
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await window
      .locator(".workspace-canvas")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await window
      .getByRole("button", { name: "分页智能合集", exact: true })
      .click();
    await expect(window.locator(".asset-card")).toHaveCount(73);

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
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await window
      .locator(".workspace-canvas")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(window.locator(".asset-card")).toHaveCount(73);
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(window.locator(".asset-card")).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
