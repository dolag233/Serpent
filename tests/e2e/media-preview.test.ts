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
import sharp from "sharp";

import {
  closeLibraryViaSwitcher,
  resolveElectronExecutablePath,
} from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

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
  await sharp({
    create: {
      width: 800,
      height: 200,
      channels: 4,
      background: { r: 48, g: 112, b: 160, alpha: 1 },
    },
  }).png().toFile(sourcePath);
  await sharp({
    create: {
      width: 200,
      height: 800,
      channels: 4,
      background: { r: 160, g: 84, b: 48, alpha: 1 },
    },
  }).png().toFile(nextSourcePath);

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
    const inspectorThumbnail = window.locator(
      '.inspector-hero-preview img[alt="automatic.png"]',
    );
    await expectImageDecoded(inspectorThumbnail);
    expect(
      await inspectorThumbnail.evaluate((image) => getComputedStyle(image).objectFit),
    ).toBe("contain");
    const inspectorPreviewLayout = await inspectorThumbnail.evaluate((image) => {
      if (!(image instanceof HTMLImageElement)) {
        throw new Error("Inspector preview is not an image");
      }
      const preview = image.closest<HTMLElement>(".inspector-hero-preview");
      if (!preview) throw new Error("Missing Inspector preview container");
      const imageRect = image.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      return {
        borderStyle: getComputedStyle(preview).borderStyle,
        imageBorderRadius: getComputedStyle(image).borderRadius,
        imageAspectRatio: imageRect.width / imageRect.height,
        naturalAspectRatio: image.naturalWidth / image.naturalHeight,
        previewAspectRatio: preview.clientWidth / preview.clientHeight,
        widthDelta: Math.abs(imageRect.width - previewRect.width),
      };
    });
    expect(inspectorPreviewLayout.borderStyle).toBe("none");
    expect(Number.parseFloat(inspectorPreviewLayout.imageBorderRadius)).toBeGreaterThan(0);
    expect(inspectorPreviewLayout.widthDelta).toBeLessThanOrEqual(3);
    expect(inspectorPreviewLayout.imageAspectRatio).toBeCloseTo(
      inspectorPreviewLayout.naturalAspectRatio,
      1,
    );
    expect(inspectorPreviewLayout.previewAspectRatio).toBeCloseTo(
      inspectorPreviewLayout.naturalAspectRatio,
      1,
    );
    await expect(window.getByLabel("自动色卡预览")).toBeVisible({
      timeout: 15_000,
    });
    await expect(window.getByText("色卡 · 自动")).toHaveCount(0);
    await expect
      .poll(() => window.getByLabel("自动色卡预览").locator("span").count())
      .toBeGreaterThan(0);
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
    const imageLocator = preview.locator("img.preview-image");
    const fitBox = await imageLocator.boundingBox();
    expect(fitBox).not.toBeNull();
    // Plain mouse wheel zooms anchored at the pointer (Serpent-yo0n). Hover
    // off-center along the axis that fills the viewport — that axis always
    // has pan room once zoomed, so pan clamping cannot override the anchor.
    const viewportLocator = preview.locator(".preview-image-viewport");
    const viewportBox = await viewportLocator.boundingBox();
    const slackX = Math.abs(fitBox!.width - viewportBox!.width);
    const slackY = Math.abs(fitBox!.height - viewportBox!.height);
    const hoverX =
      slackX <= slackY ? viewportBox!.width * 0.62 : viewportBox!.width * 0.5;
    const hoverY =
      slackX <= slackY ? viewportBox!.height * 0.5 : viewportBox!.height * 0.62;
    await viewportLocator.hover({ position: { x: hoverX, y: hoverY } });
    const pointerX = viewportBox!.x + hoverX;
    const pointerY = viewportBox!.y + hoverY;
    await window.mouse.wheel(0, -200);
    await expect
      .poll(async () => (await imageLocator.boundingBox())?.width ?? 0)
      .toBeGreaterThan(fitBox!.width);
    // The image point under the pointer stays fixed: for box origin b and
    // scale ratio r, b' = p − (p − b) × r on both axes.
    const wheelBox = await imageLocator.boundingBox();
    const wheelRatio = wheelBox!.width / fitBox!.width;
    expect(
      Math.abs(wheelBox!.x - (pointerX - (pointerX - fitBox!.x) * wheelRatio)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(wheelBox!.y - (pointerY - (pointerY - fitBox!.y) * wheelRatio)),
    ).toBeLessThanOrEqual(2);
    // The anchor is frozen at the gesture start: drifting the pointer
    // mid-gesture does not move the zoom center (Serpent-yo0n, user ruling).
    const driftOffsetX = viewportBox!.width * 0.15;
    const driftOffsetY = viewportBox!.height * 0.15;
    await viewportLocator.hover({
      position: { x: hoverX + driftOffsetX, y: hoverY + driftOffsetY },
    });
    await window.mouse.wheel(0, -120);
    const driftBox = await imageLocator.boundingBox();
    const driftRatio = driftBox!.width / fitBox!.width;
    expect(
      Math.abs(driftBox!.x - (pointerX - (pointerX - fitBox!.x) * driftRatio)),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(driftBox!.y - (pointerY - (pointerY - fitBox!.y) * driftRatio)),
    ).toBeLessThanOrEqual(2);
    // After the gesture idles out, the next scroll re-anchors at the current
    // pointer (asserted on the fitted axis, where pan room is guaranteed).
    await window.waitForTimeout(600);
    const secondPointerX = viewportBox!.x + hoverX + driftOffsetX;
    await window.mouse.wheel(0, -120);
    const reanchorBox = await imageLocator.boundingBox();
    const reanchorRatio = reanchorBox!.width / driftBox!.width;
    expect(
      Math.abs(
        reanchorBox!.x -
          (secondPointerX - (secondPointerX - driftBox!.x) * reanchorRatio),
      ),
    ).toBeLessThanOrEqual(2);
    // Ctrl+wheel (pinch convention) keeps zooming.
    await window.keyboard.down("Control");
    await window.mouse.wheel(0, -400);
    await window.keyboard.up("Control");
    await expect
      .poll(async () => (await imageLocator.boundingBox())?.width ?? 0)
      .toBeGreaterThan(reanchorBox!.width);
    // F returns to fit-to-window.
    await window.keyboard.press("f");
    await expect
      .poll(async () => (await imageLocator.boundingBox())?.width ?? 0)
      .toBeCloseTo(fitBox!.width, 0);
    await window.keyboard.press("ArrowRight");
    const nextPreview = window.getByRole("region", {
      name: "next-automatic.png 查看页面",
    });
    await expectImageDecoded(nextPreview.locator("img.preview-image"));
    await expect(
      window
        .locator(".inspector-hero-compact")
        .getByText("next-automatic.png", { exact: true }),
    ).toBeVisible();
    await expectImageDecoded(
      window.locator('.inspector-hero-preview img[alt="next-automatic.png"]'),
    );
    await window.keyboard.press("Escape");
    await expect(nextPreview).toBeHidden();
    const nextAssetCard = window
      .locator(".asset-card")
      .filter({ hasText: "next-automatic.png" });
    await expect(nextAssetCard).toHaveAttribute("aria-pressed", "true");
    await expect(assetCard).toHaveAttribute("aria-pressed", "false");
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
    await closeLibraryViaSwitcher(window, libraryName);
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
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
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
    await expect(preview.getByText("缺少 FFmpeg")).toBeVisible();
    await preview.getByRole("button", { name: "重试生成" }).click();
    // Retry re-queues generation (pending/"正在生成") before the missing-FFmpeg
    // failure is written again. Wait for the actionable retry surface, then for
    // any FFmpeg-missing copy (exact「缺少 FFmpeg」or catalog「未找到 FFmpeg」).
    await expect(preview.getByRole("button", { name: "重试生成" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(preview.getByText(/FFmpeg/)).toBeVisible({
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
    await window.getByRole("button", { name: "更多工具" }).click();
    await window.getByRole("menuitem", { name: "后台任务" }).click();
    const jobsDialog = window.getByRole("dialog", { name: "后台媒体任务" });
    await expect(jobsDialog).toBeVisible();
    await expect(jobsDialog.getByText(/失败 [1-9]/)).toBeVisible();
    await expect(
      jobsDialog.getByText(/FFmpeg media component is unavailable/).first(),
    ).toBeVisible();
    await expect(jobsDialog).not.toContainText(temporaryRoot);
    await jobsDialog.getByRole("button", { name: "关闭后台任务" }).click();
    await closeLibraryViaSwitcher(window, libraryName);
    await window.getByRole("button", { name: "打开资源库" }).click();
    const reopenedCard = window
      .getByRole("button")
      .filter({ hasText: "broken-preview.mp4" });
    await expect(reopenedCard).toBeVisible();
    await reopenedCard.dblclick();
    const reopenedPreview = window.getByRole("region", {
      name: "broken-preview.mp4 查看页面",
    });
    await expect(reopenedPreview.getByText("缺少 FFmpeg")).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
