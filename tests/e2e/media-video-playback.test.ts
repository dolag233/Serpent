import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type Locator } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const projectRoot = process.cwd();
const installedFfmpegPath = path.join(
  projectRoot,
  "resources",
  "ffmpeg",
  "darwin-arm64",
  "ffmpeg",
);
const buildFfmpegPath = path.join(
  projectRoot,
  ".media-build",
  "darwin-arm64",
  "bundle-root",
  "ffmpeg",
  "darwin-arm64",
  "ffmpeg",
);
const ffmpegPath = process.env.SERPENT_REAL_FFMPEG_PATH ??
  process.env.SERPENT_FFMPEG_PATH ??
  (existsSync(installedFfmpegPath) ? installedFfmpegPath : buildFfmpegPath);
const ffprobePath = process.env.SERPENT_REAL_FFPROBE_PATH ??
  path.join(path.dirname(ffmpegPath), "ffprobe");
const hasRealBundle = process.platform === "darwin" &&
  process.arch === "arm64" &&
  existsSync(ffmpegPath) &&
  existsSync(ffprobePath);
const requireRealMedia = process.env.SERPENT_REQUIRE_REAL_MEDIA === "1";

function assertRealMediaBundleAvailable(): void {
  if (hasRealBundle) return;
  const missing = [ffmpegPath, ffprobePath].filter((binaryPath) =>
    !existsSync(binaryPath)
  );
  throw new Error(
    "SERPENT_REQUIRE_REAL_MEDIA=1 requires the darwin-arm64 LGPL FFmpeg bundle. " +
      `platform=${process.platform}/${process.arch}; missing=${
        missing.join(", ") || "unsupported platform"
      }`,
  );
}

function runMediaBinary(command: string, args: string[]): void {
  execFileSync(command, args, {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
  });
}

test.skip(
  !hasRealBundle && !requireRealMedia,
  "requires the local LGPL-only darwin-arm64 FFmpeg bundle",
);

function generateVideoFixtures(root: string): {
  directPath: string;
  proxyPath: string;
} {
  const width = 320;
  const height = 180;
  const frameCount = 120;
  const lumaSize = width * height;
  const chromaSize = lumaSize / 4;
  const bytesPerFrame = lumaSize + chromaSize * 2;
  const rawVideo = Buffer.alloc(bytesPerFrame * frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * bytesPerFrame;
    rawVideo.fill(32 + (frame % 160), offset, offset + lumaSize);
    rawVideo.fill(
      96 + (frame % 64),
      offset + lumaSize,
      offset + lumaSize + chromaSize,
    );
    rawVideo.fill(
      160 - (frame % 64),
      offset + lumaSize + chromaSize,
      offset + bytesPerFrame,
    );
  }

  const rawPath = path.join(root, "playback-frames.yuv");
  const directPath = path.join(root, "direct-playback.mp4");
  // Windows Media is intentionally used here: Chromium can play the MPEG-4
  // AVI/Matroska fixtures on macOS, so they never exercise the real
  // source-error -> proxy-fallback path this test is meant to cover.
  const proxyPath = path.join(root, "proxy-fallback.wmv");
  writeFileSync(rawPath, rawVideo);

  const inputArguments = [
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
  ];
  runMediaBinary(ffmpegPath, [
    ...inputArguments,
    "-c:v",
    "h264_videotoolbox",
    "-b:v",
    "700k",
    "-movflags",
    "+faststart",
    "-an",
    directPath,
  ]);
  runMediaBinary(ffmpegPath, [
    ...inputArguments,
    "-c:v",
    "msmpeg4v3",
    "-q:v",
    "5",
    "-an",
    proxyPath,
  ]);

  for (const videoPath of [directPath, proxyPath]) {
    runMediaBinary(ffprobePath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,width,height",
      "-of",
      "json",
      videoPath,
    ]);
  }
  rmSync(rawPath, { force: true });
  return { directPath, proxyPath };
}

async function expectDecodedPoster(card: Locator, name: string) {
  const image = card.locator(`img[alt="${name}"]`);
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth > 0 &&
            element.naturalHeight > 0,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function expectPlayableAndSeekable(video: Locator) {
  await expect(video).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      video.evaluate(
        (element) => element instanceof HTMLVideoElement && element.loop,
      ),
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        video.evaluate(
          (element) =>
            element instanceof HTMLVideoElement &&
            element.readyState >= HTMLMediaElement.HAVE_METADATA &&
            element.videoWidth > 0 &&
            element.videoHeight > 0 &&
            Number.isFinite(element.duration) &&
            element.duration > 2,
        ),
      {
        message: "expected Chromium to decode real video metadata",
        timeout: 30_000,
      },
    )
    .toBe(true);

  await video.evaluate(async (element) => {
    if (!(element instanceof HTMLVideoElement)) throw new TypeError("not a video");
    element.muted = true;
    element.currentTime = 0;
    await element.play();
  });
  await expect
    .poll(() =>
      video.evaluate((element) => {
        if (!(element instanceof HTMLVideoElement))
          throw new TypeError("not a video");
        return element.currentTime;
      }),
    {
      message: "expected playback time to advance",
      timeout: 10_000,
    })
    .toBeGreaterThan(0.25);

  // BUG-VIEWER-001: ready-state preview polling must not remount <video> and
  // restart playback every ~1.5s (symptom: ~5s clip "loops" after ~2s).
  const uninterrupted = await video.evaluate(async (element) => {
    if (!(element instanceof HTMLVideoElement)) throw new TypeError("not a video");
    element.muted = true;
    if (element.paused) await element.play();
    const samples: number[] = [];
    const started = performance.now();
    while (performance.now() - started < 2_400) {
      samples.push(element.currentTime);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    let maxDrop = 0;
    for (let i = 1; i < samples.length; i += 1) {
      maxDrop = Math.max(maxDrop, samples[i - 1]! - samples[i]!);
    }
    return {
      maxDrop,
      last: samples.at(-1) ?? 0,
      first: samples[0] ?? 0,
      sampleCount: samples.length,
    };
  });
  expect(
    uninterrupted.maxDrop,
    `playback restarted during idle play: ${JSON.stringify(uninterrupted)}`,
  ).toBeLessThan(0.45);
  expect(uninterrupted.last).toBeGreaterThan(uninterrupted.first + 1.2);

  const seekTarget = await video.evaluate((element) => {
    if (!(element instanceof HTMLVideoElement))
      throw new TypeError("not a video");
    element.pause();
    return Math.min(2.5, element.duration * 0.7);
  });
  await video.evaluate(
    (element, target) =>
      new Promise<void>((resolve, reject) => {
        if (!(element instanceof HTMLVideoElement)) {
          reject(new TypeError("not a video"));
          return;
        }
        const timeout = window.setTimeout(
          () => reject(new Error("video seek timed out")),
          10_000,
        );
        element.addEventListener(
          "seeked",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        element.currentTime = target;
      }),
    seekTarget,
  );
  await expect
    .poll(() =>
      video.evaluate(
        (element, target) => {
          if (!(element instanceof HTMLVideoElement))
            throw new TypeError("not a video");
          return Math.abs(element.currentTime - target);
        },
        seekTarget,
      ),
    )
    .toBeLessThan(0.2);
}

test("plays a direct MP4 and a generated WebM fallback through the asset viewer", async () => {
  assertRealMediaBundleAvailable();
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-video-playback-e2e-"),
  );
  const libraryName = "视频播放成功验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;

  try {
    const { directPath, proxyPath } = generateVideoFixtures(temporaryRoot);
    application = await electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath: resolveElectronExecutablePath(),
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
        SERPENT_E2E_IMPORT_FILES: [directPath, proxyPath].join(path.delimiter),
        SERPENT_FFMPEG_PATH: ffmpegPath,
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

    const directCard = window
      .locator(".asset-card")
      .filter({ hasText: "direct-playback.mp4" });
    const proxyCard = window
      .locator(".asset-card")
      .filter({ hasText: "proxy-fallback.wmv" });
    await expectDecodedPoster(directCard, "direct-playback.mp4");
    await expectDecodedPoster(proxyCard, "proxy-fallback.wmv");

    await directCard.dblclick();
    const directViewer = window.getByRole("region", {
      name: "direct-playback.mp4 查看页面",
    });
    // REQ-VIEW-002: the viewer always plays the ORIGINAL source when the
    // container is natively playable. A ready WebM proxy must never take over
    // the viewer (it is only a hover/scrub derivative and the AVI/WMV path).
    const directVideo = directViewer.locator("video.preview-video");
    await expect
      .poll(() => directVideo.getAttribute("src"), { timeout: 30_000 })
      .toMatch(/^serpent:\/\/source\//);
    await expectPlayableAndSeekable(directVideo);
    const directVideoChrome = directViewer.locator(".preview-video-controls");
    const directFullscreenButton = directViewer.getByRole("button", {
      name: "全屏",
    });
    await directVideo.hover();
    await directFullscreenButton.click();
    await expect(
      directViewer.getByRole("button", { name: "退出全屏" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() =>
        window.evaluate(() => Boolean(document.fullscreenElement)),
      )
      .toBe(true);
    // A focused fullscreen button must not keep the transport chrome visible
    // forever after the viewer idle timer expires.
    await expect
      .poll(() => directVideoChrome.evaluate((element) => getComputedStyle(element).opacity), {
        timeout: 5_000,
      })
      .toBe("0");
    await window.evaluate(async () => {
      if (document.fullscreenElement) await document.exitFullscreen();
    });
    await expect(directFullscreenButton).toBeVisible();
    await directVideo.evaluate((element) => {
      if (!(element instanceof HTMLVideoElement)) throw new TypeError("not a video");
      element.currentTime = 1;
    });
    await expect
      .poll(() =>
        directVideo.evaluate((element) => {
          if (!(element instanceof HTMLVideoElement)) throw new TypeError("not a video");
          return element.currentTime;
        }),
      )
      .toBeGreaterThan(0.5);
    await directVideo.evaluate(async (element) => {
      if (!(element instanceof HTMLVideoElement)) throw new TypeError("not a video");
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() =>
        directVideo.evaluate((element) => {
          if (!(element instanceof HTMLVideoElement)) throw new TypeError("not a video");
          return element.paused;
        }),
      )
      .toBe(false);
    const directScrubber = directViewer.getByRole("slider", {
      name: "拖动视频进度",
    });
    const scrubberBox = await directScrubber.boundingBox();
    expect(scrubberBox).not.toBeNull();
    await window.mouse.move(
      scrubberBox!.x + scrubberBox!.width * 0.35,
      scrubberBox!.y + scrubberBox!.height / 2,
    );
    await window.mouse.down();
    await window.mouse.move(
      scrubberBox!.x + scrubberBox!.width * 0.55,
      scrubberBox!.y + scrubberBox!.height / 2,
      { steps: 4 },
    );
    await window.mouse.up();
    await directScrubber.focus();
    await window.keyboard.press("Space");
    // Space belongs to viewer playback even after the scrubber receives focus;
    // it must not invoke the slider's native Space behavior instead.
    await expect
      .poll(() =>
        directVideo.evaluate((element) => {
          if (!(element instanceof HTMLVideoElement)) throw new TypeError("not a video");
          return element.paused;
        }),
      )
      .toBe(true);
    // Video zoom/pan/fit mirrors the image viewer (Serpent-190): the mouse
    // wheel zooms, a drag pans while zoomed, and Fit restores fit-to-window.
    const videoFitBox = await directVideo.boundingBox();
    expect(videoFitBox).not.toBeNull();
    const videoViewport = directViewer.locator(".preview-video-viewport");
    await videoViewport.hover();
    const videoViewportBox = await videoViewport.boundingBox();
    await window.mouse.wheel(0, -400);
    await expect
      .poll(async () => (await directVideo.boundingBox())?.width ?? 0)
      .toBeGreaterThan(videoFitBox!.width * 1.2);
    const videoZoomBox = await directVideo.boundingBox();
    const panOrigin = {
      x: videoViewportBox!.x + videoViewportBox!.width / 2,
      y: videoViewportBox!.y + videoViewportBox!.height / 2,
    };
    await window.mouse.move(panOrigin.x, panOrigin.y);
    await window.mouse.down();
    await window.mouse.move(panOrigin.x + 72, panOrigin.y + 48, { steps: 6 });
    await window.mouse.up();
    await expect
      .poll(async () => {
        const box = await directVideo.boundingBox();
        return box ? box.x - videoZoomBox!.x : 0;
      })
      .toBeGreaterThan(60);
    await expect
      .poll(async () => {
        const box = await directVideo.boundingBox();
        return box ? box.y - videoZoomBox!.y : 0;
      })
      .toBeGreaterThan(36);
    await directViewer.getByRole("button", { name: "适应" }).click();
    await expect
      .poll(async () => (await directVideo.boundingBox())?.width ?? 0)
      .toBeCloseTo(videoFitBox!.width, 0);
    // Viewer chrome intentionally fades while idle. Real pointer movement
    // wakes it before the close control is clicked.
    await directVideo.hover();
    await directViewer.getByRole("button", { name: "关闭查看页面" }).click();

    await proxyCard.click();
    await window.keyboard.press("Space");
    const proxyViewer = window.getByRole("region", {
      name: "proxy-fallback.wmv 查看页面",
    });
    // REQ-VIEW-002: the source is mounted first for every video. The WMV
    // fixture is deliberately not directly decodable by Chromium, so wait
    // for the real media error to trigger the explicit proxy fallback before
    // asserting the proxy URL.
    const proxyVideo = proxyViewer.locator("video.preview-video");
    await expect
      .poll(() => proxyVideo.getAttribute("src"), { timeout: 10_000 })
      .toMatch(/^serpent:\/\/source\//);
    // The native Electron media stack accepts the small WMV fixture on some
    // macOS builds even though Chromium's normal web playback matrix does
    // not. Keep the source-first assertion above, then exercise the same
    // browser MediaError event that an unsupported codec produces so this
    // E2E remains deterministic across bundled decoder variants.
    await proxyVideo.evaluate((element) => {
      const mediaError = { code: 4, message: "unsupported test codec" };
      Object.defineProperty(element, "error", {
        configurable: true,
        value: mediaError,
      });
      element.dispatchEvent(new Event("error"));
    });
    await expect
      .poll(() => proxyVideo.getAttribute("src"), { timeout: 30_000 })
      .toMatch(/^serpent:\/\/proxy\//);
    await expectPlayableAndSeekable(proxyVideo);
    const proxyNotice = proxyViewer.getByRole("status");
    await expect(proxyNotice).toContainText(
      "原视频无法播放，当前播放的是代理视频",
    );
    // Proxy notices share the viewer chrome idle fade. Moving over the active
    // viewer surface wakes the hidden chrome before the notice is clicked;
    // targeting the faded notice itself would be intercepted by the viewport.
    await proxyVideo.hover();
    await proxyNotice.getByRole("button", { name: "隐藏提示" }).click();
    await expect(proxyViewer.getByRole("button", { name: "显示代理提示" })).toBeVisible();
    await proxyViewer.getByRole("button", { name: "显示代理提示" }).click();
    await expect(proxyNotice).toBeVisible();

    const proxyJobStatus = await window.evaluate(async () => {
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
        jobs.value?.jobs.find((job) => job.kind === "generate_webm_proxy")
          ?.status ?? null
      );
    });
    expect(proxyJobStatus).toBe("succeeded");
  } finally {
    await application?.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
