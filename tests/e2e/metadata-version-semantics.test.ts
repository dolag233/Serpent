import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test("does not display the metadata concurrency token as a file version", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-metadata-version-semantics-e2e-"),
  );
  const sourcePath = path.join(temporaryRoot, "metadata-version.txt");
  const libraryName = "元数据版本语义";
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(sourcePath, "metadata version semantics");

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
      SERPENT_E2E_IMPORT_FILES: sourcePath,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
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

    const assetCard = window.getByRole("button", {
      name: /metadata-version\.txt/i,
    });
    await expect(assetCard).toBeVisible();
    await assetCard.click();
    await expect(window.getByLabel("描述")).toBeVisible();
    await expect(window.locator(".inspector-version-line")).toHaveCount(0);
    await expect(window.getByText(/版本 \d/)).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
