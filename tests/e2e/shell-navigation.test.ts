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
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();

    const libraryTrigger = window.getByRole("button", {
      name: `当前资源库 ${libraryName}`,
    });
    await expect(libraryTrigger).toBeVisible({ timeout: 15_000 });
    await expect(window.locator(".brand-glyph")).toHaveCount(0);
    await expect(window.getByText("SERPENT / LOCAL WORKSPACE")).toHaveCount(0);

    // The library switcher is a shell menu, not a context menu, but it uses
    // the same acrylic preference and should receive the default low level.
    await libraryTrigger.click();
    const libraryMenu = window.locator(".library-switcher-menu");
    await expect(libraryMenu).toBeVisible();
    await expect
      .poll(() =>
        libraryMenu.evaluate((element) => getComputedStyle(element).backdropFilter),
      )
      .toContain("blur");
    await libraryTrigger.click();

    // History controls live in the browse column: the nav toggle is in the
    // leading shell cluster, followed by history, the Windows main menu (or
    // the macOS settings entry), and then the breadcrumbs trail.
    const backButton = window.getByRole("button", { name: "后退" });
    const forwardButton = window.getByRole("button", { name: "前进" });
    const settingsButton =
      process.platform === "win32"
        ? window.locator(".main-menu-trigger")
        : window.getByRole("button", { name: /主菜单|设置/ });
    await expect(backButton).toBeVisible();
    await expect(forwardButton).toBeVisible();
    await expect(settingsButton).toBeVisible();
    if (process.platform === "win32") {
      await settingsButton.hover();
      await expect(window.getByRole("menu", { name: "主菜单" })).toHaveCount(0);
      await settingsButton.click();
      await expect(
        window.getByRole("menu", { name: "主菜单" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          window
            .locator(".main-menu-surface")
            .evaluate((element) => getComputedStyle(element).backdropFilter),
        )
        .toContain("blur");
      await expect(window.locator(".main-menu-submenu")).toHaveCount(0);
      for (const label of ["文件", "编辑", "资源库", "窗口", "关于", "设置"]) {
        await expect(
          window.getByRole("menuitem", { name: label, exact: true }),
        ).toBeVisible();
      }
      await window.getByRole("menuitem", { name: "文件", exact: true }).hover();
      const mainSubmenu = window.locator(".main-menu-submenu");
      await expect(mainSubmenu).toBeVisible();
      await expect
        .poll(() =>
          mainSubmenu.evaluate((element) => getComputedStyle(element).backdropFilter),
        )
        .toContain("blur");
      await expect(
        window.getByRole("menuitem", { name: "导入文件", exact: true }),
      ).toBeVisible();
      const fileSection = window.getByRole("menuitem", {
        name: "文件",
        exact: true,
      });
      const fileBox = await fileSection.boundingBox();
      const submenuBox = await mainSubmenu.boundingBox();
      expect(fileBox).not.toBeNull();
      expect(submenuBox).not.toBeNull();
      expect(submenuBox!.y).toBeCloseTo(fileBox!.y, 0);
      expect(submenuBox!.x).toBeCloseTo(fileBox!.x + fileBox!.width, 0);
      expect(submenuBox!.width).toBeLessThan(278);
      await window.getByRole("menuitem", { name: "设置", exact: true }).hover();
      await expect(mainSubmenu).toHaveCount(0);
      await window.getByRole("menuitem", { name: "设置", exact: true }).click();
      await expect(window.getByRole("dialog")).toBeVisible();
      await window.keyboard.press("Escape");
      await expect(window.getByRole("dialog")).toHaveCount(0);

      await settingsButton.click();
      await window.getByRole("menuitem", { name: "关于", exact: true }).hover();
      await expect(window.locator(".main-menu-submenu")).toBeVisible();
      await window
        .getByRole("menuitem", { name: "开源组件与许可", exact: true })
        .click();
      await expect(
        window.getByRole("dialog", { name: "开源组件与许可" }),
      ).toBeVisible();
      await window.keyboard.press("Escape");

      await settingsButton.click();
      await window.getByRole("menuitem", { name: "关于", exact: true }).hover();
      await window.getByRole("menuitem", { name: "关于 Serpent", exact: true }).click();
      const aboutDialog = window.getByRole("dialog", { name: "Serpent" });
      await expect(aboutDialog).toBeVisible();
      await expect(window.getByText("版本 0.1.2", { exact: true })).toBeVisible();
      const refreshButton = aboutDialog.getByRole("button", { name: "检查更新" });
      await expect(refreshButton).toBeVisible();
      await expect(refreshButton).toHaveAttribute("data-hover-tip", "检查更新");
      await refreshButton.hover();
      await expect(window.locator(".hover-tip")).toHaveText("检查更新");
      await expect(aboutDialog.getByText("开发版本不检查更新。", { exact: true })).toBeVisible();
      await window.keyboard.press("Escape");
    } else {
      await application.evaluate(({ BrowserWindow, Menu }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById("about.serpent");
        if (!item?.click) throw new Error("The native About Serpent menu item is unavailable.");
        item.click(item, BrowserWindow.getFocusedWindow() ?? undefined);
      });
      const aboutDialog = window.getByRole("dialog", { name: "Serpent" });
      await expect(aboutDialog).toBeVisible();
      const refreshButton = aboutDialog.getByRole("button", { name: "检查更新" });
      await expect(refreshButton).toBeVisible();
      await expect(refreshButton).toHaveAttribute("data-hover-tip", "检查更新");
      await refreshButton.hover();
      await expect(window.locator(".hover-tip")).toHaveText("检查更新");
      await expect(aboutDialog.getByText("开发版本不检查更新。", { exact: true })).toBeVisible();
      await window.keyboard.press("Escape");

      await settingsButton.click();
      const settingsDialog = window.getByRole("dialog");
      await expect(settingsDialog).toBeVisible();
      await settingsDialog.getByRole("tab", { name: "外观", exact: true }).click();
      const themeColorDisclosure = settingsDialog.getByRole("button", {
        name: "主题色设置",
        exact: true,
      });
      await expect(themeColorDisclosure).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(
        settingsDialog.locator(".app-settings-custom-theme-grid"),
      ).toHaveCount(0);
      await themeColorDisclosure.click();
      await expect(themeColorDisclosure).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await expect(
        settingsDialog.locator(".app-settings-custom-theme-grid"),
      ).toBeVisible();
      await window.keyboard.press("Escape");
      await expect(settingsDialog).toHaveCount(0);
    }
    await expect(
      window.locator(".toolbar-workspace-cluster .scope-history"),
    ).toBeVisible();
    await expect(window.locator(".scope-trace .scope-history")).toHaveCount(0);
    await expect(backButton.locator("svg")).toBeVisible();
    await expect(forwardButton.locator("svg")).toBeVisible();
    const navToggle = window.getByRole("button", {
      name: /收起导航|展开导航/,
    });
    const settingsBox = await settingsButton.boundingBox();
    const backBox = await backButton.boundingBox();
    const toggleBox = await navToggle.boundingBox();
    const crumbsBox = await window.locator(".scope-breadcrumbs").boundingBox();
    const workspaceBox = await window.locator(".workspace").boundingBox();
    expect(settingsBox).not.toBeNull();
    expect(backBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(crumbsBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    expect(toggleBox!.x).toBeLessThan(backBox!.x);
    expect(backBox!.x).toBeLessThan(settingsBox!.x);
    expect(backBox!.x).toBeLessThan(crumbsBox!.x);
    expect(backBox!.x - workspaceBox!.x).toBeCloseTo(14, 0);

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

    // REQ-TAG-001: sidebar must not enumerate all tags or offer inline
    // "添加标签"; a single「标签管理」entry that opens the middle workspace is OK.
    await expect(
      window.locator(".navigation-pane").getByText("标签", { exact: true }),
    ).toHaveCount(0);
    await expect(
      window
        .locator(".navigation-pane")
        .getByRole("button", { name: "添加标签" }),
    ).toHaveCount(0);
    await expect(
      window
        .locator(".navigation-pane")
        .getByRole("button", { name: "标签管理" }),
    ).toHaveCount(1);

    await libraryTrigger.click();
    await expect(
      window.getByRole("menuitem", { name: "新建资源库…" }),
    ).toBeVisible();
    await expect(
      window.getByRole("menuitem", { name: "打开资源库…" }),
    ).toBeVisible();
    await expect(
      window.getByRole("menuitem", { name: "导入资源库" }),
    ).toBeVisible();
    await expect(
      window.getByRole("menuitem", { name: "打开外部资源库…" }),
    ).toHaveCount(0);
    await expect(
      window.getByRole("menuitem", { name: "导入外部资源库" }),
    ).toHaveCount(0);
    await expect(
      window.getByRole("menuitem", { name: "打开同步资源库…" }),
    ).toHaveCount(0);
    await expect(
      window.getByRole("menuitem", { name: "重命名资源库" }),
    ).toHaveCount(0);
    await window.getByRole("menuitem", { name: "打开资源库…" }).click();
    await expect(
      window.getByRole("dialog", { name: "打开资源库" }),
    ).toBeVisible();
    await expect(
      window.getByRole("button", { name: "打开 Serpent 资源库" }),
    ).toBeVisible();
    await expect(
      window.getByRole("button", { name: "打开同步资源库…" }),
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
    // The folder is created under the current browse parent. In the default
    // "所有资产" scope there is intentionally no folder-card row (folder cards
    // only appear inside a managed folder / root view — see FOLDER-010 and
    // folder-card-selection.test.ts), so navigate to the new folder through
    // the sidebar instead of clicking a canvas card. The sidebar row label
    // ellipsis-truncates in narrow panes, which clips its text node and makes
    // Playwright's accessible-name match flaky; target the row element by its
    // exact label text instead.
    await window
      .locator(".navigation-pane .nav-row-label", { hasText: "场景" })
      .locator("xpath=ancestor::button[contains(@class, 'nav-row')]")
      .click();
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
