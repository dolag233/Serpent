import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 180_000 });

const configuredRawFixture = process.env.SERPENT_REAL_RAW_TEST_FILE;
const canRun = Boolean(
  configuredRawFixture && existsSync(configuredRawFixture),
);

test.skip(
  !canRun,
  "Set SERPENT_REAL_RAW_TEST_FILE to a real camera RAW file to run this evidence test.",
);

test("imports a real RAW file, renders its metadata, and opens its preview", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-raw-e2e-"));
  const sourcePath = path.join(
    temporaryRoot,
    path.basename(configuredRawFixture!),
  );
  const libraryName = "真实 RAW 预览验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  copyFileSync(configuredRawFixture!, sourcePath);

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
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const assetCard = window
      .locator(".asset-card")
      .filter({ hasText: path.basename(sourcePath) });
    await expect(assetCard).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          assetCard.locator("img").evaluate((image) => {
            if (!(image instanceof HTMLImageElement)) return false;
            return image.complete && image.naturalWidth > 0;
          }),
        { timeout: 60_000 },
      )
      .toBe(true);

    await assetCard.click();
    const details = window.getByLabel("技术元数据");
    await expect(details).toBeVisible({ timeout: 30_000 });
    await expect(details).toContainText("ILCE-7RM3");
    await expect(details).toContainText("SONY");
    await expect(details).toContainText("ISO-800");
    await expect(window.getByRole("textbox", { name: "作者" })).not.toHaveValue("");

    await window.keyboard.press("Space");
    const viewer = window.getByRole("region", {
      name: `${path.basename(sourcePath)} 查看页面`,
    });
    await expect(viewer).toBeVisible();
    await expect
      .poll(
        () =>
          viewer.locator("img.preview-image:not(.is-hidden)").evaluate((image) => {
            if (!(image instanceof HTMLImageElement)) return 0;
            return image.complete ? image.naturalWidth : 0;
          }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(512);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
