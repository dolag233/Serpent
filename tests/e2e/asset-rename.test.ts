import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
// A second, content-distinct valid PNG so the conflict test does not trip the
// importer's suspected-duplicate detection.
const VALID_PNG_ALT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function launchApp(temporaryRoot: string, libraryPath: string, importFiles?: string) {
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  return electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      ...(importFiles ? { SERPENT_E2E_IMPORT_FILES: importFiles } : {}),
    },
  });
}

async function createLibraryAndImport(window: Page, libraryName: string) {
  await window.getByRole("button", { name: "创建资源库" }).click();
  await window.getByLabel("名称").fill(libraryName);
  await window.getByRole("button", { name: "创建", exact: true }).click();
  await window
    .getByRole("button", { name: "导入文件", exact: true })
    .first()
    .click();
  await expect(window.locator("[data-asset-id]").first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Right-clicks the card whose caption contains fileName and picks 重命名…,
 * returning the open rename dialog.
 */
async function openRenameDialog(window: Page, fileName: string) {
  const card = window.locator("[data-asset-id]", { hasText: fileName });
  await expect(card).toBeVisible();
  await card.click({ button: "right" });
  const menu = window.getByRole("menu");
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await menu.getByRole("menuitem", { name: "重命名…" }).click();
  const dialog = window.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "重命名文件" }),
  ).toBeVisible({ timeout: 5_000 });
  return dialog;
}

// ---------------------------------------------------------------------------
// Test 1 — Rename from the context menu updates the canvas and the real file
// ---------------------------------------------------------------------------

test("renames an asset file from the context menu and renames the real file on disk", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-rename-e2e-"));
  const libraryName = "Rename Basic";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(temporaryRoot, "hero.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();
    await createLibraryAndImport(window, libraryName);

    const dialog = await openRenameDialog(window, "hero.png");
    // The editable field holds the base name, focused and ready; the preserved
    // extension is static text beside it.
    const input = dialog.getByLabel("文件名");
    await expect(input).toHaveValue("hero");
    await expect(input).toBeFocused();
    await expect(dialog.getByText(".png", { exact: true })).toBeVisible();

    await input.fill("hero-renamed");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    const renamedCard = window.locator(
      '[data-asset-id][title="hero-renamed.png"]',
    );
    await expect(renamedCard).toBeVisible({ timeout: 10_000 });
    await expect(
      renamedCard.getByText("hero-renamed.png", { exact: true }),
    ).toBeVisible();
    // The rename keeps the asset selected after the canvas refresh.
    await expect(renamedCard).toHaveAttribute("aria-pressed", "true");

    // The real file inside the library folder was renamed, extension preserved.
    expect(existsSync(path.join(libraryPath, "Assets", "hero-renamed.png"))).toBe(
      true,
    );
    expect(existsSync(path.join(libraryPath, "Assets", "hero.png"))).toBe(false);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2 — Name conflict keeps the dialog open; fixing the name retries fine
// ---------------------------------------------------------------------------

test("keeps the dialog open with an inline conflict error and allows retry after fixing the name", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-rename-conflict-"),
  );
  const libraryName = "Rename Conflict";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const alphaSource = path.join(temporaryRoot, "alpha.png");
  const betaSource = path.join(temporaryRoot, "beta.png");
  writeFileSync(alphaSource, VALID_PNG);
  writeFileSync(betaSource, VALID_PNG_ALT);

  const application = await launchApp(
    temporaryRoot,
    libraryPath,
    [alphaSource, betaSource].join(path.delimiter),
  );

  try {
    const window = await application.firstWindow();
    await createLibraryAndImport(window, libraryName);
    await expect(
      window.locator('[data-asset-id][title="alpha.png"]'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      window.locator('[data-asset-id][title="beta.png"]'),
    ).toBeVisible({ timeout: 15_000 });

    const dialog = await openRenameDialog(window, "alpha.png");
    const input = dialog.getByLabel("文件名");
    await input.fill("beta");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();

    // Conflict: the typed error is shown inline and the dialog stays open.
    await expect(dialog.getByRole("alert")).toContainText(
      "同一文件夹内已存在同名文件",
      { timeout: 10_000 },
    );
    await expect(
      dialog.getByRole("heading", { name: "重命名文件" }),
    ).toBeVisible();
    expect(existsSync(path.join(libraryPath, "Assets", "alpha.png"))).toBe(true);

    // Fix the name and retry: succeeds and closes the dialog.
    await input.fill("alpha-renamed");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(
      window.locator('[data-asset-id][title="alpha-renamed.png"]'),
    ).toBeVisible({ timeout: 10_000 });
    expect(
      existsSync(path.join(libraryPath, "Assets", "alpha-renamed.png")),
    ).toBe(true);
    // The conflicting sibling file was never touched.
    expect(existsSync(path.join(libraryPath, "Assets", "beta.png"))).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — Illegal name shows the invalid-name reason inline; Esc/取消 close
// ---------------------------------------------------------------------------

test("shows an inline invalid-name error for illegal characters and closes on 取消 / Escape", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-rename-invalid-"),
  );
  const libraryName = "Rename Invalid";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const sourcePath = path.join(temporaryRoot, "hero.png");
  writeFileSync(sourcePath, VALID_PNG);

  const application = await launchApp(temporaryRoot, libraryPath, sourcePath);

  try {
    const window = await application.firstWindow();
    await createLibraryAndImport(window, libraryName);

    const dialog = await openRenameDialog(window, "hero.png");
    const input = dialog.getByLabel("文件名");
    await input.fill("bad/name");
    await dialog.getByRole("button", { name: "重命名", exact: true }).click();

    // Invalid name: the reason is shown inline and the dialog stays open.
    await expect(dialog.getByRole("alert")).toContainText(
      "请输入可跨平台安全使用的文件名",
      { timeout: 10_000 },
    );
    await expect(
      dialog.getByRole("heading", { name: "重命名文件" }),
    ).toBeVisible();

    // 取消 closes without renaming anything.
    await dialog
      .locator(".dialog-actions")
      .getByRole("button", { name: "取消" })
      .click();
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    await expect(
      window.locator('[data-asset-id][title="hero.png"]'),
    ).toBeVisible();
    expect(existsSync(path.join(libraryPath, "Assets", "hero.png"))).toBe(true);

    // Reopen: Escape closes the dialog too.
    const dialogAgain = await openRenameDialog(window, "hero.png");
    await window.keyboard.press("Escape");
    await expect(dialogAgain).toBeHidden({ timeout: 5_000 });
    await expect(
      window.locator('[data-asset-id][title="hero.png"]'),
    ).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
