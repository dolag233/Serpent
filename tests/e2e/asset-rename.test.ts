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
 * returning the inline rename input on the card (REQ-MENU-008).
 */
async function openInlineRename(window: Page, fileName: string) {
  const card = window.locator("[data-asset-id]", { hasText: fileName });
  await expect(card).toBeVisible();
  await card.click({ button: "right" });
  const menu = window.getByRole("menu");
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await menu.getByRole("menuitem", { name: "重命名…" }).click();
  const input = card.locator(".asset-inline-rename-input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeFocused();
  return { card, input };
}

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

    const { card, input } = await openInlineRename(window, "hero.png");
    await expect(input).toHaveValue("hero");
    await expect(card.locator(".asset-inline-rename-ext")).toHaveText(".png");

    await input.fill("hero-renamed");
    await input.press("Enter");

    const renamedCard = window.locator(
      '[data-asset-id][title="hero-renamed.png"]',
    );
    await expect(renamedCard).toBeVisible({ timeout: 10_000 });
    await expect(
      renamedCard.getByText("hero-renamed.png", { exact: true }),
    ).toBeVisible();
    await expect(renamedCard).toHaveAttribute("aria-pressed", "true");

    expect(existsSync(path.join(libraryPath, "Assets", "hero-renamed.png"))).toBe(
      true,
    );
    expect(existsSync(path.join(libraryPath, "Assets", "hero.png"))).toBe(false);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("keeps the inline rename open with a conflict error and allows retry after fixing the name", async () => {
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

    const { card, input } = await openInlineRename(window, "alpha.png");
    await input.fill("beta");
    await input.press("Enter");

    await expect(card.locator(".asset-inline-rename-error")).toContainText(
      "同一文件夹内已存在同名文件",
      { timeout: 10_000 },
    );
    expect(existsSync(path.join(libraryPath, "Assets", "alpha.png"))).toBe(true);

    await input.fill("alpha-renamed");
    await input.press("Enter");
    await expect(
      window.locator('[data-asset-id][title="alpha-renamed.png"]'),
    ).toBeVisible({ timeout: 10_000 });
    expect(
      existsSync(path.join(libraryPath, "Assets", "alpha-renamed.png")),
    ).toBe(true);
    expect(existsSync(path.join(libraryPath, "Assets", "beta.png"))).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("shows an inline invalid-name error for illegal characters and closes on Escape", async () => {
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

    const { card, input } = await openInlineRename(window, "hero.png");
    await input.fill("bad/name");
    await input.press("Enter");

    await expect(card.locator(".asset-inline-rename-error")).toContainText(
      "请输入可跨平台安全使用的文件名",
      { timeout: 10_000 },
    );

    await input.press("Escape");
    await expect(card.locator(".asset-inline-rename-input")).toHaveCount(0, {
      timeout: 5_000,
    });
    await expect(
      window.locator('[data-asset-id][title="hero.png"]'),
    ).toBeVisible();
    expect(existsSync(path.join(libraryPath, "Assets", "hero.png"))).toBe(true);

    const again = await openInlineRename(window, "hero.png");
    await again.input.press("Escape");
    await expect(again.card.locator(".asset-inline-rename-input")).toHaveCount(
      0,
      { timeout: 5_000 },
    );
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
