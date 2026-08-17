import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const MIXED_ASPECTS = [
  { width: 320, height: 180 },
  { width: 180, height: 320 },
  { width: 240, height: 240 },
  { width: 360, height: 240 },
  { width: 240, height: 360 },
] as const;

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
const ffmpegCommand = process.env.SERPENT_REAL_FFMPEG_PATH ??
  process.env.SERPENT_FFMPEG_PATH ??
  (existsSync(installedFfmpegPath) ? installedFfmpegPath : buildFfmpegPath);
const ffprobeCommand = process.env.SERPENT_REAL_FFPROBE_PATH ??
  path.join(path.dirname(ffmpegCommand), "ffprobe");
const hasFfmpeg = (() => {
  try {
    if (!existsSync(ffmpegCommand) || !existsSync(ffprobeCommand)) return false;
    execFileSync(ffmpegCommand, ["-version"], { stdio: "ignore" });
    execFileSync(ffprobeCommand, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

async function writeProbeImage(filePath: string, index: number): Promise<void> {
  const dimensions = MIXED_ASPECTS[index % MIXED_ASPECTS.length]!;
  await sharp({
    create: {
      ...dimensions,
      channels: 4,
      background: {
        r: (index * 37) % 255,
        g: (index * 71) % 255,
        b: (index * 109) % 255,
        alpha: 1,
      },
    },
  })
    .png()
    .toFile(filePath);
}

function writeProbeVideo(filePath: string, index: number): void {
  const dimensions = MIXED_ASPECTS[index % MIXED_ASPECTS.length]!;
  const frameCount = 12;
  const lumaSize = dimensions.width * dimensions.height;
  const chromaSize = lumaSize / 4;
  const bytesPerFrame = lumaSize + chromaSize * 2;
  const rawPath = `${filePath}.yuv`;
  const rawVideo = Buffer.alloc(bytesPerFrame * frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * bytesPerFrame;
    rawVideo.fill(32 + ((index * 17 + frame) % 160), offset, offset + lumaSize);
    rawVideo.fill(
      96 + ((index * 11 + frame) % 64),
      offset + lumaSize,
      offset + lumaSize + chromaSize,
    );
    rawVideo.fill(
      160 - ((index * 7 + frame) % 64),
      offset + lumaSize + chromaSize,
      offset + bytesPerFrame,
    );
  }
  writeFileSync(rawPath, rawVideo);
  execFileSync(ffmpegCommand, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pixel_format",
    "yuv420p",
    "-video_size",
    `${dimensions.width}x${dimensions.height}`,
    "-framerate",
    "12",
    "-i",
    rawPath,
    "-an",
    "-c:v",
    "mpeg4",
    "-q:v",
    "5",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    filePath,
  ], { timeout: 30_000 });
  rmSync(rawPath, { force: true });
}

type ScrollSnapshot = {
  visibleCards: number;
  visibleColumns: number[];
  columnHeights: number[];
  scrollTop: number;
  maxScrollTop: number;
  maxUncoveredBandPx: number;
  undecodedImages: string[];
  detachedBadges: string[];
};

async function readScrollSnapshot(window: Page): Promise<ScrollSnapshot> {
  return window.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvas) throw new Error("Missing workspace canvas.");
    const canvasRect = canvas.getBoundingClientRect();
    const columns = Array.from(
      document.querySelectorAll<HTMLElement>(".masonry-column"),
    );
    const visibleColumns = columns.map((column) => {
      const cards = Array.from(column.querySelectorAll<HTMLElement>(".asset-card"));
      return cards.filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.bottom > canvasRect.top && rect.top < canvasRect.bottom;
      }).length;
    });
    const columnHeights = columns.map((column) => column.getBoundingClientRect().height);
    let maxUncoveredBandPx = 0;
    for (const column of columns) {
      const columnRect = column.getBoundingClientRect();
      const visTop = Math.max(canvasRect.top, columnRect.top);
      const visBottom = Math.min(canvasRect.bottom, columnRect.bottom);
      if (visBottom - visTop < 40) continue;
      const intervals = Array.from(
        column.querySelectorAll<HTMLElement>(".masonry-card-slot"),
      )
        .map((card) => card.getBoundingClientRect())
        .filter((rect) => rect.bottom > visTop && rect.top < visBottom)
        .map((rect) => [
          Math.max(visTop, rect.top),
          Math.min(visBottom, rect.bottom),
        ] as const)
        .sort((left, right) => left[0] - right[0]);
      let cursor = visTop;
      for (const [top, bottom] of intervals) {
        maxUncoveredBandPx = Math.max(maxUncoveredBandPx, top - cursor);
        cursor = Math.max(cursor, bottom);
      }
      maxUncoveredBandPx = Math.max(maxUncoveredBandPx, visBottom - cursor);
    }
    const visibleCards = Array.from(
      document.querySelectorAll<HTMLElement>(".asset-card"),
    ).filter((card) => {
      const rect = card.getBoundingClientRect();
      return (
        rect.bottom > canvasRect.top &&
        rect.top < canvasRect.bottom &&
        rect.right > canvasRect.left &&
        rect.left < canvasRect.right
      );
    });
    const undecodedImages: string[] = [];
    const detachedBadges: string[] = [];
    for (const card of visibleCards) {
      const name = card.getAttribute("title") ?? "unknown";
      const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
      if (image && (!image.complete || image.naturalWidth <= 0)) {
        undecodedImages.push(name);
      }
      const preview = card.querySelector<HTMLElement>(".asset-preview");
      if (!preview) continue;
      const previewRect = preview.getBoundingClientRect();
      for (const badge of card.querySelectorAll<HTMLElement>(
        ".asset-duration-badge, .asset-type-badge, .asset-source-badge",
      )) {
        const badgeRect = badge.getBoundingClientRect();
        const detached =
          badgeRect.right < previewRect.left - 1 ||
          badgeRect.left > previewRect.right + 1 ||
          badgeRect.bottom < previewRect.top - 1 ||
          badgeRect.top > previewRect.bottom + 1;
        if (detached) detachedBadges.push(name);
      }
    }
    return {
      visibleCards: visibleCards.length,
      visibleColumns,
      columnHeights,
      scrollTop: canvas.scrollTop,
      maxScrollTop: canvas.scrollHeight - canvas.clientHeight,
      maxUncoveredBandPx,
      undecodedImages,
      detachedBadges,
    };
  });
}

test("keeps visible masonry cards complete during rapid scroll at the tuned thumbnail size", async () => {
  const assetCount = 100;
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-thumbnail-scroll-regression-"),
  );
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(sourceRoot);
  const sourcePaths: string[] = [];
  for (let index = 0; index < assetCount; index += 1) {
    const sourcePath = path.join(
      sourceRoot,
      `scroll-${index.toString().padStart(2, "0")}.png`,
    );
    await writeProbeImage(sourcePath, index);
    sourcePaths.push(sourcePath);
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
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "profile"),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill("缩略图滚动回归");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(window.getByText("缩略图滚动回归", { exact: true }).first()).toBeVisible();
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const canvas = window.locator(".workspace-canvas");
    await expect
      .poll(
        async () => {
          const text = await window.locator("body").innerText();
          return Number(text.match(/所有资产\s+(\d+)\s+项/)?.[1] ?? -1);
        },
        {
        timeout: 30_000,
        },
      )
      .toBe(assetCount);

    const masonry = window.getByRole("button", { name: "瀑布流视图" });
    if ((await masonry.getAttribute("aria-pressed")) !== "true") await masonry.click();
    await expect(masonry).toHaveAttribute("aria-pressed", "true");

    // Fourth discrete stop (Value:3) is the Computer Use / user repro:
    // large cards, few columns, fast downward flicks leave a truncated
    // white band when the window lags behind scroll.
    const sizeSlider = window.getByLabel("资产缩略图大小");
    const tunedIndex = Math.min(3, Number(await sizeSlider.getAttribute("max")));
    await sizeSlider.fill(String(tunedIndex));
    await expect(sizeSlider).toHaveValue(String(tunedIndex));
    await expect(window.locator(".asset-card").first()).toBeVisible();

    await expect.poll(() => readScrollSnapshot(window)).toMatchObject({
      undecodedImages: [],
    });

    // Include both directions and large reversals. The white band was a
    // transient stale-window frame, so each jump is sampled immediately.
    for (const fraction of [
      0.12,
      0.28,
      0.46,
      0.64,
      0.82,
      0.94,
      0.37,
      0.71,
      0.21,
      0.88,
      0.49,
      0.76,
    ]) {
      await canvas.evaluate((element, value) => {
        element.scrollTo({
          top: (element.scrollHeight - element.clientHeight) * value,
        });
      }, fraction);
      const snapshot = await readScrollSnapshot(window);
      expect(snapshot.visibleCards).toBeGreaterThan(0);
      const activeColumns = snapshot.columnHeights
        .map((height, index) => ({ height, count: snapshot.visibleColumns[index] ?? 0 }))
        .filter(({ height }) => height > snapshot.scrollTop + 1);
      expect(
        activeColumns.every(({ count }) => count > 0),
        JSON.stringify({ fraction, ...snapshot }),
      ).toBe(true);
      // Inter-card gap is 14px; a truncated unpainted band is much larger.
      expect(
        snapshot.maxUncoveredBandPx,
        JSON.stringify({ fraction, ...snapshot }),
      ).toBeLessThan(80);
      expect(snapshot.detachedBadges).toEqual([]);
    }
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test.describe("video poster scrolling", () => {
  test.skip(!hasFfmpeg, "requires ffmpeg to create short video fixtures");

  test("keeps visible video posters decoded after rapid scrolling", async () => {
    const assetCount = 20;
    const temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "serpent-video-thumbnail-scroll-regression-"),
    );
    const sourceRoot = path.join(temporaryRoot, "sources");
    mkdirSync(sourceRoot);
    const sourcePaths: string[] = [];
    for (let index = 0; index < assetCount; index += 1) {
      const sourcePath = path.join(
        sourceRoot,
        `video-scroll-${index.toString().padStart(2, "0")}.mp4`,
      );
      writeProbeVideo(sourcePath, index);
      sourcePaths.push(sourcePath);
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
        SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
        SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "profile"),
        SERPENT_FFMPEG_PATH: ffmpegCommand,
        SERPENT_FFPROBE_PATH: ffprobeCommand,
      },
    });

    try {
      const window = await application.firstWindow();
      await window.getByRole("button", { name: "创建资源库" }).click();
      await window.getByRole("textbox", { name: "名称" }).fill("视频缩略图滚动回归");
      await window.getByRole("button", { name: "创建", exact: true }).click();
      await expect(window.getByText("视频缩略图滚动回归", { exact: true }).first()).toBeVisible();
      await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
      await expect(window.locator(".asset-card")).toHaveCount(assetCount, { timeout: 30_000 });

      const masonry = window.getByRole("button", { name: "瀑布流视图" });
      if ((await masonry.getAttribute("aria-pressed")) !== "true") await masonry.click();
      await expect(masonry).toHaveAttribute("aria-pressed", "true");
      const sizeSlider = window.getByLabel("资产缩略图大小");
      const tunedIndex = Math.min(3, Number(await sizeSlider.getAttribute("max")));
      await sizeSlider.fill(String(tunedIndex));
      await expect(sizeSlider).toHaveValue(String(tunedIndex));

      const canvas = window.locator(".workspace-canvas");
      for (const fraction of [0.2, 0.45, 0.7, 0.86, 0.3]) {
        await canvas.evaluate((element, value) => {
          element.scrollTo({
            top: (element.scrollHeight - element.clientHeight) * value,
          });
        }, fraction);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const snapshot = await readScrollSnapshot(window);
        expect(snapshot.visibleCards).toBeGreaterThan(0);
        expect(snapshot.maxUncoveredBandPx, JSON.stringify({ fraction, ...snapshot })).toBeLessThan(80);
        expect(snapshot.undecodedImages, JSON.stringify({ fraction, ...snapshot })).toEqual([]);
        expect(snapshot.detachedBadges, JSON.stringify({ fraction, ...snapshot })).toEqual([]);
      }
    } finally {
      await application.close();
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });
});
