import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import sharp from "sharp";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

test("opens a TIFF viewer image at the source resolution", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-tiff-e2e-"));
  const sourcePath = path.join(temporaryRoot, "native-resolution.tiff");
  const libraryName = "TIFF 原生分辨率验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await sharp({
      create: {
        width: 2048,
        height: 1024,
        channels: 4,
        background: { r: 46, g: 112, b: 164, alpha: 1 },
      },
    }).tiff({ compression: "none" }).toFile(sourcePath);

    const executablePath = resolveElectronExecutablePath();
    const applicationDirectory =
      process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
    application = await electron.launch({
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

    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const assetCard = window
      .locator(".asset-card")
      .filter({ hasText: "native-resolution.tiff" });
    await expect(assetCard).toBeVisible();
    const cardImage = assetCard.locator("img").first();
    await expect
      .poll(() =>
        cardImage.evaluate((image) =>
          image instanceof HTMLImageElement && image.complete
            ? { width: image.naturalWidth, height: image.naturalHeight }
            : { width: 0, height: 0 },
        ),
      )
      .toMatchObject({ width: 512 });

    await cardImage.click();
    await window.keyboard.press("Space");
    const viewer = window.getByRole("region", {
      name: "native-resolution.tiff 查看页面",
    });
    await expect(viewer).toBeVisible();
    const viewerImage = viewer.locator("img.preview-image:not(.is-hidden)");
    await expect
      .poll(() =>
        viewerImage.evaluate((image) =>
          image instanceof HTMLImageElement && image.complete
            ? { width: image.naturalWidth, height: image.naturalHeight }
            : { width: 0, height: 0 },
        ),
        { timeout: 30_000 },
      )
      .toEqual({ width: 2048, height: 1024 });
  } finally {
    if (application) {
      const childProcess = application.process();
      if (childProcess.exitCode === null) {
        await application.evaluate(({ app }) => app.quit()).catch(() => undefined);
        await Promise.race([
          once(childProcess, "exit").then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);
      }
      if (childProcess.exitCode === null) childProcess.kill("SIGKILL");
      await application.close().catch(() => undefined);
    }
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
