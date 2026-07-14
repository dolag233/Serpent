import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type Locator,
} from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function expectImageDecoded(image: Locator) {
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
        message:
          "expected the image resource to decode, not merely render a visible <img>",
        timeout: 15_000,
      },
    )
    .toBe(true);
}

test("generates a decoded thumbnail and keeps asset viewer context coherent", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-auto-thumbnail-e2e-"),
  );
  const sourcePath = path.join(temporaryRoot, "automatic.png");
  const nextSourcePath = path.join(temporaryRoot, "next-automatic.png");
  const libraryName = "自动缩略图验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(sourcePath, VALID_PNG);
  writeFileSync(nextSourcePath, VALID_PNG);

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
      SERPENT_E2E_IMPORT_FILES: [sourcePath, nextSourcePath].join(
        path.delimiter,
      ),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const assetCard = window
      .locator(".asset-card")
      .filter({ hasText: "automatic.png" })
      .filter({ hasNotText: "next-automatic.png" });
    await expect(assetCard).toBeVisible();
    const thumbnail = assetCard.locator('img[alt="automatic.png"]');
    await expect(thumbnail).toBeVisible({ timeout: 15_000 });
    await expectImageDecoded(thumbnail);
    expect(
      await thumbnail.evaluate((image) => getComputedStyle(image).objectFit),
    ).toBe("contain");

    await assetCard.click();
    await expect(assetCard).toHaveAttribute("aria-pressed", "true");
    await expect(window.getByText("色卡 (Palette) · 自动")).toBeVisible({
      timeout: 15_000,
    });
    await expect(window.getByLabel("自动色卡预览").locator("span")).toHaveCount(
      1,
    );
    await window.keyboard.press("Space");
    const preview = window.getByRole("region", {
      name: "automatic.png 查看页面",
    });
    await expect(preview).toBeVisible();
    await expect(preview).toBeAttached({ attached: true });
    await expect(window.locator(".workspace > .workspace-viewer")).toHaveCount(
      1,
    );
    await expect(
      window.locator(".workspace-canvas").locator(".workspace-viewer"),
    ).toHaveCount(0);
    await expect(window.locator(".inspector-pane")).toBeVisible();
    await expect(
      window.getByRole("button", { name: "导入文件", exact: true }).first(),
    ).toBeHidden();
    await expectImageDecoded(preview.locator("img.preview-image"));
    await preview.locator(".preview-image-viewport").hover();
    await window.mouse.wheel(0, -200);
    await expect(preview.locator("img.preview-image")).toHaveAttribute(
      "style",
      /scale\(1\)/,
    );
    await window.keyboard.down("Control");
    await window.mouse.wheel(0, -400);
    await window.keyboard.up("Control");
    await expect
      .poll(() =>
        preview
          .locator("img.preview-image")
          .evaluate((image) => image.style.transform),
      )
      .not.toContain("scale(1)");
    await window.keyboard.press("ArrowRight");
    const nextPreview = window.getByRole("region", {
      name: "next-automatic.png 查看页面",
    });
    await expectImageDecoded(nextPreview.locator("img.preview-image"));
    const nextAssetCard = window
      .locator(".asset-card")
      .filter({ hasText: "next-automatic.png" });
    await expect(nextAssetCard).toHaveAttribute("aria-pressed", "true");
    await expect(assetCard).toHaveAttribute("aria-pressed", "false");
    await expect(
      window
        .getByText("当前选择", { exact: true })
        .locator("..")
        .getByText("next-automatic.png", { exact: true }),
    ).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(nextPreview).toBeHidden();
    await expect(nextAssetCard).toHaveAttribute("aria-pressed", "true");
    await expect(nextAssetCard).toBeFocused();

    const masonryViewButton = window.locator(
      'button[aria-label="瀑布流视图"]',
    );
    await expect(masonryViewButton).toHaveAttribute("aria-pressed", "false");
    await masonryViewButton.focus();
    await window.keyboard.press("Space");
    await expect(nextPreview).toBeHidden();
    await expect(masonryViewButton).toHaveAttribute("aria-pressed", "true");

    await nextAssetCard.dblclick();
    await expect(nextPreview).toBeVisible();

    // Reopening exercises the persisted-artifact path used by an existing library.
    await window.getByRole("button", { name: "关闭资源库" }).click();
    await expect(nextPreview).toBeHidden();
    await window
      .getByRole("button", { name: "打开资源库", exact: true })
      .click();
    const reopenedCard = window.getByRole("button", {
      name: /^automatic\.png\s/,
    });
    await expect(reopenedCard).toBeVisible();
    await expectImageDecoded(reopenedCard.locator('img[alt="automatic.png"]'));
    await reopenedCard.dblclick();
    await expectImageDecoded(
      window
        .getByRole("region", { name: "automatic.png 查看页面" })
        .locator("img.preview-image"),
    );
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("video preview reports a specific generation failure and persists its diagnostic", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-media-preview-e2e-"),
  );
  const sourcePath = path.join(temporaryRoot, "broken-preview.mp4");
  const missingFfmpegPath = path.join(temporaryRoot, "missing-tools", "ffmpeg");
  const libraryName = "视频预览错误验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(sourcePath, Buffer.from("intentionally-not-a-video"));

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
      SERPENT_E2E_IMPORT_FILES: sourcePath,
      SERPENT_FFMPEG_PATH: missingFfmpegPath,
    },
  });

  try {
    const window = await application.firstWindow();
    const logsPath = await application.evaluate(({ app }) =>
      app.getPath("logs"),
    );
    const logPath = path.join(logsPath, "serpent.log");
    const initialLogLength = existsSync(logPath)
      ? readFileSync(logPath).byteLength
      : 0;
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const assetCard = window
      .getByRole("button")
      .filter({ hasText: "broken-preview.mp4" });
    await expect(assetCard).toBeVisible();
    await expect(assetCard.getByText("缩略图失败")).toBeVisible({
      timeout: 15_000,
    });
    await expect(assetCard.locator(".asset-preview")).toHaveAttribute(
      "title",
      /缺少 FFmpeg|缩略图生成失败/,
    );
    await assetCard.dblclick();

    const preview = window.getByRole("region", {
      name: "broken-preview.mp4 查看页面",
    });
    await expect(preview).toBeVisible();
    await expect(preview.getByText("预览不可用")).toBeVisible();
    await expect(
      preview.getByText(/缺少 FFmpeg|媒体处理失败|源文件可能损坏/),
    ).toBeVisible();
    await preview.getByRole("button", { name: "重试生成" }).click();
    await expect(
      preview.getByText(/缺少 FFmpeg|媒体处理失败|源文件可能损坏/),
    ).toBeVisible({
      timeout: 15_000,
    });

    await expect
      .poll(() =>
        existsSync(logPath)
          ? readFileSync(logPath).subarray(initialLogLength).toString("utf8")
          : "",
      )
      .toMatch(/FFMPEG_REQUIRED|MEDIA_PROCESSING_FAILED/);
    const mediaFailureLog = readFileSync(logPath)
      .subarray(initialLogLength)
      .toString("utf8");
    expect(mediaFailureLog).toContain("worker.media-job.failed");
    expect(mediaFailureLog).toContain("FFMPEG_REQUIRED");
    expect(existsSync(libraryPath)).toBe(true);

    await preview.getByRole("button", { name: "关闭查看页面" }).click();
    await expect(preview).toBeHidden();
    await window.getByRole("button", { name: "后台任务" }).click();
    const jobsDialog = window.getByRole("dialog", { name: "后台媒体任务" });
    await expect(jobsDialog).toBeVisible();
    await expect(jobsDialog.getByText(/失败 [1-9]/)).toBeVisible();
    await expect(
      jobsDialog.getByText(/FFmpeg media component is unavailable/).first(),
    ).toBeVisible();
    await expect(jobsDialog).not.toContainText(temporaryRoot);
    await jobsDialog.getByRole("button", { name: "关闭后台任务" }).click();
    await window.getByRole("button", { name: "关闭资源库" }).click();
    await window.getByRole("button", { name: "打开资源库" }).click();
    const reopenedCard = window
      .getByRole("button")
      .filter({ hasText: "broken-preview.mp4" });
    await expect(reopenedCard).toBeVisible();
    await reopenedCard.dblclick();
    const reopenedPreview = window.getByRole("region", {
      name: "broken-preview.mp4 查看页面",
    });
    await expect(
      reopenedPreview.getByText(/缺少 FFmpeg|媒体处理失败|源文件可能损坏/),
    ).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
