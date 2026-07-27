import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type ElectronApplication, type Locator } from "@playwright/test";
import sharp from "sharp";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

async function expectDecodedImage(image: Locator): Promise<void> {
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

test("auto-detects, manually rebuilds, persists, plays, rotates and mirrors an image sequence", async () => {
  const testInfo = test.info();
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-image-sequence-e2e-"),
  );
  const sourceRoot = path.join(temporaryRoot, "frames");
  const libraryName = "序列图验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const profilePath = path.join(temporaryRoot, "user-data");
  const framePaths = [0, 1, 2].map((index) =>
    path.join(sourceRoot, `motion_${String(index).padStart(3, "0")}.png`),
  );
  const colors = [
    { r: 220, g: 70, b: 70, alpha: 1 },
    { r: 70, g: 190, b: 110, alpha: 1 },
    { r: 70, g: 110, b: 220, alpha: 1 },
  ];
  mkdirSync(sourceRoot, { recursive: true });
  await Promise.all(
    framePaths.map((framePath, index) =>
      sharp({
        create: {
          width: 320,
          height: 180,
          channels: 4,
          background: colors[index]!,
        },
      })
        .png()
        .toFile(framePath),
    ),
  );

  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath: resolveElectronExecutablePath(),
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_RESTORE_RECENT: "1",
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        // Selecting one member must discover and import its consecutive siblings.
        SERPENT_E2E_IMPORT_FILES: framePaths[1]!,
      },
    });

  let application: ElectronApplication | null = await launch();
  try {
    let window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();

    const primaryCard = window.locator(
      '.asset-card[title="motion_000.png"]',
    );
    await expect(primaryCard).toBeVisible({ timeout: 30_000 });
    await expect(window.locator(".asset-card")).toHaveCount(1);
    await expect(primaryCard.getByText("3F · 24 FPS", { exact: true })).toBeVisible();
    await expectDecodedImage(primaryCard.locator('img[alt="motion_000.png"]'));

    // Dissolving restores the three independent frame assets.
    await primaryCard.click({ button: "right" });
    await window.getByRole("menuitem", { name: "解散序列图" }).click();
    await expect(window.locator(".asset-card")).toHaveCount(3);

    const selectionModifier = process.platform === "darwin" ? "Meta" : "Control";
    const frameCards = framePaths.map((framePath) =>
      window.locator(`.asset-card[title="${path.basename(framePath)}"]`),
    );
    await frameCards[0]!.click();
    await frameCards[1]!.click({ modifiers: [selectionModifier] });
    await frameCards[2]!.click({ modifiers: [selectionModifier] });
    await expect(window.locator(".asset-card.is-selected")).toHaveCount(3);
    await frameCards[1]!.click({ button: "right" });
    await window.getByRole("menuitem", { name: "创建序列图…" }).click();

    const sequenceDialog = window.getByRole("dialog", { name: "创建序列图" });
    await expect(sequenceDialog).toBeVisible();
    // 13 FPS also proves that a non-default user value survives a restart.
    // It deliberately avoids an integer number of 3-frame loops per second,
    // which would make a background-throttled Electron window look static.
    await sequenceDialog.getByLabel("帧率（FPS）").fill("13");
    await sequenceDialog
      .getByRole("button", { name: "创建序列图", exact: true })
      .click();

    await expect(window.locator(".asset-card")).toHaveCount(1);
    await expect(primaryCard.getByText("3F · 13 FPS", { exact: true })).toBeVisible();
    await primaryCard.click();
    await expect(window.locator(".inspector-hero-stack")).toHaveAttribute(
      "data-layer-count",
      "3",
    );
    await expect(window.locator(".inspector-hero-stack-layer[data-depth='1']")).toHaveCSS(
      "transform",
      "matrix(1, 0, 0, 1, 0, 0)",
    );

    await primaryCard.dblclick();
    const viewer = window.getByRole("region", {
      name: "motion_000.png 查看页面",
    });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText("1 / 3 · 13 FPS", { exact: true })).toBeVisible();
    const previewImage = viewer.locator("img.preview-image");
    await expectDecodedImage(previewImage);
    await expect(window.getByRole("button", { name: "暂停序列" })).toBeVisible();
    // Background Electron windows suspend requestAnimationFrame. Scrubbing
    // proves that frames resolve and switch without bringing the E2E window
    // to the user's foreground; resuming proves the playback state transition.
    await window.getByLabel("序列帧").fill("1");
    await expect(previewImage).toHaveAttribute("alt", "motion_001.png");
    await expectDecodedImage(previewImage);
    await window.getByRole("button", { name: "播放序列" }).click();
    await expect(window.getByRole("button", { name: "暂停序列" })).toBeVisible();
    await window.getByRole("button", { name: "暂停序列" }).click();
    const sourceMetrics = await previewImage.evaluate((element) => {
      const image = element as HTMLImageElement;
      const box = image.getBoundingClientRect();
      return {
        cssWidth: Number.parseFloat(getComputedStyle(image).width),
        cssHeight: Number.parseFloat(getComputedStyle(image).height),
        boxWidth: box.width,
        boxHeight: box.height,
      };
    });
    expect(sourceMetrics.cssWidth / sourceMetrics.cssHeight).toBeCloseTo(16 / 9, 1);
    expect(sourceMetrics.boxWidth / sourceMetrics.boxHeight).toBeCloseTo(16 / 9, 1);

    await viewer.hover({ position: { x: 40, y: 80 } });
    await window
      .getByRole("button", { name: "顺时针旋转 90°" })
      .click();
    await expect(previewImage).toHaveAttribute(
      "style",
      /rotate\(90deg\)/,
    );
    const rotatedMetrics = await previewImage.evaluate((element) => {
      const image = element as HTMLImageElement;
      const box = image.getBoundingClientRect();
      return {
        cssWidth: Number.parseFloat(getComputedStyle(image).width),
        cssHeight: Number.parseFloat(getComputedStyle(image).height),
        boxWidth: box.width,
        boxHeight: box.height,
      };
    });
    // The source element retains its aspect ratio; only the rendered box swaps.
    expect(rotatedMetrics.cssWidth / rotatedMetrics.cssHeight).toBeCloseTo(16 / 9, 1);
    expect(rotatedMetrics.boxWidth / rotatedMetrics.boxHeight).toBeCloseTo(9 / 16, 1);

    const horizontalMirror = window.getByRole("button", { name: "水平镜像" });
    const verticalMirror = window.getByRole("button", { name: "垂直镜像" });
    await horizontalMirror.click();
    await verticalMirror.click();
    await expect(horizontalMirror).toHaveClass(/is-active/);
    await expect(verticalMirror).toHaveClass(/is-active/);
    await expect(previewImage).toHaveAttribute(
      "style",
      /scale\(-1, -1\).*rotate\(90deg\)/,
    );

    const screenshotPath = testInfo.outputPath("sequence-viewer-transforms.png");
    await window.screenshot({ path: screenshotPath });
    await testInfo.attach("sequence-viewer-transforms", {
      path: screenshotPath,
      contentType: "image/png",
    });

    await application.close();
    application = await launch();
    window = await application.firstWindow();
    const restoredCard = window.locator(
      '.asset-card[title="motion_000.png"]',
    );
    await expect(restoredCard).toBeVisible({ timeout: 30_000 });
    await expect(window.locator(".asset-card")).toHaveCount(1);
    await expect(restoredCard.getByText("3F · 13 FPS", { exact: true })).toBeVisible();
  } finally {
    if (application) await application.close().catch(() => undefined);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
