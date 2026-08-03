import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import {
  closeLibraryViaSwitcher,
  resolveElectronExecutablePath,
} from "./electron-test-helpers";

function sidebarFolderRow(window: Page, folderName: string) {
  return window
    .locator(".navigation-pane .nav-row-label", { hasText: folderName })
    .locator("xpath=ancestor::button[contains(@class, 'nav-row')]");
}

test("creates, closes, and reopens a library through the sandboxed UI", async () => {
  const testInfo = test.info();
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-electron-test-"),
  );
  const libraryName = "视觉参考";
  const libraryPath = path.join(temporaryRoot, libraryName);
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
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
    },
  });

  try {
    const window = await application.firstWindow();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();

    const rendererCapabilities = await window.evaluate(() => ({
      hasNodeProcess: typeof globalThis.process !== "undefined",
      hasRequire: typeof globalThis.require !== "undefined",
    }));
    expect(rendererCapabilities).toEqual({
      hasNodeProcess: false,
      hasRequire: false,
    });

    const lifecycleEvents = window.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const bridge = globalThis as typeof globalThis & {
            serpent: {
              library: {
                onLifecycle(
                  listener: (event: { type: string }) => void,
                ): () => void;
              };
            };
          };
          const eventTypes: string[] = [];
          const unsubscribe = bridge.serpent.library.onLifecycle((event) => {
            eventTypes.push(event.type);
            if (event.type === "library.closed") {
              unsubscribe();
              resolve(eventTypes);
            }
          });
        }),
    );

    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();

    await closeLibraryViaSwitcher(window, libraryName);
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();
    expect(await lifecycleEvents).toEqual([
      "library.opening",
      "library.opened",
      "library.closed",
    ]);
    await window.getByRole("button", { name: "打开资源库" }).click();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();
    const screenshotPath = testInfo.outputPath("library-ready.png");
    await window.screenshot({ path: screenshotPath });
    await testInfo.attach("library-ready", {
      path: screenshotPath,
      contentType: "image/png",
    });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("restores the recent library and focuses the last browsed asset after a full restart", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-restart-test-"),
  );
  const libraryName = "重启恢复";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const profilePath = path.join(temporaryRoot, "profile");
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(profilePath);
  mkdirSync(sourceRoot);
  const sourcePaths = ["first.txt", "remember-me.txt"].map((name) => {
    const sourcePath = path.join(sourceRoot, name);
    writeFileSync(sourcePath, name);
    return sourcePath;
  });
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = () =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_RESTORE_RECENT: "1",
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
      },
    });

  let application = await launch();
  try {
    let window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();
    await window.getByRole("button", { name: "添加文件夹" }).click();
    await window.getByLabel("新文件夹名称").fill("恢复文件夹");
    await window.keyboard.press("Enter");
    await sidebarFolderRow(window, "恢复文件夹").click();
    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    const rememberedCard = window.locator(".asset-card", {
      hasText: "remember-me.txt",
    });
    await rememberedCard.click();
    await expect(rememberedCard).toHaveAttribute("aria-pressed", "true");
    await application.close();

    application = await launch();
    window = await application.firstWindow();
    await expect(
      window.getByText(libraryName, { exact: true }).first(),
    ).toBeVisible();
    const restoredCard = window.locator(".asset-card", {
      hasText: "remember-me.txt",
    });
    await expect(restoredCard).toHaveAttribute("aria-pressed", "true");
    const restoredAssetId = await restoredCard.getAttribute("data-asset-id");
    await expect
      .poll(() =>
        window.evaluate(
          () =>
            (document.activeElement as HTMLElement | null)?.dataset.assetId ??
            null,
        ),
      )
      .toBe(restoredAssetId);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("falls back to the start screen when the recent library no longer exists", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-missing-recent-test-"),
  );
  const profilePath = path.join(temporaryRoot, "profile");
  mkdirSync(profilePath);
  writeFileSync(
    path.join(profilePath, "recent-library.json"),
    JSON.stringify({
      version: 1,
      libraryPath: path.join(temporaryRoot, "deleted-library"),
      updatedAt: new Date().toISOString(),
    }),
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
      SERPENT_E2E_RESTORE_RECENT: "1",
      SERPENT_E2E_USER_DATA_PATH: profilePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() =>
        window.evaluate(() => document.readyState),
      )
      .toBe("complete");
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
