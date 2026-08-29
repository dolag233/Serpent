import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  _electron as electron,
  expect,
  test,
  type Page,
} from "@playwright/test";

import {
  closeLibraryViaSwitcher,
  importFilesThroughBridge,
  resolveElectronExecutablePath,
  waitForLibraryLoadingToFinish,
} from "./electron-test-helpers";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function createNavigationFixture(
  window: Page,
  folderName: string,
  collectionName: string,
): Promise<void> {
  await window.evaluate(async ({ folderName: targetFolderName, collectionName: targetCollectionName }) => {
    interface Result<T> {
      ok: boolean;
      value?: T;
      error?: { message?: string };
    }
    type LibraryApi = {
      listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
      createFolder(input: {
        libraryId: string;
        name: string;
      }): Promise<Result<unknown>>;
      createCollection(input: {
        libraryId: string;
        name: string;
      }): Promise<Result<unknown>>;
    };
    const bridge = globalThis as typeof globalThis & {
      serpent: { library: LibraryApi };
    };
    const opened = await bridge.serpent.library.listOpen();
    const libraryId = opened.value?.[0]?.libraryId;
    if (!opened.ok || !libraryId) throw new Error("Expected an open library.");
    const folder = await bridge.serpent.library.createFolder({
      libraryId,
      name: targetFolderName,
    });
    if (!folder.ok) {
      throw new Error(folder.error?.message ?? "Could not create folder.");
    }
    const collection = await bridge.serpent.library.createCollection({
      libraryId,
      name: targetCollectionName,
    });
    if (!collection.ok) {
      throw new Error(collection.error?.message ?? "Could not create collection.");
    }
  }, { folderName, collectionName });

  // Bridge mutations bypass the renderer's local refresh path. Refresh through
  // the same command a user uses so the fixture is visible in the sidebar.
  await window.getByRole("button", { name: "刷新磁盘变化" }).click();
  await expect(
    window.locator(".navigation-pane .nav-row-label").filter({ hasText: folderName }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    window.locator(".navigation-pane .nav-row-label").filter({ hasText: collectionName }).first(),
  ).toBeVisible({ timeout: 15_000 });
}

test("lists other recent libraries in the switcher and opens one directly", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-recent-libraries-test-"),
  );
  const profilePath = path.join(temporaryRoot, "profile");
  const firstParentPath = path.join(temporaryRoot, "first");
  const secondParentPath = path.join(temporaryRoot, "second");
  mkdirSync(profilePath);
  mkdirSync(firstParentPath);
  mkdirSync(secondParentPath);
  const firstName = "资源库甲";
  const secondName = "资源库乙";
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = (createParentPath: string) =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_LIBRARY_OPEN_DELAY_MS: "3200",
        // Recent-library persistence is gated off under SERPENT_E2E unless this
        // flag is set; the switcher section depends on the persisted store.
        SERPENT_E2E_RESTORE_RECENT: "1",
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_E2E_CREATE_PARENT_PATH: createParentPath,
      },
    });

  let application = await launch(firstParentPath);
  try {
    let window = await application.firstWindow();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(firstName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    const firstTrigger = window.getByRole("button", {
      name: `当前资源库 ${firstName}`,
    });
    await expect(firstTrigger).toBeVisible();
    await waitForLibraryLoadingToFinish(window);

    // With only the current library in the store, the 其他资源库 section hides.
    await firstTrigger.click();
    await expect(
      window.getByRole("menuitem", { name: "关闭资源库" }),
    ).toBeVisible();
    await expect(window.getByText("其他资源库")).toHaveCount(0);
    await window.getByRole("menuitem", { name: "关闭资源库" }).click();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();
    await application.close();

    application = await launch(secondParentPath);
    window = await application.firstWindow();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(secondName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    const secondTrigger = window.getByRole("button", {
      name: `当前资源库 ${secondName}`,
    });
    await expect(secondTrigger).toBeVisible();
    await waitForLibraryLoadingToFinish(window);

    // The other library from the first session is listed; the open one is not.
    await secondTrigger.click();
    await expect(window.getByText("其他资源库")).toBeVisible();
    const firstMenuItem = window.getByRole("menuitem", { name: firstName });
    await expect(firstMenuItem).toBeVisible();
    await expect(
      window.getByRole("menuitem", { name: secondName }),
    ).toHaveCount(0);

    // Clicking the entry opens that library through the same open pipeline.
    await firstMenuItem.click();
    const loadingDialog = window.getByRole("dialog", {
      name: `正在打开“${firstName}”资源库`,
    });
    await expect(loadingDialog).toBeHidden({ timeout: 1_000 });
    await expect(loadingDialog).toBeVisible({ timeout: 5_000 });
    const restoredFirstTrigger = window.getByRole("button", {
      name: `当前资源库 ${firstName}`,
    });
    await expect(restoredFirstTrigger).toBeVisible({ timeout: 15_000 });
    await expect(loadingDialog).toBeHidden({ timeout: 15_000 });

    // After switching, the section refreshes and now lists the second library.
    await restoredFirstTrigger.click();
    await expect(
      window.getByRole("menuitem", { name: secondName }),
    ).toBeVisible();
    await expect(
      window.getByRole("menuitem", { name: firstName }),
    ).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("keeps decoded previews isolated when switching between libraries", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-library-switch-preview-test-"),
  );
  const profilePath = path.join(temporaryRoot, "profile");
  const firstParentPath = path.join(temporaryRoot, "first");
  const secondParentPath = path.join(temporaryRoot, "second");
  const firstSourcePath = path.join(temporaryRoot, "first.png");
  const secondSourcePath = path.join(temporaryRoot, "second.png");
  mkdirSync(profilePath);
  mkdirSync(firstParentPath);
  mkdirSync(secondParentPath);
  writeFileSync(firstSourcePath, VALID_PNG);
  writeFileSync(secondSourcePath, VALID_PNG);
  const firstName = "切换预览甲";
  const secondName = "切换预览乙";
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = (
    createParentPath: string,
    libraryPath: string,
    importPath: string,
  ) =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_RESTORE_RECENT: "1",
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_E2E_CREATE_PARENT_PATH: createParentPath,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_IMPORT_FILES: importPath,
      },
    });

  const expectDecodedCard = async (
    window: Page,
    fileName: string,
  ) => {
    const card = window.locator(`[data-asset-id][title="${fileName}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    const image = card.locator(`img[alt="${fileName}"]`);
    await expect(image).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        () =>
          image.evaluate((element) => {
            return (
              element instanceof HTMLImageElement &&
              element.complete &&
              element.naturalWidth > 0 &&
              element.naturalHeight > 0
            );
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
  };

  let application = await launch(
    firstParentPath,
    path.join(firstParentPath, firstName),
    firstSourcePath,
  );
  try {
    let window = await application.firstWindow();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(firstName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByRole("button", { name: `当前资源库 ${firstName}` }),
    ).toBeVisible();
    await waitForLibraryLoadingToFinish(window);
    await importFilesThroughBridge(window);
    await expectDecodedCard(window, "first.png");

    await closeLibraryViaSwitcher(window, firstName);
    await application.close();

    application = await launch(
      secondParentPath,
      path.join(secondParentPath, secondName),
      secondSourcePath,
    );
    window = await application.firstWindow();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(secondName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByRole("button", { name: `当前资源库 ${secondName}` }),
    ).toBeVisible();
    await waitForLibraryLoadingToFinish(window);
    await importFilesThroughBridge(window);
    await expectDecodedCard(window, "second.png");

    const secondTrigger = window.getByRole("button", {
      name: `当前资源库 ${secondName}`,
    });
    await secondTrigger.click();
    await window.getByRole("menuitem", { name: firstName }).click();
    await expect(
      window.getByRole("button", { name: `当前资源库 ${firstName}` }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForLibraryLoadingToFinish(window);
    await expectDecodedCard(window, "first.png");

    const firstTrigger = window.getByRole("button", {
      name: `当前资源库 ${firstName}`,
    });
    await firstTrigger.click();
    await window.getByRole("menuitem", { name: secondName }).click();
    await expect(
      window.getByRole("button", { name: `当前资源库 ${secondName}` }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForLibraryLoadingToFinish(window);
    await expectDecodedCard(window, "second.png");
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("does not retain the previous library navigation while switching", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-library-switch-navigation-test-"),
  );
  const profilePath = path.join(temporaryRoot, "profile");
  const firstParentPath = path.join(temporaryRoot, "first");
  const secondParentPath = path.join(temporaryRoot, "second");
  mkdirSync(profilePath);
  mkdirSync(firstParentPath);
  mkdirSync(secondParentPath);
  const firstName = "导航隔离甲";
  const secondName = "导航隔离乙";
  const firstFolderName = "仅甲文件夹";
  const firstCollectionName = "仅甲合集";
  const secondFolderName = "仅乙文件夹";
  const secondCollectionName = "仅乙合集";
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = (createParentPath: string) =>
    electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath,
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_CLOSE_DELAY_MS: "2000",
        SERPENT_E2E_RESTORE_RECENT: "1",
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_E2E_CREATE_PARENT_PATH: createParentPath,
      },
    });

  let application = await launch(firstParentPath);
  try {
    let window = await application.firstWindow();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(firstName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByRole("button", { name: `当前资源库 ${firstName}` }),
    ).toBeVisible();
    await waitForLibraryLoadingToFinish(window);
    await createNavigationFixture(window, firstFolderName, firstCollectionName);

    await closeLibraryViaSwitcher(window, firstName);
    await application.close();

    application = await launch(secondParentPath);
    window = await application.firstWindow();
    await expect(
      window.getByRole("heading", { name: "创建本地资源库" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(secondName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByRole("button", { name: `当前资源库 ${secondName}` }),
    ).toBeVisible();
    await waitForLibraryLoadingToFinish(window);
    await createNavigationFixture(window, secondFolderName, secondCollectionName);

    const secondTrigger = window.getByRole("button", {
      name: `当前资源库 ${secondName}`,
    });
    await secondTrigger.click();
    await window.getByRole("menuitem", { name: firstName }).click();
    await expect(
      window.getByRole("button", { name: `当前资源库 ${firstName}` }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForLibraryLoadingToFinish(window);
    // The assertion intentionally runs as soon as the identity switches. The
    // old implementation committed the new library before its delayed
    // navigation hydration and left the second library's rows visible here.
    expect(
      await window.locator(".navigation-pane .nav-row-label").filter({ hasText: secondFolderName }).count(),
    ).toBe(0);
    expect(
      await window.locator(".navigation-pane .nav-row-label").filter({ hasText: secondCollectionName }).count(),
    ).toBe(0);
    await expect(
      window.locator(".navigation-pane .nav-row-label").filter({ hasText: firstFolderName }).first(),
    ).toBeVisible({ timeout: 1_800 });
    await expect(
      window.locator(".navigation-pane .nav-row-label").filter({ hasText: firstCollectionName }).first(),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
