import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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

function configuredMediaBinary(
  environmentName: string,
  binaryName: string,
): string | undefined {
  const configured = process.env[environmentName];
  if (!configured) return undefined;
  const executableName = process.platform === "win32"
    ? `${binaryName}.exe`
    : binaryName;
  try {
    if (statSync(configured).isDirectory()) {
      return path.join(configured, executableName);
    }
  } catch {
    // The caller will report the missing executable through the test skip.
  }
  return configured;
}

const configuredFfmpegPath = configuredMediaBinary(
  "SERPENT_REAL_FFMPEG_PATH",
  "ffmpeg",
) ?? configuredMediaBinary("SERPENT_FFMPEG_PATH", "ffmpeg");
const configuredFfprobePath = configuredFfmpegPath
  ? path.join(
    path.dirname(configuredFfmpegPath),
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  )
  : undefined;

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
  const svgSourcePath = path.join(temporaryRoot, "vector.svg");
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
  writeFileSync(
    svgSourcePath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#245bff"/><circle cx="320" cy="180" r="90" fill="#fff"/></svg>',
  );

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
      SERPENT_E2E_IMPORT_FILES: [sourcePath, nextSourcePath, svgSourcePath].join(
        path.delimiter,
      ),
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
    await expect
      .poll(() =>
        inspectorThumbnail.evaluate(
          (image) => getComputedStyle(image).objectFit,
        ),
      )
      .toBe("contain");
    const inspectorPreviewLayout = await inspectorThumbnail.evaluate((image) => {
      if (!(image instanceof HTMLImageElement)) {
        throw new Error("Inspector preview is not an image");
      }
      const preview = image.closest<HTMLElement>(".inspector-hero-preview");
      if (!preview) throw new Error("Missing Inspector preview container");
      const imageRect = image.getBoundingClientRect();
      return {
        borderStyle: getComputedStyle(preview).borderStyle,
        imageBorderRadius: getComputedStyle(image).borderRadius,
        imageAspectRatio: imageRect.width / imageRect.height,
        naturalAspectRatio: image.naturalWidth / image.naturalHeight,
      };
    });
    expect(inspectorPreviewLayout.borderStyle).toBe("none");
    expect(Number.parseFloat(inspectorPreviewLayout.imageBorderRadius)).toBeGreaterThan(0);
    expect(inspectorPreviewLayout.imageAspectRatio).toBeCloseTo(
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
    await expectImageDecoded(preview.locator("img.preview-image:not(.is-hidden)"));
    // Viewing keeps the host mounted so notices/activity strips remain
    // available, but removes it from normal flex flow with the viewing class.
    await expect(window.locator(".workspace-canvas-host")).toHaveClass(/is-viewing/);
    const imageLocator = preview.locator("img.preview-image:not(.is-hidden)");
    const fitBox = await imageLocator.boundingBox();
    expect(fitBox).not.toBeNull();
    const viewportLocator = preview.locator(".preview-image-viewport");
    const viewportBox = await viewportLocator.boundingBox();
    expect(viewportBox).not.toBeNull();
    const imageCenterX = fitBox!.x + fitBox!.width / 2;
    const imageCenterY = fitBox!.y + fitBox!.height / 2;
    const viewportCenterX = viewportBox!.x + viewportBox!.width / 2;
    const viewportCenterY = viewportBox!.y + viewportBox!.height / 2;
    expect(Math.abs(imageCenterX - viewportCenterX)).toBeLessThanOrEqual(2);
    expect(Math.abs(imageCenterY - viewportCenterY)).toBeLessThanOrEqual(2);
    // Plain mouse wheel zooms anchored at the pointer (Serpent-yo0n). Hover
    // off-center along the axis that fills the viewport — that axis always
    // has pan room once zoomed, so pan clamping cannot override the anchor.
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
    // The viewer-wide fit shortcut is Numpad ., and the visible control is
    // the stable cross-platform contract for this test.
    await preview.getByRole("button", { name: "适应" }).click();
    await expect
      .poll(async () => (await imageLocator.boundingBox())?.width ?? 0)
      .toBeCloseTo(fitBox!.width, 0);
    await window.keyboard.press("ArrowRight");
    const nextPreview = window.getByRole("region", {
      name: "next-automatic.png 查看页面",
    });
    await expectImageDecoded(nextPreview.locator("img.preview-image:not(.is-hidden)"));
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

    const svgAssetCard = window
      .locator(".asset-card")
      .filter({ hasText: "vector.svg" });
    await expect(svgAssetCard).toBeVisible();
    await expectImageDecoded(svgAssetCard.locator('img[alt="vector.svg"]'));
    await svgAssetCard.dblclick();
    const svgPreview = window.getByRole("region", {
      name: "vector.svg 查看页面",
    });
    await expect(svgPreview).toBeVisible();
    const svgPreviewImage = svgPreview.locator("img.preview-image:not(.is-hidden)");
    await expectImageDecoded(svgPreviewImage);
    await expect
      .poll(() => svgPreviewImage.getAttribute("src"))
      .toContain("serpent://source/");
    await window.keyboard.press("Escape");
    await expect(svgPreview).toBeHidden();

    const masonryViewButton = window.locator(
      'button[aria-label="瀑布流视图"]',
    );
    await expect(masonryViewButton).toHaveAttribute("aria-pressed", "false");
    await masonryViewButton.click();
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
        .locator("img.preview-image:not(.is-hidden)"),
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
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const assetCard = window
      .getByRole("button")
      .filter({ hasText: "broken-preview.mp4" });
    await expect(assetCard).toBeVisible();
    // Thumbnail failure is intentionally rendered as the themed generic file
    // surface (no persistent warning badge); the actionable diagnostic lives
    // in the viewer and Background Tasks panel below.
    await expect(assetCard.locator(".asset-preview")).toBeVisible();
    await assetCard.dblclick();

    const preview = window.getByRole("region", {
      name: "broken-preview.mp4 查看页面",
    });
    await expect(preview).toBeVisible();
    // The fixture is intentionally not a decodable MP4, so the viewer also
    // reports Chromium's source playback error. The Worker-side missing
    // component result is asserted through the persisted job/log evidence
    // below; accepting both surfaces keeps this test focused on env routing.
    await expect(preview.getByText(/媒体组件|视频播放失败/)).toBeVisible();
    await preview.getByRole("button", { name: "重试生成" }).click();
    // Retry re-queues generation (pending/"正在生成") before the missing-FFmpeg
    // failure is written again. Wait for the actionable retry surface, then for
    // any FFmpeg-missing copy (exact「缺少 FFmpeg」or catalog「未找到 FFmpeg」).
    await expect(preview.getByRole("button", { name: "重试生成" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(preview.getByText(/媒体组件|媒体处理失败|视频播放失败/)).toBeVisible({
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
      jobsDialog.getByText(/media component needed for video thumbnails is unavailable/).first(),
    ).toBeVisible();
    await expect(jobsDialog).not.toContainText(temporaryRoot);
    await jobsDialog.getByRole("button", { name: "查看诊断日志" }).click();
    const logDialog = window.getByRole("dialog", { name: "诊断日志" });
    await expect(logDialog).toBeVisible();
    await expect(logDialog).toContainText("worker.media-job.failed");
    await expect(logDialog).toContainText("FFMPEG_REQUIRED");
    await expect(logDialog).not.toContainText(temporaryRoot);
    await logDialog.getByRole("button", { name: "关闭诊断日志" }).click();
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
    await expect(reopenedPreview.getByText(/媒体组件|视频播放失败/)).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("repairs a historical video preview after a full process restart", async () => {
  test.skip(
    !configuredFfmpegPath ||
      !configuredFfprobePath ||
      !existsSync(configuredFfmpegPath) ||
      !existsSync(configuredFfprobePath),
    "requires SERPENT_FFMPEG_PATH (or SERPENT_REAL_FFMPEG_PATH) and ffprobe",
  );
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-media-auto-repair-e2e-"),
  );
  const sourcePath = path.join(temporaryRoot, "repairable-video.mp4");
  const missingFfmpegPath = path.join(temporaryRoot, "missing-tools", "ffmpeg");
  const libraryName = "媒体自动修复验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const profilePath = path.join(temporaryRoot, "user-data");
  const width = 160;
  const height = 90;
  const frameCount = 30;
  const frameSize = width * height * 3 / 2;
  const rawVideo = Buffer.alloc(frameSize * frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * frameSize;
    rawVideo.fill(40 + frame, offset, offset + width * height);
    rawVideo.fill(
      96,
      offset + width * height,
      offset + width * height + width * height / 4,
    );
    rawVideo.fill(
      160,
      offset + width * height + width * height / 4,
      offset + frameSize,
    );
  }
  const rawPath = path.join(temporaryRoot, "repairable-video.yuv");
  writeFileSync(rawPath, rawVideo);
  execFileSync(configuredFfmpegPath!, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pixel_format",
    "yuv420p",
    "-video_size",
    `${width}x${height}`,
    "-framerate",
    "30",
    "-i",
    rawPath,
    "-c:v",
    "mpeg4",
    "-q:v",
    "5",
    "-an",
    sourcePath,
  ]);
  rmSync(rawPath, { force: true });

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = (ffmpegPath: string, importFiles?: string) =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_FFMPEG_PATH: ffmpegPath,
        ...(importFiles ? { SERPENT_E2E_IMPORT_FILES: importFiles } : {}),
      },
    });

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    application = await launch(missingFfmpegPath, sourcePath);
    let window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    const assetCard = window
      .getByRole("button")
      .filter({ hasText: "repairable-video.mp4" });
    await expect(assetCard).toBeVisible();
    await expect
      .poll(
        () =>
          window.evaluate(async () => {
            const api = (
              globalThis as typeof globalThis & {
                serpent: {
                  library: {
                    listOpen(): Promise<{
                      ok: boolean;
                      value?: Array<{ libraryId: string }>;
                    }>;
                    listMediaJobs(input: { libraryId: string }): Promise<{
                      ok: boolean;
                      value?: {
                        jobs: Array<{ kind: string; status: string }>;
                      };
                    }>;
                  };
                };
              }
            ).serpent.library;
            const opened = await api.listOpen();
            const libraryId = opened.value?.[0]?.libraryId;
            if (!opened.ok || !libraryId) return null;
            const jobs = await api.listMediaJobs({ libraryId });
            return (
              jobs.value?.jobs.find((job) => job.kind === "generate_thumbnail")
                ?.status ?? null
            );
          }),
        { timeout: 30_000 },
      )
      .toBe("failed");

    const firstProcess = application.process();
    await application.close();
    expect(firstProcess.exitCode).not.toBeNull();

    application = await launch(configuredFfmpegPath!);
    window = await application.firstWindow();
    await window.getByRole("button", { name: "打开资源库" }).click();
    const repairedCard = window
      .getByRole("button")
      .filter({ hasText: "repairable-video.mp4" });
    await expect(repairedCard).toBeVisible();
    await expectImageDecoded(
      repairedCard.locator('img[alt="repairable-video.mp4"]'),
    );
  } finally {
    await application?.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
