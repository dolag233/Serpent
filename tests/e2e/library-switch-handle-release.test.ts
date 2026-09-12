import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  resolveElectronExecutablePath,
  waitForLibraryLoadingToFinish,
} from "./electron-test-helpers";

test.describe.configure({ timeout: 180_000 });

/**
 * Serpent-95d532: switching libraries must release the previous library's
 * SQLite handle (and its watches) on Windows — otherwise the previous
 * library.db cannot be moved or deleted while Serpent keeps running.
 *
 * The probe is file-level on purpose: rename fails EBUSY/EPERM while a handle
 * is held, and deleting the whole library folder also covers leftover watcher
 * handles. Standard switch path: creating/opening another library closes the
 * previous one through runLibraryOpenPipeline (the recent-libraries entry uses
 * the same pipeline).
 */
function launchApp(temporaryRoot: string) {
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
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
    },
  });
}

async function createLibrary(window: Page, name: string, viaSwitcher: boolean) {
  await window.waitForTimeout(2000);
  if (viaSwitcher) {
    await window
      .getByRole("button", { name: /当前资源库/u })
      .first()
      .click();
    await window.getByRole("menuitem", { name: "新建资源库…" }).click();
  } else {
    await window.getByRole("button", { name: "创建资源库" }).first().click();
  }
  await window.getByRole("textbox", { name: "名称" }).fill(name);
  await window.getByRole("button", { name: "创建", exact: true }).click();
  await waitForLibraryLoadingToFinish(window);
  await window.waitForTimeout(1500);
}

/** Renames library.db and deletes the library folder, reporting both outcomes. */
function probeReleased(libraryPath: string): {
  dbRename: string;
  dirDelete: string;
} {
  const dbPath = path.join(libraryPath, ".serpent", "library.db");
  const renamed = `${dbPath}.lockprobe`;
  const result: { dbRename: string; dirDelete: string } = {
    dbRename: "not-attempted",
    dirDelete: "not-attempted",
  };
  try {
    renameSync(dbPath, renamed);
    renameSync(renamed, dbPath);
    result.dbRename = "ok";
  } catch (error) {
    result.dbRename = `locked:${(error as NodeJS.ErrnoException).code ?? "unknown"}`;
    if (existsSync(renamed) && !existsSync(dbPath)) {
      try {
        renameSync(renamed, dbPath);
      } catch {
        // temp fixture; the assertion below already failed
      }
    }
  }
  try {
    rmSync(libraryPath, { recursive: true, force: true });
    result.dirDelete = "ok";
  } catch (error) {
    result.dirDelete = `locked:${(error as NodeJS.ErrnoException).code ?? "unknown"}`;
  }
  return result;
}

test("switching libraries releases the previous library.db and folder", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-switch-release-"));
  const application = await launchApp(temporaryRoot);

  try {
    const window = await application.firstWindow();

    await createLibrary(window, "Release A", false);
    const libraryA = path.join(temporaryRoot, "Release A");
    expect(existsSync(path.join(libraryA, ".serpent", "library.db"))).toBe(true);

    // Switching to another library runs the same close-previous pipeline as the
    // recent-libraries entry.
    await createLibrary(window, "Release B", true);
    expect(
      existsSync(path.join(temporaryRoot, "Release B", ".serpent", "library.db")),
    ).toBe(true);
    await window.waitForTimeout(3000);

    expect(probeReleased(libraryA)).toEqual({
      dbRename: "ok",
      dirDelete: "ok",
    });
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
