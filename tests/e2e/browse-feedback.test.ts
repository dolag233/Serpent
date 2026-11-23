import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type Locator, type Page } from "@playwright/test";

import { importFilesThroughBridge, resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

const libraryName = "Browse Feedback";
const parentName = "Reference Folder";
const fileName = "sample-art.png";
const textName = "slow-notes.txt";
const textContents = "Preview fixture with a gated source read.";
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function withApp(run: (context: {
  application: Awaited<ReturnType<typeof electron.launch>>;
  window: Page;
  root: string;
}) => Promise<void>, includeText = false) {
  const root = mkdtempSync(path.join(tmpdir(), "serpent-browse-feedback-"));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const source = path.join(root, fileName);
    writeFileSync(source, validPng);
    const sources = [source];
    if (includeText) {
      const notes = path.join(root, textName);
      writeFileSync(notes, textContents);
      sources.push(notes);
    }
    const folderSource = path.join(root, "Import Source");
    mkdirSync(folderSource);
    writeFileSync(path.join(folderSource, "sample.txt"), "Folder import fixture");
    const clipboardSource = path.join(root, "clipboard.png");
    writeFileSync(clipboardSource, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ));
    const cwd = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
    application = await electron.launch({
      args: [cwd],
      cwd,
      executablePath: resolveElectronExecutablePath(),
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_HIDE_WINDOW: "1",
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_IMPORT_FILES: sources.join(path.delimiter),
        SERPENT_E2E_IMPORT_FOLDER: folderSource,
        SERPENT_E2E_CLIPBOARD_IMAGE_PATH: clipboardSource,
        SERPENT_E2E_USER_DATA_PATH: path.join(root, "user-data"),
      },
    });
    await run({ application, window: await application.firstWindow(), root });
  } finally {
    try {
      await application?.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

async function submitLibraryName(window: Page) {
  await window.getByRole("button", { name: "创建资源库", exact: true }).click();
  await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
  await window.getByRole("button", { name: "创建", exact: true }).click();
}

function rootRow(window: Page) {
  return window.locator(".navigation-pane .nav-row").filter({ hasText: "资源库根目录" });
}

async function openBlankCanvasMenu(window: Page) {
  const canvas = window.locator(".workspace-canvas");
  await expect(canvas).toBeVisible();
  const rect = await canvas.boundingBox();
  expect(rect).not.toBeNull();
  await window.mouse.click(rect!.x + rect!.width - 36, rect!.y + rect!.height - 36, { button: "right" });
  return window.getByRole("menu");
}

async function selectNameWithMouse(window: Page, input: Locator) {
  await expect(input).toBeFocused();
  const initial = await input.evaluate((el: HTMLInputElement) => {
    const style = getComputedStyle(el);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = style.font;
    const textWidth = context.measureText(el.value).width;
    return {
      selectedLength: (el.selectionEnd ?? 0) - (el.selectionStart ?? 0),
      textWidth,
      textLeft: style.textAlign === "center"
        ? (el.getBoundingClientRect().width - textWidth) / 2
        : el.clientLeft + parseFloat(style.paddingLeft),
    };
  });
  const rect = await input.boundingBox();
  expect(rect).not.toBeNull();
  const y = rect!.y + rect!.height / 2;
  const textLeft = rect!.x + initial.textLeft;
  await window.mouse.move(textLeft + initial.textWidth * 0.2, y);
  await window.mouse.down();
  await window.mouse.move(textLeft + initial.textWidth * 0.6, y, { steps: 10 });
  await window.mouse.up();
  const length = await input.evaluate((el: HTMLInputElement) =>
    (el.selectionEnd ?? 0) - (el.selectionStart ?? 0),
  );
  const field = await input.getAttribute("class");
  expect(length, field ?? undefined).toBeGreaterThan(0);
  expect(length, field ?? undefined).toBeLessThan(initial.selectedLength);
}

test("selects part of a file and a folder name by mouse while renaming", async () => {
  await withApp(async ({ window, root }) => {
    await submitLibraryName(window);
    await expect(rootRow(window)).toBeVisible();
    await window.getByRole("button", { name: "添加文件夹" }).click();
    const createInput = window.locator(".nav-inline-edit input");
    await createInput.fill(parentName);
    await createInput.press("Enter");
    await expect.poll(() => statSync(path.join(root, libraryName, "Assets", parentName), { throwIfNoEntry: false })?.isDirectory()).toBe(true);
    await rootRow(window).click();
    await importFilesThroughBridge(window);

    const cards = [
      [window.locator(`[data-asset-name="${fileName}"]`), ".asset-inline-rename-input"],
      [window.locator(".folder-card").filter({ hasText: parentName }), ".folder-card-rename-input"],
    ] as const;
    for (const [card, selector] of cards) {
      await card.click();
      await window.keyboard.press("F2");
      const input = window.locator(selector);
      await selectNameWithMouse(window, input);
      await input.press("Escape");
      await expect(input).toHaveCount(0);
      await expect(card).toHaveAttribute("draggable", "true");
    }
  });
});

test("selects part of the folder name in the sidebar after F2", async () => {
  await withApp(async ({ window }) => {
    await submitLibraryName(window);
    await expect(rootRow(window)).toBeVisible();
    await window.getByRole("button", { name: "添加文件夹" }).click();
    const input = window.locator(".navigation-pane .nav-inline-edit input");
    await input.fill("视频素材");
    await input.press("Enter");
    const folder = window.locator('.navigation-pane .nav-row[data-hover-tip="视频素材"]');
    await folder.click();
    await window.keyboard.press("F2");
    await expect(input).toHaveValue("视频素材");
    await selectNameWithMouse(window, input);
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(folder).toBeVisible();
  });
});

test("creates a nested folder from blank canvas only in a folder scope", async () => {
  await withApp(async ({ window, root }) => {
    await submitLibraryName(window);
    await expect(rootRow(window)).toBeVisible();
    let menu = await openBlankCanvasMenu(window);
    await expect(menu.getByRole("menuitem", { name: /新建(?:子)?文件夹/u })).toHaveCount(0);
    await window.keyboard.press("Escape");
    await rootRow(window).click();

    for (const [folderLabel, name] of [["资源库根目录", parentName], [parentName, "Nested Folder"]] as const) {
      menu = await openBlankCanvasMenu(window);
      await expect(menu.getByRole("group", { name: folderLabel })).toBeVisible();
      await menu.getByRole("menuitem", { name: /新建(?:子)?文件夹/u }).click();
      const input = window.locator(".nav-inline-edit input");
      await expect(input).toBeFocused();
      await input.fill(name);
      await input.press("Enter");
      const card = window.locator(".folder-card").filter({ hasText: name });
      await expect(card).toBeVisible();
      if (name === parentName) {
        await card.dblclick();
        await window.getByRole("button", { name: "收起导航" }).click();
      }
    }
    const nestedPath = path.join(root, libraryName, "Assets", parentName, "Nested Folder");
    expect(statSync(nestedPath).isDirectory()).toBe(true);
  });
});

test("imports and pastes into the directory named by the blank canvas menu", async () => {
  await withApp(async ({ window, root }) => {
    await submitLibraryName(window);
    await expect(rootRow(window)).toBeVisible();
    await window.getByRole("button", { name: "添加文件夹" }).click();
    const input = window.locator(".nav-inline-edit input");
    await input.fill(parentName);
    await input.press("Enter");
    const folder = window.locator(`.navigation-pane .nav-row[data-hover-tip="${parentName}"]`);
    await folder.click();
    const target = path.join(root, libraryName, "Assets", parentName);
    const refresh = window.getByRole("button", { name: "刷新磁盘变化" });

    const chooseAction = async (name: string) => {
      await expect(refresh).toBeEnabled();
      await folder.click();
      const menu = await openBlankCanvasMenu(window);
      await menu.getByRole("group", { name: parentName }).getByRole("menuitem", { name, exact: true }).click();
    };

    await chooseAction("导入文件…");
    await expect.poll(() => statSync(path.join(target, fileName), { throwIfNoEntry: false })?.isFile()).toBe(true);
    await chooseAction("粘贴");
    await expect.poll(() => readdirSync(target).some(file => /^Clipboard .*\.png$/u.test(file))).toBe(true);
    await chooseAction("导入文件夹…");
    await expect.poll(() => readdirSync(target, { recursive: true }).some(file => path.basename(file.toString()) === "sample.txt")).toBe(true);
  });
});

test("Enter closes only an Enter-opened viewer and restores the browse selection", async () => {
  await withApp(async ({ window }) => {
    await submitLibraryName(window);
    await expect(rootRow(window)).toBeVisible();
    await rootRow(window).click();
    await importFilesThroughBridge(window);
    const card = window.locator(`[data-asset-name="${fileName}"]`);
    const viewer = window.locator(".workspace-viewer");
    const expectDecodedPreview = async () => {
      await expect(viewer).toBeVisible();
      await expect.poll(() => viewer.locator("img").evaluateAll((images) =>
        images.some((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
      )).toBe(true);
    };

    await card.click();
    await window.keyboard.down("Enter");
    await expectDecodedPreview();
    await window.keyboard.down("Enter");
    await expect(viewer).toBeVisible();
    await window.keyboard.up("Enter");
    await window.keyboard.press("Enter");
    await expect(viewer).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    await expect(window.getByRole("tab", { name: "资源库根目录", selected: true })).toBeVisible();

    await card.dblclick();
    await expectDecodedPreview();
    await window.keyboard.press("Enter");
    await expect(viewer).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);

    await card.click();
    await window.keyboard.press("Space");
    await expectDecodedPreview();
    await window.keyboard.press("Enter");
    await expect(viewer).toBeVisible();
  });
});

test("shows delayed viewer feedback while retaining the previous decoded image", async () => {
  await withApp(async ({ application, window }) => {
    await submitLibraryName(window);
    await expect(rootRow(window)).toBeVisible();
    await rootRow(window).click();
    await importFilesThroughBridge(window);

    const imageCard = window.locator(`[data-asset-name="${fileName}"]`);
    const textCard = window.locator(`[data-asset-name="${textName}"]`);
    await expect(textCard).toBeVisible();
    const textAssetId = await textCard.getAttribute("data-asset-id");
    expect(textAssetId).toBeTruthy();

    await application.evaluate(({ ipcMain }, assetId) => {
      type Request = { type?: string; assetId?: string };
      type Handler = (event: Electron.IpcMainInvokeEvent, input: Request) => unknown;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
      const channel = "serpent:library:request";
      const original = handlers.get(channel);
      if (!original) throw new Error("Expected the library request handler.");
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      handlers.set(channel, async (event, input) => {
        if (input.type === "asset.text.read.request" && input.assetId === assetId) await held;
        return original(event, input);
      });
      Object.assign(globalThis, { releaseViewerTextRead: () => {
        handlers.set(channel, original);
        release();
      } });
    }, textAssetId);

    const status = window.locator(".viewer-loading-status");
    try {
      await imageCard.dblclick();
      const image = window.locator(".workspace-viewer img.preview-image:not(.is-hidden)").first();
      await expect.poll(() => image.evaluate((el: HTMLImageElement) =>
        el.complete && el.naturalWidth > 0,
      )).toBe(true);
      await expect(status).toHaveCount(0);

      const next = window.locator(".workspace-viewer .preview-nav.is-next");
      await window.keyboard.press(await next.isEnabled() ? "ArrowRight" : "ArrowLeft");
      await expect(status).toHaveCSS("opacity", "1");
      await expect(status).toHaveText("正在加载…");
      await expect(image).toBeVisible();
    } finally {
      await application.evaluate(() => {
        const pending = globalThis as typeof globalThis & { releaseViewerTextRead?: () => void };
        pending.releaseViewerTextRead?.();
        delete pending.releaseViewerTextRead;
      });
    }
    await expect(window.locator(".workspace-viewer textarea.preview-text-input")).toHaveValue(textContents);
    await expect(status).toHaveCount(0);
  }, true);
});

test("keeps the library overlay hidden while the native location picker is pending", async () => {
  await withApp(async ({ application, window, root }) => {
    const retryName = "Created Fixture";
    const retryAssets = path.join(root, retryName, "Assets");
    const nameInput = window.getByRole("textbox", { name: "名称" });
    // The deferred dialog drives the real Main IPC without opening a foreground OS window.
    await application.evaluate(({ dialog }) => {
      const originalShowOpenDialog = dialog.showOpenDialog;
      const previousE2e = process.env.SERPENT_E2E;
      delete process.env.SERPENT_E2E;
      const state = globalThis as typeof globalThis & { finishCreatePicker?: () => void };
      dialog.showOpenDialog = () => new Promise((resolve) => {
        state.finishCreatePicker = () => {
          dialog.showOpenDialog = originalShowOpenDialog;
          process.env.SERPENT_E2E = previousE2e;
          resolve({ canceled: true, filePaths: [] });
          delete state.finishCreatePicker;
        };
      });
    });

    try {
      await submitLibraryName(window);
      await expect.poll(() => application.evaluate(() =>
        "finishCreatePicker" in globalThis,
      )).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      await expect(window.locator("[data-library-loading-overlay]")).toHaveCount(0);
      await expect(nameInput).toHaveValue(libraryName);
    } finally {
      await application.evaluate(() => {
        (globalThis as typeof globalThis & { finishCreatePicker?: () => void }).finishCreatePicker?.();
      });
    }
    await expect(nameInput).toHaveValue(libraryName);
    expect(statSync(path.join(root, libraryName), { throwIfNoEntry: false })).toBeUndefined();
    await nameInput.fill(retryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(window.getByText(retryName, { exact: true }).first()).toBeVisible();
    expect(statSync(retryAssets).isDirectory()).toBe(true);
  });
});
