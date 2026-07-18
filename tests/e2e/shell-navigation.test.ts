import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("library switcher, breadcrumbs, and workspace history", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-shell-nav-"));
  const libraryName = "壳层导航库";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const profilePath = path.join(temporaryRoot, "profile");
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(profilePath);
  mkdirSync(sourceRoot);
  const sourcePath = path.join(sourceRoot, "nav-a.png");
  writeFileSync(sourcePath, VALID_PNG);

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
      SERPENT_E2E_USER_DATA_PATH: profilePath,
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
    },
  });

  try {
    const window = await application.firstWindow();

    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByLabel("名称").fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();

    const libraryTrigger = window.getByRole("button", {
      name: `当前资源库 ${libraryName}`,
    });
    await expect(libraryTrigger).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".brand-glyph")).toHaveCount(0);
    await expect(window.getByText("SERPENT / LOCAL WORKSPACE")).toHaveCount(0);

    // History controls: leftmost in the toolbar, before the nav toggle and
    // left of the current directory breadcrumbs.
    const backButton = window.getByRole("button", { name: "后退" });
    const forwardButton = window.getByRole("button", { name: "前进" });
    await expect(backButton).toBeVisible();
    await expect(forwardButton).toBeVisible();
    await expect(
      window.locator(".toolbar-leading > .scope-history"),
    ).toBeVisible();
    await expect(window.locator(".scope-trace .scope-history")).toHaveCount(0);
    await expect(backButton.locator("svg")).toBeVisible();
    await expect(forwardButton.locator("svg")).toBeVisible();
    const navToggle = window.getByRole("button", {
      name: /收起导航|展开导航/,
    });
    const backBox = await backButton.boundingBox();
    const toggleBox = await navToggle.boundingBox();
    const crumbsBox = await window.locator(".scope-breadcrumbs").boundingBox();
    expect(backBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(crumbsBox).not.toBeNull();
    expect(toggleBox!.x).toBeLessThan(backBox!.x);
    expect(backBox!.x).toBeLessThan(crumbsBox!.x);

    // Left sidebar status dots (top/bottom) were removed as redundant.
    await expect(window.locator(".navigation-pane .pane-header")).toHaveCount(
      0,
    );
    await expect(window.locator(".navigation-pane .pane-footer")).toHaveCount(
      0,
    );
    await expect(window.locator(".navigation-pane .status-dot")).toHaveCount(0);
    await expect(window.locator(".navigation-pane .storage-pulse")).toHaveCount(
      0,
    );

    // REQ-TAG-001: the sidebar no longer enumerates tags or offers tag
    // creation; tags live in the Inspector chips and the menu tag picker.
    await expect(
      window.locator(".navigation-pane").getByText("标签", { exact: true }),
    ).toHaveCount(0);
    await expect(
      window
        .locator(".navigation-pane")
        .getByRole("button", { name: "添加标签" }),
    ).toHaveCount(0);

    await libraryTrigger.click();
    await expect(
      window.getByRole("menuitem", { name: "新建资源库…" }),
    ).toBeVisible();
    await expect(
      window.getByRole("menuitem", { name: "打开资源库…" }),
    ).toBeVisible();
    await expect(
      window.getByRole("menuitem", { name: "关闭资源库" }),
    ).toBeVisible();
    await window.keyboard.press("Escape");

    await window
      .getByRole("button", { name: "导入文件", exact: true })
      .first()
      .click();
    await expect(
      window.locator(".asset-card").filter({ hasText: "nav-a.png" }),
    ).toBeVisible({ timeout: 15_000 });

    await window.getByRole("button", { name: "添加文件夹" }).click();
    await window.getByLabel("新文件夹名称").fill("场景");
    await window.keyboard.press("Enter");
    await expect(
      window.getByRole("button", { name: "场景", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    await window.getByRole("button", { name: "场景", exact: true }).click();
    await expect(
      window.locator(".scope-crumb-label.is-current"),
    ).toHaveText("场景");
    await expect(window.locator(".scope-chip")).toHaveCount(0);

    await expect(backButton).toBeEnabled();
    await expect(forwardButton).toBeDisabled();

    await backButton.click();
    await expect(
      window.locator(".scope-crumb-label.is-current"),
    ).toHaveText("所有资产");
    await expect(forwardButton).toBeEnabled();

    await forwardButton.click();
    await expect(
      window.locator(".scope-crumb-label.is-current"),
    ).toHaveText("场景");

    await expect(window.getByText("链接文件夹", { exact: true })).toHaveCount(
      0,
    );
    // REQ-SHELL-013: icon-only folder actions expose hover tooltips via title.
    const addFolderButton = window
      .locator(".navigation-pane")
      .getByRole("button", { name: "添加文件夹" });
    const importLinkedButton = window
      .locator(".navigation-pane")
      .getByRole("button", { name: "导入链接文件夹" });
    await expect(addFolderButton).toBeVisible();
    await expect(importLinkedButton).toBeVisible();
    await expect(addFolderButton).toHaveAttribute(
      "data-hover-tip",
      "添加文件夹",
    );
    await expect(importLinkedButton).toHaveAttribute(
      "data-hover-tip",
      "导入链接文件夹",
    );
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
