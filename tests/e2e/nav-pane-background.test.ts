import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 180_000 });

/**
 * Serpent-6e3b10 / Serpent-b29bc4: the blank area **of the folder section** —
 * the indentation gutter left of the rows — returns to the library root on
 * click and accepts managed-folder drops. The collections / smart-collections
 * sections below are not blank space, and neither is the rest of the pane.
 * Serpent-374266 adds the counterpart rule: a folder dropped back where it
 * already is (its own row) changes nothing, so it neither highlights nor
 * reports anything.
 *
 * The first implementation targeted the whole `.navigation-scroll`, and the spot
 * the user actually aims at (right under the tree) was covered by the next
 * section's heading and its "尚无合集" paragraph, so clicks were swallowed. The
 * second one poured over the collections area and added a blank strip that the
 * user did not want. This spec pins the final scope and asserts the element
 * under the point, so a future change cannot silently move the target again.
 */
function launchApp(temporaryRoot: string, libraryPath: string) {
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
    },
  });
}

function folderRow(window: Page, name: string) {
  const escapedName = name.replace(/["\\]/gu, "\\$&");
  return window.locator(
    `.navigation-pane button.nav-row[data-nav-folder-kind="managed"][title="${escapedName}"]`,
  );
}

async function createLibrary(window: Page, name: string) {
  await window.getByRole("button", { name: "创建资源库" }).click();
  await window.getByRole("textbox", { name: "名称" }).fill(name);
  await window.getByRole("button", { name: "创建", exact: true }).click();
  await window.waitForTimeout(2500);
}

/**
 * Folder mutations are rejected while the library transition is still running
 * ("A library transition is already in progress."), so retry until the row
 * exists instead of assuming the first attempt landed.
 *
 * Serpent-186547: the folder-section 「+」 always creates at the library root,
 * so a nested folder is created from its parent's context menu.
 */
async function createFolder(window: Page, name: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await window.getByRole("button", { name: "添加文件夹" }).click();
    const input = window.locator(".nav-inline-edit input");
    try {
      await expect(input).toBeVisible({ timeout: 3_000 });
    } catch {
      await window.waitForTimeout(1_500);
      continue;
    }
    await input.fill(name);
    await input.press("Enter");
    try {
      await expect(folderRow(window, name)).toBeVisible({ timeout: 4_000 });
      return;
    } catch {
      await window.waitForTimeout(1_500);
    }
  }
  throw new Error(`folder ${name} was not created`);
}

async function createSubfolder(window: Page, parentName: string, name: string) {
  await folderRow(window, parentName).click({ button: "right" });
  const menu = window.getByRole("menu", {
    name: `文件夹操作：${parentName}`,
    exact: true,
  });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "新建子文件夹" }).click();
  const input = window.locator(".nav-inline-edit input");
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press("Enter");
  await expect(folderRow(window, name)).toBeVisible({ timeout: 5_000 });
}

async function currentCrumb(window: Page): Promise<string> {
  return (
    (await window.locator(".scope-crumb-label.is-current").textContent()) ?? ""
  );
}

type Point = { x: number; y: number };

function centreOf(box: { x: number; y: number; width: number; height: number }): Point {
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

async function elementClassAt(window: Page, point: Point): Promise<string> {
  return window.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element instanceof HTMLElement
        ? `${element.tagName}.${String(element.className)}`
        : "none";
    },
    point,
  );
}

// Serpent-186547: the folder-section 「+」 is a library-root action; a
// subfolder is created from the folder's context menu instead.
test("folder-section + creates at the library root while a subfolder is in scope", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-nav-plus-"));
  const libraryName = "Nav Plus";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolder(window, "Alpha");
    await createSubfolder(window, "Alpha", "Beta");

    // Enter the subfolder so a folder is plainly in scope, then use 「+」.
    await folderRow(window, "Beta").click();
    await expect.poll(() => currentCrumb(window)).toContain("Beta");
    await createFolder(window, "Created");

    await expect
      .poll(
        () =>
          window.evaluate(async () => {
            const api = (
              globalThis as typeof globalThis & {
                serpent: {
                  library: {
                    listOpen(): Promise<{
                      ok: boolean;
                      value?: Array<{ libraryId: string }>;
                    }>;
                    listFolders(input: { libraryId: string }): Promise<{
                      ok: boolean;
                      value?: Array<{
                        name: string;
                        parentFolderId: string | null;
                      }>;
                    }>;
                  };
                };
              }
            ).serpent.library;
            const open = await api.listOpen();
            const libraryId = open.value?.[0]?.libraryId;
            if (!libraryId) return null;
            const result = await api.listFolders({ libraryId });
            const created = (result.value ?? []).find(
              (item) => item.name === "Created",
            );
            return created ? created.parentFolderId : "missing";
          }),
        { message: "the new folder is a library-root folder" },
      )
      .toBe(null);

    // Same level as Alpha (both top-level), i.e. it did not land inside Beta.
    expect(
      await window.evaluate(() => {
        const depthOf = (name: string) => {
          const row = document.querySelector<HTMLElement>(
            `.navigation-pane button.nav-row[data-nav-folder-kind="managed"][title="${name}"]`,
          );
          return row?.closest<HTMLElement>(".nav-tree-row")?.style.paddingLeft ?? null;
        };
        return `${depthOf("Alpha")}|${depthOf("Created")}|${depthOf("Beta")}`;
      }),
    ).toBe("14px|14px|28px");
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

// Serpent-316493 follow-up: the blank area *is* the library root, so its
// right-click menu is the root folder menu.
test("right-clicking the blank area opens the library-root folder menu", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-nav-root-menu-"));
  const libraryName = "Nav Root Menu";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolder(window, "Alpha");
    await createSubfolder(window, "Alpha", "Beta");

    const betaGutterBox = await window
      .locator('.navigation-pane .nav-tree-row:has(button[title="Beta"])')
      .boundingBox();
    expect(betaGutterBox).not.toBeNull();
    await window.mouse.click(
      Math.round(betaGutterBox!.x + 4),
      Math.round(betaGutterBox!.y + betaGutterBox!.height / 2),
      { button: "right" },
    );

    const menu = window.getByRole("menu", {
      name: "文件夹操作：根目录",
      exact: true,
    });
    await expect(menu).toBeVisible();
    // Serpent-a6c516: the menu starts by naming its subject.
    await expect(
      menu.locator(".context-menu-selection-summary", { hasText: /^根目录$/u }),
    ).toBeVisible();

    // Root-appropriate entries…
    await expect(
      menu.getByRole("menuitem", { name: "在文件浏览器中打开" }),
    ).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "新建文件夹" })).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "导入链接文件夹" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "复制文件夹路径" }),
    ).toBeVisible();
    // …and none of the ones that need a real folder row.
    await expect(menu.getByRole("menuitem", { name: "重命名…" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "移入回收站" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "删除" })).toHaveCount(0);

    // 「新建文件夹」creates at the library root.
    await menu.getByRole("menuitem", { name: "新建文件夹" }).click();
    const input = window.locator(".nav-inline-edit input");
    await expect(input).toBeVisible();
    await input.fill("Rooty");
    await input.press("Enter");
    await expect(folderRow(window, "Rooty")).toBeVisible({ timeout: 10_000 });

    expect(
      await window.evaluate(async () => {
        const api = (
          globalThis as typeof globalThis & {
            serpent: {
              library: {
                listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
                listFolders(input: { libraryId: string }): Promise<{
                  ok: boolean;
                  value?: Array<{ name: string; parentFolderId: string | null }>;
                }>;
              };
            };
          }
        ).serpent.library;
        const open = await api.listOpen();
        const libraryId = open.value?.[0]?.libraryId;
        if (!libraryId) return "no-library";
        const result = await api.listFolders({ libraryId });
        const created = (result.value ?? []).find((item) => item.name === "Rooty");
        return created ? (created.parentFolderId ?? "root") : "missing";
      }),
    ).toBe("root");

    // Serpent-a6c516: the 「资源库根目录」 row opens the very same menu.
    await window
      .getByRole("button", { name: "资源库根目录", exact: true })
      .click({ button: "right" });
    const rowMenu = window.getByRole("menu", {
      name: "文件夹操作：根目录",
      exact: true,
    });
    await expect(rowMenu).toBeVisible();
    await expect(
      rowMenu.locator(".context-menu-selection-summary", { hasText: /^根目录$/u }),
    ).toBeVisible();
    await expect(
      rowMenu.getByRole("menuitem", { name: "在文件浏览器中打开" }),
    ).toBeVisible();
    await expect(
      rowMenu.getByRole("menuitem", { name: "新建文件夹" }),
    ).toBeVisible();
    await expect(rowMenu.getByRole("menuitem", { name: "重命名…" })).toHaveCount(0);
    await window.keyboard.press("Escape");
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("folder-section blank area returns to the root and accepts folder drops", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-nav-bg-"));
  const libraryName = "Nav Background";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolder(window, "Alpha");
    await createSubfolder(window, "Alpha", "Beta");

    const betaRowBox = await folderRow(window, "Beta").boundingBox();
    const betaGutterBox = await window
      .locator('.navigation-pane .nav-tree-row:has(button[title="Beta"])')
      .boundingBox();
    const collectionsHeadingBox = await window
      .locator(".navigation-pane .nav-section-heading > span", {
        hasText: /^合集$/u,
      })
      .boundingBox();
    const collectionsEmptyBox = await window
      .locator(".navigation-scroll p.nav-empty", { hasText: "尚无合集" })
      .boundingBox();
    const navBox = await window.locator(".navigation-scroll").boundingBox();
    expect(betaRowBox).not.toBeNull();
    expect(betaGutterBox).not.toBeNull();
    expect(collectionsHeadingBox).not.toBeNull();
    expect(collectionsEmptyBox).not.toBeNull();
    expect(navBox).not.toBeNull();

    // The indentation gutter is the blank area: it belongs to no row.
    const gutter: Point = {
      x: Math.round(betaGutterBox!.x + 4),
      y: Math.round(betaGutterBox!.y + betaGutterBox!.height / 2),
    };
    const collectionsHeading = centreOf(collectionsHeadingBox!);
    const collectionsEmpty = centreOf(collectionsEmptyBox!);
    const paneBottom: Point = {
      x: Math.round(navBox!.x + navBox!.width / 2),
      y: Math.round(navBox!.y + navBox!.height - 6),
    };

    expect(await elementClassAt(window, gutter)).toContain("nav-tree-row");
    expect(await elementClassAt(window, collectionsEmpty)).toContain("nav-empty");

    // The gutter returns to the library root.
    await folderRow(window, "Beta").click();
    await expect.poll(() => currentCrumb(window)).toContain("Beta");
    await window.mouse.click(gutter.x, gutter.y);
    await window.waitForTimeout(500);
    expect(await currentCrumb(window)).toContain("资源库根目录");

    // Everything outside the folder section stays inert.
    for (const [label, point] of [
      ["collections heading", collectionsHeading],
      ["collections empty state", collectionsEmpty],
      ["pane bottom", paneBottom],
    ] as const) {
      await folderRow(window, "Beta").click();
      await expect
        .poll(() => currentCrumb(window), { message: label })
        .toContain("Beta");
      await window.mouse.click(point.x, point.y);
      await window.waitForTimeout(500);
      expect(await currentCrumb(window), label).toContain("Beta");
    }

    // A folder row keeps its own navigation.
    await folderRow(window, "Beta").click();
    await expect.poll(() => currentCrumb(window)).toContain("Beta");

    // Dropping a folder on the gutter moves it to the library root.
    const listHasHighlight = () =>
      window.evaluate(() => {
        const list = document.querySelector(".nav-folder-list");
        return {
          highlighted: list?.classList.contains("is-root-drop-target") ?? false,
          radius: list ? getComputedStyle(list).borderRadius : "",
        };
      });
    await window.mouse.move(
      betaRowBox!.x + betaRowBox!.width / 2,
      betaRowBox!.y + betaRowBox!.height / 2,
    );
    await window.mouse.down();
    await window.mouse.move(gutter.x, gutter.y, { steps: 12 });
    await expect
      .poll(
        async () => (await listHasHighlight()).highlighted,
        { message: "drag over the folder-section blank area" },
      )
      .toBe(true);
    // The highlight is a rounded rectangle aligned with the row radius.
    expect((await listHasHighlight()).radius).toBe("6px");
    await window.mouse.up();

    await expect(window.locator(".workspace-notice")).toContainText(
      "已移动 1 个文件夹",
      { timeout: 10_000 },
    );
    await expect
      .poll(
        () =>
          window.evaluate(async () => {
            const api = (
              globalThis as typeof globalThis & {
                serpent: {
                  library: {
                    listOpen(): Promise<{
                      ok: boolean;
                      value?: Array<{ libraryId: string }>;
                    }>;
                    listFolders(input: { libraryId: string }): Promise<{
                      ok: boolean;
                      value?: Array<{
                        name: string;
                        relativePath: string;
                        parentFolderId: string | null;
                      }>;
                    }>;
                  };
                };
              }
            ).serpent.library;
            const open = await api.listOpen();
            const libraryId = open.value?.[0]?.libraryId;
            if (!libraryId) return null;
            const result = await api.listFolders({ libraryId });
            const beta = (result.value ?? []).find((item) => item.name === "Beta");
            return beta ? `${beta.relativePath}|${beta.parentFolderId}` : null;
          }),
        { message: "Beta is reparented to the library root" },
      )
      .toBe("Beta|null");

    // The sidebar tree renders Beta at Alpha's level, i.e. it refreshed.
    await expect
      .poll(() =>
        window.evaluate(() => {
          const depthOf = (name: string) => {
            const row = document.querySelector<HTMLElement>(
              `.navigation-pane button.nav-row[data-nav-folder-kind="managed"][title="${name}"]`,
            );
            return row?.closest<HTMLElement>(".nav-tree-row")?.style.paddingLeft ?? null;
          };
          const alpha = depthOf("Alpha");
          const beta = depthOf("Beta");
          return alpha && beta ? `${alpha}|${beta}` : null;
        }),
      )
      .toBe("14px|14px");
    // Serpent-374266: dropping a folder back onto its own row changes nothing,
    // so it must not highlight and must not answer with a notice.
    const noticeText = () =>
      window
        .locator(".workspace-notice")
        .textContent()
        .catch(() => "");
    const noticeBeforeNoop = await noticeText();
    const betaSelfBox = await folderRow(window, "Beta").boundingBox();
    expect(betaSelfBox).not.toBeNull();
    const betaCentre = centreOf(betaSelfBox!);
    await window.mouse.move(betaCentre.x, betaCentre.y);
    await window.mouse.down();
    await window.mouse.move(betaCentre.x + 30, betaCentre.y, { steps: 6 });
    await window.waitForTimeout(300);
    const rowHighlights = await window.evaluate(
      () => document.querySelectorAll(".nav-row.is-drop-target").length,
    );
    await window.mouse.up();
    await window.waitForTimeout(800);
    expect(rowHighlights, "own row is not a drop target").toBe(0);
    expect(await noticeText(), "no notice for a no-op drop").toBe(
      noticeBeforeNoop,
    );

    // Counterpart: a real reparent still works and still reports.
    const alphaBox = await folderRow(window, "Alpha").boundingBox();
    const alphaId = await folderRow(window, "Alpha").getAttribute(
      "data-nav-folder-id",
    );
    expect(alphaBox).not.toBeNull();
    expect(alphaId).toBeTruthy();
    await window.mouse.move(betaCentre.x, betaCentre.y);
    await window.mouse.down();
    await window.mouse.move(
      alphaBox!.x + alphaBox!.width / 2,
      alphaBox!.y + alphaBox!.height / 2,
      { steps: 12 },
    );
    await expect
      .poll(
        () =>
          window.evaluate(
            () => document.querySelectorAll(".nav-row.is-drop-target").length,
          ),
        { message: "the parent row accepts the drag" },
      )
      .toBe(1);
    await window.mouse.up();
    await expect
      .poll(
        () =>
          window.evaluate(async (targetId) => {
            const api = (
              globalThis as typeof globalThis & {
                serpent: {
                  library: {
                    listOpen(): Promise<{
                      ok: boolean;
                      value?: Array<{ libraryId: string }>;
                    }>;
                    listFolders(input: { libraryId: string }): Promise<{
                      ok: boolean;
                      value?: Array<{
                        name: string;
                        parentFolderId: string | null;
                      }>;
                    }>;
                  };
                };
              }
            ).serpent.library;
            const open = await api.listOpen();
            const libraryId = open.value?.[0]?.libraryId;
            if (!libraryId) return null;
            const result = await api.listFolders({ libraryId });
            const beta = (result.value ?? []).find((item) => item.name === "Beta");
            return beta ? beta.parentFolderId === targetId : null;
          }, alphaId),
        { message: "Beta is reparented under Alpha again" },
      )
      .toBe(true);
    await expect(window.locator(".workspace-notice")).toContainText(
      "已移动 1 个文件夹",
      { timeout: 10_000 },
    );
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
