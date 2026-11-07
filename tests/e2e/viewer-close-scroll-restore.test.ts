import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

async function visibleCardId(window: Page): Promise<string> {
  const read = () => window.evaluate(() => {
    const canvas = document.querySelector(".workspace-canvas");
    if (!canvas) return "";
    const canvasBox = canvas.getBoundingClientRect();
    const card = [...document.querySelectorAll<HTMLElement>(".asset-card")].find(
      (element) => {
        const box = element.getBoundingClientRect();
        return (
          box.bottom > canvasBox.top + 8 &&
          box.top < canvasBox.bottom - 8 &&
          Boolean(element.dataset.assetId)
        );
      },
    );
    return card?.dataset.assetId ?? "";
  });
  await expect.poll(read, { timeout: 8_000 }).not.toBe("");
  const assetId = await read();
  expect(assetId).not.toBe("");
  return assetId;
}

test("closing the viewer keeps a deep browse scroll after the delayed reload", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-viewer-scroll-"));
  const sourceRoot = path.join(temporaryRoot, "sources");
  const libraryName = "查看器滚动恢复";
  mkdirSync(sourceRoot);
  const sourcePaths = Array.from({ length: 160 }, (_, index) => {
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
    await expect(
      window.getByRole("heading", { name: "导入资产以开始整理" }),
    ).toBeVisible({ timeout: 20_000 });
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();

    const canvas = window.locator(".workspace-canvas");
    await expect(window.locator(".asset-card").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => canvas.evaluate((el) => el.scrollHeight - el.clientHeight), {
        timeout: 20_000,
      })
      .toBeGreaterThan(800);

    // Non-default discovery input arms the 200ms silent search reload that
    // session logs showed writing scrollTop 0 after the viewer opened.
    await window.getByRole("button", { name: "格式", exact: true }).click();
    await window.getByLabel("格式过滤").fill("txt");
    await window.keyboard.press("Escape");
    await expect(window.locator(".workspace-canvas-host")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect
      .poll(() => canvas.evaluate((el) => el.scrollHeight - el.clientHeight), {
        timeout: 20_000,
      })
      .toBeGreaterThan(800);

    await canvas.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    });
    const beforeOpen = await canvas.evaluate((el) => el.scrollTop);
    expect(beforeOpen).toBeGreaterThan(400);

    const assetId = await visibleCardId(window);
    await window.locator(`[data-asset-id="${assetId}"]`).dblclick({ force: true });
    await expect(window.getByRole("region", { name: /查看页面/ })).toBeVisible({
      timeout: 15_000,
    });
    const escapeReturnStarted = Date.now();
    await window.keyboard.press("Escape");
    const escapePressedAt = Date.now();
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    console.info(`viewer-close bottom return: keyboard=${escapePressedAt - escapeReturnStarted}ms, reveal=${Date.now() - escapePressedAt}ms`);
    await canvas.evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop - 360);
    });
    const afterUserScroll = await canvas.evaluate((el) => el.scrollTop);
    await window.waitForTimeout(1_600);
    const afterEsc = await canvas.evaluate((el) => el.scrollTop);
    expect(afterEsc, "Esc close then delayed search must not yank to the top").toBeGreaterThan(
      beforeOpen * 0.4,
    );
    expect(
      Math.abs(afterEsc - afterUserScroll),
      "a second restore must not overwrite the user's next scroll",
    ).toBeLessThan(80);

    await canvas.evaluate((el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    });
    const beforeBack = await canvas.evaluate((el) => el.scrollTop);
    expect(beforeBack).toBeGreaterThan(400);
    const backAssetId = await visibleCardId(window);
    await window.locator(`[data-asset-id="${backAssetId}"]`).dblclick({ force: true });
    await expect(window.getByRole("region", { name: /查看页面/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(window.getByRole("button", { name: "后退" })).toBeEnabled();
    await window.getByRole("button", { name: "后退" }).click();
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await canvas.evaluate((el) => {
      el.scrollTop = Math.max(0, el.scrollTop - 360);
    });
    const afterBackUserScroll = await canvas.evaluate((el) => el.scrollTop);
    await window.waitForTimeout(1_600);
    const afterBack = await canvas.evaluate((el) => el.scrollTop);
    expect(afterBack, "Back close then delayed search must not yank to the top").toBeGreaterThan(
      beforeBack * 0.4,
    );
    expect(
      Math.abs(afterBack - afterBackUserScroll),
      "a second restore must not overwrite the user's next scroll",
    ).toBeLessThan(80);
  } finally {
    await application.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
