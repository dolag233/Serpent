import { _electron as electron, expect, test, type Page } from "@playwright/test";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

/**
 * Wave 3 UI/UX audit capture utility (not part of the gate suites): drives the
 * real app through the primary surfaces and saves screenshots to
 * docs/qa/evidence/wave3-ux-audit/ for human/agent visual review.
 */
test.describe.configure({ timeout: 180_000 });

const OUT_DIR = path.join(process.cwd(), "docs", "qa", "evidence", "wave3-ux-audit");

// ── Minimal truecolor PNG encoder (solid colors, any dimensions) ────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const name = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function shot(window: Page, name: string) {
  await window.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
}

test("capture primary UI surfaces for the wave-3 UX audit", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-ux-audit-"));
  mkdirSync(OUT_DIR, { recursive: true });
  const libraryPath = path.join(temporaryRoot, "审计资源库.serpent");

  const sources = [
    { name: "wide-red.png", width: 640, height: 360, rgb: [0xc0, 0x39, 0x2b] as [number, number, number] },
    { name: "tall-green.png", width: 360, height: 640, rgb: [0x1e, 0x84, 0x49] as [number, number, number] },
    { name: "square-blue.png", width: 400, height: 400, rgb: [0x2b, 0x62, 0xc4] as [number, number, number] },
    { name: "wide-orange.png", width: 800, height: 450, rgb: [0xd0, 0x7a, 0x1e] as [number, number, number] },
    { name: "tall-purple.png", width: 300, height: 600, rgb: [0x6a, 0x3a, 0xa0] as [number, number, number] },
    { name: "small-gray.png", width: 200, height: 200, rgb: [0x77, 0x7c, 0x79] as [number, number, number] },
  ];
  const sourcePaths = sources.map((source) => {
    const file = path.join(temporaryRoot, source.name);
    writeFileSync(file, solidPng(source.width, source.height, source.rgb));
    return file;
  });

  const app = await electron.launch({
    args: [process.cwd()],
    cwd: process.cwd(),
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
    },
  });

  try {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    // 01 — start page (create-library surface, no sidebar/«01»).
    await expect(window.getByRole("button", { name: "创建资源库" })).toBeVisible({ timeout: 20_000 });
    await shot(window, "01-start-page");

    // Create and open the library.
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill("UX 审计");
    await shot(window, "02-create-library-dialog");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(window.getByRole("button", { name: "添加文件夹" })).toBeVisible({ timeout: 20_000 });

    // Inline-create a folder (left in edit mode for the shot).
    await window.getByRole("button", { name: "添加文件夹" }).click();
    const inlineInput = window.locator(".nav-inline-edit input");
    await expect(inlineInput).toBeVisible({ timeout: 5_000 });
    await shot(window, "03-inline-folder-create");
    await inlineInput.fill("素材");
    await inlineInput.press("Enter");
    await expect(window.getByRole("button", { name: "素材", exact: true })).toBeVisible({ timeout: 10_000 });

    // Import the fixture files, then wait for thumbnails to decode.
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();
    await expect(window.locator(".asset-card")).toHaveCount(6, { timeout: 20_000 });
    await window
      .locator(".asset-card img")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(() => undefined);
    await window.waitForTimeout(1_500);
    await shot(window, "04-canvas-grid");

    // Select a card → Inspector.
    await window.locator(".asset-card").first().click();
    await window.waitForTimeout(800);
    await shot(window, "05-inspector-selected");

    // Asset context menu.
    await window.locator(".asset-card").first().click({ button: "right" });
    await expect(window.getByRole("menuitem", { name: "重命名…" })).toBeVisible({ timeout: 5_000 });
    await shot(window, "06-asset-context-menu");
    await window.keyboard.press("Escape");

    // Folder context menu (open section + copy path + inline actions).
    await window.getByRole("button", { name: "素材", exact: true }).click({ button: "right" });
    await expect(window.getByRole("menuitem", { name: "复制文件夹路径" })).toBeVisible({ timeout: 5_000 });
    await shot(window, "07-folder-context-menu");

    // Copy folder path → toast with fade lifecycle.
    await window.getByRole("menuitem", { name: "复制文件夹路径" }).click();
    await expect(window.locator(".toast")).toBeVisible({ timeout: 5_000 });
    await shot(window, "08-toast");
    await window.waitForTimeout(5_600); // let the notice dismiss (5s + fade)

    // Filter panel: presets + tag picker.
    await window.getByRole("button", { name: "标签", exact: true }).click();
    await window.getByLabel("标签过滤").focus();
    await window.waitForTimeout(400);
    await shot(window, "09-filter-panel");
    await window.getByRole("button", { name: "标签", exact: true }).click();

    // Trash one asset via menu, then open the trash (preview retention).
    await window.locator(".asset-card").first().click({ button: "right" });
    await window.getByRole("menuitem", { name: "移入回收站" }).click();
    await expect(window.locator(".asset-card")).toHaveCount(5, { timeout: 10_000 });
    await window.getByRole("button", { name: "回收站" }).click();
    await expect(window.locator(".asset-card")).toHaveCount(1, { timeout: 10_000 });
    await window.waitForTimeout(1_000);
    await shot(window, "10-trash-view");

    // Viewer page (from the remaining assets).
    await window.getByRole("button", { name: /所有资产/ }).click();
    await expect(window.locator(".asset-card")).toHaveCount(5, { timeout: 10_000 });
    await window.locator(".asset-card").first().dblclick();
    await window.waitForTimeout(1_800);
    await shot(window, "11-viewer-page");
  } finally {
    await app.close().catch(() => undefined);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
