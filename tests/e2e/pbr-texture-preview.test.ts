import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type Locator,
} from "@playwright/test";
import sharp from "sharp";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

async function expectImageDecoded(
  image: Locator,
) {
  await expect
    .poll(
      () =>
        image.evaluate((element) => {
          if (!(element instanceof HTMLImageElement)) return false;
          return (
            element.complete &&
            element.naturalWidth > 0 &&
            element.naturalHeight > 0
          );
        }),
      {
        message: "PBR channel preview must decode the source image",
        timeout: 15_000,
      },
    )
    .toBe(true);
}

test("identifies the PBR channel matrix with read-only display modes", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-pbr-channel-e2e-"),
  );
  const fixtures = [
    {
      channel: "base-color",
      fileName: "character_basecolor.png",
      filter: "none",
      label: "基础色",
    },
    {
      channel: "normal",
      fileName: "character_normal.png",
      filter: "none",
      label: "法线",
    },
    {
      channel: "roughness",
      fileName: "character_roughness.png",
      filter: "grayscale(1)",
      label: "粗糙度",
    },
    {
      channel: "smoothness",
      fileName: "character_smoothness.png",
      filter: "grayscale(1) invert(1)",
      label: "光滑度",
    },
    {
      channel: "metallic",
      fileName: "character_metallic.png",
      filter: "grayscale(1)",
      label: "金属度",
    },
    {
      channel: "height",
      fileName: "character_displacement.png",
      filter: "grayscale(1)",
      label: "高度/置换",
    },
    {
      channel: "metallic-roughness",
      fileName: "character_metallicRoughness.png",
      filter: "none",
      label: "金属度 + 粗糙度",
    },
  ] as const;
  const sourcePaths = fixtures.map(({ fileName }) =>
    path.join(temporaryRoot, fileName),
  );
  const libraryName = "PBR 通道预览验收";
  const libraryPath = path.join(temporaryRoot, libraryName);

  for (const [index, sourcePath] of sourcePaths.entries()) {
    await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 4,
        background: {
          r: 32 + index * 24,
          g: 64 + index * 16,
          b: 96 + index * 12,
          alpha: 1,
        },
      },
    })
      .png()
      .toFile(sourcePath);
  }

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
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window
      .getByRole("button", { name: "创建", exact: true })
      .click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    for (const fixture of fixtures) {
      const assetCard = window
        .locator(".asset-card")
        .filter({ hasText: fixture.fileName });
      await expect(assetCard).toBeVisible({ timeout: 15_000 });
      await assetCard.dblclick();

      const preview = window.getByRole("region", {
        name: `${fixture.fileName} 查看页面`,
      });
      await expect(preview).toBeVisible();
      const image = preview.locator("img.preview-image");
      await expectImageDecoded(image);
      await expect(image).toHaveAttribute(
        "data-pbr-channel",
        fixture.channel,
      );
      await expect
        .poll(() =>
          image.evaluate((element) => getComputedStyle(element).filter),
        )
        .toBe(fixture.filter);
      await expect(
        preview.locator(".preview-pbr-channel-notice"),
      ).toContainText(fixture.label);
      await window.keyboard.press("Escape");
      await expect(preview).toBeHidden();
    }
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
