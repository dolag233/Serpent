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
 */
async function createFolder(window: Page, name: string, parentName?: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (parentName) await folderRow(window, parentName).click();
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

test("folder-section blank area returns to the root and accepts folder drops", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-nav-bg-"));
  const libraryName = "Nav Background";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const application = await launchApp(temporaryRoot, libraryPath);

  try {
    const window = await application.firstWindow();
    await createLibrary(window, libraryName);
    await createFolder(window, "Alpha");
    await createFolder(window, "Beta", "Alpha");

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
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
