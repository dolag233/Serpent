import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import { resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

/** Minimal single-page PDF with visible text (hand-assembled). */
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n'
  + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n'
  + '4 0 obj<</Length 46>>stream\n'
  + 'BT /F1 24 Tf 30 100 Td (Hello PDF) Tj ET\n'
  + 'endstream endobj\n'
  + '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n'
  + 'xref\n0 6\n0000000000 65535 f \n'
  + '0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000290 00000 n \n0000000385 00000 n \n'
  + 'trailer<</Size 6/Root 1 0 R>>\n'
  + 'startxref\n470\n%%EOF\n',
  'latin1',
);

test("opens a PDF asset in the scrollable page viewer (Serpent-8ca259)", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-pdf-viewer-e2e-"));
  const libraryName = "PDF 查看验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const pdfSourcePath = path.join(temporaryRoot, "document.pdf");
  writeFileSync(pdfSourcePath, MINIMAL_PDF);

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_IMPORT_FILES: pdfSourcePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();

    const assetCard = window.locator(".asset-card").filter({ hasText: "document.pdf" });
    await expect(assetCard).toBeVisible({ timeout: 20_000 });

    await assetCard.dblclick();

    // PDF viewer renders pages into .pdf-viewer-pages and shows the page count.
    const viewer = window.locator(".pdf-viewer");
    await expect(viewer).toBeVisible({ timeout: 30_000 });
    await expect(window.locator(".pdf-viewer-meta")).toContainText("1");
    // The first page canvas renders (canvas with non-zero size).
    await expect
      .poll(
        () => window.locator(".pdf-viewer-pages canvas.pdf-viewer-page").count(),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    const canvas = window.locator(".pdf-viewer-pages canvas.pdf-viewer-page").first();
    const size = await canvas.evaluate((element) => ({
      width: (element as HTMLCanvasElement).width,
      height: (element as HTMLCanvasElement).height,
    }));
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("opens an HTML asset in the embedded browser viewer (Serpent-8ca259)", async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-html-viewer-e2e-"));
  const libraryName = "HTML 查看验收";
  const libraryPath = path.join(temporaryRoot, libraryName);
  const htmlSourcePath = path.join(temporaryRoot, "page.html");
  writeFileSync(
    htmlSourcePath,
    '<!doctype html><html><head><style>body{background:#123456;color:#fff;font-family:sans-serif}</style></head><body><h1 id="serpent-html-marker">Serpent HTML Preview</h1></body></html>',
  );

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: "1",
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
      SERPENT_E2E_IMPORT_FILES: htmlSourcePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await window.getByRole("button", { name: "导入文件", exact: true }).first().click();

    const assetCard = window.locator(".asset-card").filter({ hasText: "page.html" });
    await expect(assetCard).toBeVisible({ timeout: 20_000 });

    await assetCard.dblclick();

    const viewer = window.locator(".html-viewer");
    await expect(viewer).toBeVisible({ timeout: 30_000 });
    // The iframe loads serpent://source with the text/html MIME. Use frameLocator
    // (cross-origin safe) to reach the embedded document's marker element.
    const frame = window.frameLocator(".html-viewer-iframe");
    await expect(frame.locator("#serpent-html-marker")).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator("#serpent-html-marker")).toHaveText("Serpent HTML Preview");
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});