import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test("uses an independent critical window for library disk deletion", async () => {
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "serpent-critical-confirmation-test-"),
  );
  const libraryName = "critical-confirmation-library";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const applicationDirectory =
    process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
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
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      window.getByRole("heading", { name: "导入资产以开始整理" }),
    ).toBeVisible({ timeout: 15_000 });
    expect(existsSync(libraryPath)).toBe(true);

    const libraryId = await window.evaluate(async () => {
      const bridge = globalThis as typeof globalThis & {
        serpent: {
          library: {
            listOpen(): Promise<{
              ok: boolean;
              value?: Array<{ libraryId: string }>;
              error?: { message?: string };
            }>;
          };
        };
      };
      const result = await bridge.serpent.library.listOpen();
      if (!result.ok || !result.value?.[0]) {
        throw new Error(result.error?.message ?? "Expected an open library.");
      }
      return result.value[0].libraryId;
    });

    const openCriticalWindow = async () => {
      const deletion = window.evaluate(async (id) => {
        const bridge = globalThis as typeof globalThis & {
          serpent: {
            library: {
              deleteLibraryFromDisk(input: { libraryId: string }): Promise<{
                ok: boolean;
                error?: { message?: string };
              }>;
            };
          };
        };
        const result = await bridge.serpent.library.deleteLibraryFromDisk({
          libraryId: id,
        });
        return result;
      }, libraryId);
      await expect
        .poll(() => application.windows().length, { timeout: 5_000 })
        .toBeGreaterThan(1);
      return { window: application.windows().at(-1)!, deletion };
    };

    const first = await openCriticalWindow();
    const firstCriticalWindow = first.window;
    await expect(
      firstCriticalWindow.getByRole("heading", { name: "从磁盘删除这个资源库？" }),
    ).toBeVisible();
    await expect(firstCriticalWindow.locator("button.confirm")).toBeVisible();
    await expect(
      firstCriticalWindow.getByRole("button", { name: /不再显示|总是/ }),
    ).toHaveCount(0);
    // Main closes the child synchronously after Escape; Playwright may report
    // that expected target closure from keyboard.press.
    await firstCriticalWindow.keyboard.press("Escape").catch(() => undefined);
    await expect(first.deletion).resolves.toMatchObject({ ok: false });
    await expect.poll(() => existsSync(libraryPath)).toBe(true);

    const second = await openCriticalWindow();
    const secondCriticalWindow = second.window;
    await expect(
      secondCriticalWindow.getByRole("heading", { name: "从磁盘删除这个资源库？" }),
    ).toBeVisible();
    await secondCriticalWindow
      .getByRole("button", { name: "从磁盘删除", exact: true })
      .click()
      .catch(() => undefined);
    await expect(second.deletion).resolves.toMatchObject({ ok: true });
    await expect.poll(() => existsSync(libraryPath)).toBe(false);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
