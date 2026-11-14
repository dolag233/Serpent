import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_ALT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("copies selected Inspector tags to another asset", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-tag-copy-"));
  const libraryName = "Tag copy test";
  const sourcePath = path.join(temporaryRoot, "source.png");
  const targetPath = path.join(temporaryRoot, "target.png");
  writeFileSync(sourcePath, PNG);
  writeFileSync(targetPath, PNG_ALT);
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: path.join(temporaryRoot, libraryName),
      SERPENT_E2E_IMPORT_FILES: [sourcePath, targetPath].join(path.delimiter),
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
    },
  });
  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    const source = window.locator('[data-asset-name="source.png"]');
    const target = window.locator('[data-asset-name="target.png"]');
    await expect(source).toBeVisible({ timeout: 10_000 });
    await expect(target).toBeVisible({ timeout: 10_000 });
    await window.keyboard.press("Escape");
    await source.click();
    await expect(source).toHaveAttribute("aria-pressed", "true");
    await expect(target).toHaveAttribute("aria-pressed", "false");

    const inspector = window.locator(".inspector-pane");
    await inspector.getByRole("button", { name: "添加标签" }).click();
    await inspector.getByRole("combobox", { name: "添加标签" }).fill("Landscape,Portrait,Texture");
    await inspector.getByRole("combobox", { name: "添加标签" }).press("Enter");
    await expect(inspector.locator(".inspector-tag-chip")).toHaveCount(3);

    await inspector.getByRole("button", { name: "添加标签" }).click();
    const inputBox = await inspector.locator(".tag-input-wrapper").boundingBox();
    const firstTagBox = await inspector.locator(".inspector-tag-chip").first().boundingBox();
    expect(inputBox?.y).toBeLessThan(firstTagBox?.y ?? 0);
    await inspector.getByRole("combobox", { name: "添加标签" }).press("Escape");

    const labels = inspector.locator(".inspector-tag-label");
    await labels.first().click();
    await labels.nth(2).click({ modifiers: ["Shift"] });
    await expect(labels.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(labels.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(labels.nth(2)).toHaveAttribute("aria-pressed", "true");

    // A drag from one chip across the row replaces the previous selection.
    const first = await labels.first().boundingBox();
    const middle = await labels.nth(1).boundingBox();
    const last = await labels.nth(2).boundingBox();
    if (!first || !middle || !last) throw new Error("Tag chips were not laid out.");
    await window.mouse.move(Math.min(first.x, middle.x, last.x) + 1, Math.min(first.y, middle.y, last.y) + 1);
    await window.mouse.down();
    await window.mouse.move(Math.max(first.x + first.width, middle.x + middle.width, last.x + last.width) - 1,
      Math.max(first.y + first.height, middle.y + middle.height, last.y + last.height) - 1, { steps: 6 });
    await window.mouse.up();
    await expect(labels.nth(1)).toHaveAttribute("aria-pressed", "true");
    await labels.nth(1).click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    await expect(labels.nth(1)).toHaveAttribute("aria-pressed", "false");
    await expect(labels.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(labels.nth(2)).toHaveAttribute("aria-pressed", "true");
    await inspector.getByRole("button", { name: "复制选中标签" }).click();
    await window.evaluate(() => navigator.clipboard.writeText('sentinel'));
    await labels.first().focus();
    await window.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
    await expect.poll(() => window.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n"))).toBe("Landscape\nTexture");
    await target.click();
    await inspector.getByRole("button", { name: "粘贴标签" }).focus();
    // The hidden window does not receive Chromium's reserved paste key from
    // CDP; invoke the real menu item that owns the native accelerator instead.
    await application.evaluate(({ Menu, BrowserWindow }) => {
      const menu = Menu.getApplicationMenu();
      const item = menu?.getMenuItemById(process.platform === 'darwin' ? 'edit.paste' : 'shortcut.asset.paste.0');
      const browser = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().endsWith('/main_window/index.html'));
      if (!item || !browser) throw new Error('The native paste command is unavailable.');
      item.click(item, browser, {} as Electron.KeyboardEvent);
    });
    await expect(inspector.locator(".inspector-tag-chip")).toHaveCount(2);
    await expect(inspector.locator(".inspector-tag-chip", { hasText: "Landscape" })).toBeVisible();
    await expect(inspector.locator(".inspector-tag-chip", { hasText: "Texture" })).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
