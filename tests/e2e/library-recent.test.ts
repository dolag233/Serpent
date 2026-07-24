import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

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
    const restoredFirstTrigger = window.getByRole("button", {
      name: `当前资源库 ${firstName}`,
    });
    await expect(restoredFirstTrigger).toBeVisible({ timeout: 15_000 });

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
