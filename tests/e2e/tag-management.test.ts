import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// Serpent-eaxs / REQ-TAG-010–013: chip-grid tag management workspace —
// chips (not a row list), name/count sorting, canvas-style selection with a
// right-click management menu, merge dialog, and the delete flow that
// regressed in TAG-003.
test("tag management chip grid: create, sort, select, menu, merge, delete", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-tag-mgmt-"));
  const libraryName = "标签管理库";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const profilePath = path.join(temporaryRoot, "profile");
  const sourceRoot = path.join(temporaryRoot, "sources");
  mkdirSync(profilePath);
  mkdirSync(sourceRoot);
  const sourcePath = path.join(sourceRoot, "tag-a.png");
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
    await expect(
      window.getByRole("button", { name: `当前资源库 ${libraryName}` }),
    ).toBeVisible({ timeout: 15_000 });

    // Serpent-eaxs regression: entering management while a discovery input is
    // active must not let the debounced "clear filters → show all" reload
    // close the page and dump the user back on 所有资产.
    await window.getByLabel("搜索资源库").fill("zzz");
    await window.waitForTimeout(400);

    // Enter the management workspace from the sidebar.
    await window
      .locator(".navigation-pane")
      .getByRole("button", { name: "标签管理" })
      .click();
    const workspace = window.getByTestId("tag-management-workspace");
    await expect(workspace).toBeVisible();
    // Outlast the 200ms discovery debounce window: the page must stay open.
    await window.waitForTimeout(500);
    await expect(workspace).toBeVisible();

    // The page anchors to the top of the canvas (no vertically centered
    // blank band above it).
    const canvasBox = await window.locator(".workspace-canvas").boundingBox();
    const workspaceBox = await workspace.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    expect(workspaceBox!.y - canvasBox!.y).toBeLessThan(60);
    // Empty library starts with the empty hint.
    await expect(workspace.getByText("尚无标签，可在上方创建。")).toBeVisible();

    const createInput = workspace.getByLabel("新标签名称");
    const createButton = workspace.getByRole("button", { name: "创建标签" });
    await createInput.fill("beta");
    await createButton.click();
    await createInput.fill("alpha");
    await createButton.click();

    // Chips render in a flow grid — never as the old row list.
    const chips = workspace.locator(".tag-management-chip");
    await expect(chips).toHaveCount(2);
    await expect(workspace.locator(".tag-management-grid")).toHaveCount(1);
    await expect(workspace.locator(".tag-management-list")).toHaveCount(0);
    // Default sort is name ascending.
    await expect(chips.first()).toContainText("alpha");

    // Clicking the active sort key flips direction.
    await workspace
      .locator(".tag-management-sort")
      .getByRole("button", { name: /名称/ })
      .click();
    await expect(chips.first()).toContainText("beta");

    // Plain click selects exactly one chip; Ctrl+click adds to the selection.
    await chips.filter({ hasText: "alpha" }).click();
    const selectionIndicator = workspace.getByText(/已选 \d+ 个标签/);
    await expect(selectionIndicator).toHaveText("已选 1 个标签");
    const additiveModifier = process.platform === "darwin" ? "Meta" : "Control";
    await chips
      .filter({ hasText: "beta" })
      .click({ modifiers: [additiveModifier] });
    await expect(selectionIndicator).toHaveText("已选 2 个标签");

    // Escape clears the selection.
    await workspace.locator(".tag-management-grid").press("Escape");
    await expect(selectionIndicator).toHaveCount(0);

    // Right-click an unselected chip collapses the menu target to just it:
    // the single-tag menu offers browse / rename / delete.
    await chips.filter({ hasText: "alpha" }).click({ button: "right" });
    const menu = window.locator(".context-menu");
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "浏览标签资产" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "重命名" }),
    ).toBeVisible();

    // Inline rename through the menu.
    await menu.getByRole("menuitem", { name: "重命名" }).click();
    const renameInput = workspace.locator(".tag-management-chip-rename");
    await expect(renameInput).toBeFocused();
    await renameInput.fill("gamma");
    await renameInput.press("Enter");
    await expect(chips.filter({ hasText: "gamma" })).toHaveCount(1);
    await expect(chips.filter({ hasText: "alpha" })).toHaveCount(0);

    // Multi-select menu exposes AND/OR search, merge and batch delete.
    await chips.filter({ hasText: "gamma" }).click();
    await chips.filter({ hasText: "beta" }).click({ modifiers: [additiveModifier] });
    await chips.filter({ hasText: "beta" }).click({ button: "right" });
    await expect(
      menu.getByRole("menuitem", { name: "搜索包含这 2 个标签的资产" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "搜索含有任一标签的资产" }),
    ).toBeVisible();

    // Merge the two tags into a newly named tag.
    await menu.getByRole("menuitem", { name: "合并 2 个标签…" }).click();
    const mergeDialog = window.locator(".create-dialog");
    await expect(mergeDialog).toBeVisible();
    await mergeDialog.getByLabel("新标签名称").fill("merged");
    await mergeDialog.getByRole("button", { name: "合并" }).click();
    await expect(mergeDialog).toHaveCount(0);
    await expect(chips).toHaveCount(1);
    await expect(chips.first()).toContainText("merged");

    // Delete flow (TAG-003 regression guard): menu → confirm dialog → gone.
    await chips.first().click({ button: "right" });
    await menu.getByRole("menuitem", { name: "删除" }).click();
    const deleteDialog = window.locator(".create-dialog");
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "删除" }).click();
    await expect(deleteDialog).toHaveCount(0);
    await expect(chips).toHaveCount(0);
    await expect(workspace.getByText("尚无标签，可在上方创建。")).toBeVisible();

    // Double-click browses exactly that tag: management closes, browse shows.
    await createInput.fill("solo");
    await createButton.click();
    await expect(chips).toHaveCount(1);
    await chips.first().dblclick();
    await expect(workspace).toHaveCount(0);
    await expect(window.locator(".workspace-canvas")).toBeVisible();
  } finally {
    await application.close();
  }
});
