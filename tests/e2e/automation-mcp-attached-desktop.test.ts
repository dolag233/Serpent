import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

type ToolEnvelope = {
  ok: boolean;
  result?: Record<string, unknown>;
  [key: string]: unknown;
};

function readToolEnvelope(response: unknown): ToolEnvelope {
  const content = response && typeof response === 'object' && 'content' in response
    ? response.content
    : undefined;
  const textPart = Array.isArray(content)
    ? content.find((part): part is { type: 'text'; text: string } => (
      typeof part === 'object'
      && part !== null
      && 'type' in part
      && part.type === 'text'
      && 'text' in part
      && typeof part.text === 'string'
    ))
    : undefined;
  if (!textPart) throw new Error('Attached MCP tool response did not contain text content.');
  return JSON.parse(textPart.text) as ToolEnvelope;
}

test('attached MCP focuses Desktop and applies real grid selection', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-attached-mcp-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'sources');
  const firstSource = path.join(sourceRoot, 'attached-first.png');
  const secondSource = path.join(sourceRoot, 'attached-second.png');
  const libraryName = '附着 MCP 验收';
  const userDataPath = path.join(temporaryRoot, 'user-data');
  mkdirSync(sourceRoot);
  writeFileSync(firstSource, 'first asset');
  writeFileSync(secondSource, 'second asset');

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_AUTOMATION_CONFIRM: '1',
      SERPENT_E2E_AUTOMATION_ATTACH_CONFIRM: '1',
      SERPENT_E2E_DESKTOP_CONTROL: '1',
      SERPENT_E2E_USER_DATA_PATH: userDataPath,
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: path.join(temporaryRoot, libraryName),
      SERPENT_E2E_IMPORT_FILES: [firstSource, secondSource].join(path.delimiter),
    },
  });
  let client: Client | undefined;
  try {
    const window = await application.firstWindow();
    const createButton = window.getByRole('button', { name: '创建资源库' });
    await createButton.click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.locator('.asset-card')).toHaveCount(2);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(applicationDirectory, 'scripts', 'run-mcp.mjs'),
        '--user-data',
        userDataPath,
      ],
      cwd: applicationDirectory,
      stderr: 'pipe',
      env: {
        ...process.env,
        SERPENT_MCP_WRITE_ACCESS: '0',
      },
    });
    client = new Client(
      { name: 'attached-desktop-e2e', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
    const tools = await client.listTools();
    const listedTools = tools.tools.map((tool) => tool.name);
    expect(listedTools).toContain('serpent_desktop_focus');
    expect(listedTools).toContain('serpent_desktop_select_assets');
    expect(listedTools).toContain('serpent_desktop_get_state');
    expect(listedTools).toContain('serpent_desktop_open_folder');
    expect(listedTools).toContain('serpent_desktop_set_discovery');
    expect(listedTools).toContain('serpent_desktop_reveal_asset');
    expect(listedTools).toContain('serpent_desktop_open_viewer');
    expect(listedTools).toContain('serpent_desktop_close_viewer');

    const initialState = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_get_state',
      arguments: {},
    }));
    expect(initialState.ok).toBe(true);
    expect(initialState.result).toMatchObject({
      libraryId: expect.any(String),
      browseTarget: expect.stringMatching(/^(all|root|folder)$/),
      selectedAssetIds: expect.any(Array),
      viewerAssetId: null,
    });
    expect(JSON.stringify(initialState)).not.toContain(temporaryRoot);

    const openedRoot = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_open_folder',
      arguments: { folderId: null },
    }));
    expect(openedRoot.ok).toBe(true);
    expect(openedRoot.result).toMatchObject({
      browseTarget: 'root',
      folderId: null,
    });
    const missingFolder = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_open_folder',
      arguments: { folderId: 'missing-folder' },
    }));
    expect(missingFolder).toMatchObject({
      ok: false,
      code: 'DESKTOP_BROWSE_FOLDER_NOT_FOUND',
    });
    await window.getByRole('button', { name: '添加文件夹' }).click();
    const folderInput = window.locator('.nav-inline-edit input');
    await expect(folderInput).toBeVisible();
    await folderInput.fill('附着浏览目标');
    await folderInput.press('Enter');
    const folderCard = window.locator('.folder-card').filter({ hasText: '附着浏览目标' });
    await expect(folderCard).toHaveCount(1);
    const targetFolderId = await folderCard.getAttribute('data-folder-id');
    expect(targetFolderId).toBeTruthy();
    const openedFolder = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_open_folder',
      arguments: { folderId: targetFolderId },
    }));
    expect(openedFolder).toMatchObject({
      ok: true,
      result: { browseTarget: 'folder', folderId: targetFolderId },
    });
    const recursive = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_set_discovery',
      arguments: { includeSubfolders: true },
    }));
    expect(recursive).toMatchObject({
      ok: true,
      result: { includeSubfolders: true },
    });
    const nonRecursive = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_set_discovery',
      arguments: { includeSubfolders: false },
    }));
    expect(nonRecursive).toMatchObject({
      ok: true,
      result: { includeSubfolders: false },
    });
    const openedRootAgain = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_open_folder',
      arguments: { folderId: null },
    }));
    expect(openedRootAgain).toMatchObject({
      ok: true,
      result: { browseTarget: 'root', folderId: null },
    });
    const discovery = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_set_discovery',
      arguments: {
        colorFilter: 'red',
        sortField: 'byte_size',
        sortOrder: 'desc',
      },
    }));
    expect(discovery.ok).toBe(true);
    expect(discovery.result).toMatchObject({
      colorFilter: 'red',
      sortField: 'byte_size',
      sortOrder: 'desc',
    });
    const clearedDiscovery = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_set_discovery',
      arguments: {
        colorFilter: null,
        sortField: 'name',
        sortOrder: 'asc',
      },
    }));
    expect(clearedDiscovery.ok).toBe(true);

    const cards = window.locator('.asset-card');
    const assetIds = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-asset-id')).filter(
        (assetId): assetId is string => assetId !== null,
      ),
    );
    expect(assetIds).toHaveLength(2);

    const revealed = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_reveal_asset',
      arguments: { assetId: assetIds[0], position: 'center' },
    }));
    expect(revealed).toMatchObject({
      ok: true,
      result: {
        assetId: assetIds[0],
        position: 'center',
        status: 'visible',
        state: { browseTarget: 'root' },
      },
    });
    await expect(window.locator('.asset-card[aria-pressed="true"]')).toHaveCount(1);

    const openedViewer = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_open_viewer',
      arguments: { assetId: assetIds[0] },
    }));
    expect(openedViewer).toMatchObject({
      ok: true,
      result: { viewerAssetId: assetIds[0] },
    });
    await expect(window.getByRole('region', { name: /attached-first\.png 查看页面/ })).toBeVisible();

    const navigatedViewer = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_navigate_viewer',
      arguments: { direction: 'next' },
    }));
    expect(navigatedViewer).toMatchObject({
      ok: true,
      result: { viewerAssetId: assetIds[1] },
    });
    await expect(window.getByRole('region', { name: /attached-second\.png 查看页面/ })).toBeVisible();

    const boundary = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_navigate_viewer',
      arguments: { direction: 'next' },
    }));
    expect(boundary.ok).toBe(false);
    expect(JSON.stringify(boundary)).toContain('DESKTOP_BROWSE_VIEWER_BOUNDARY');

    const closedViewer = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_close_viewer',
      arguments: {},
    }));
    expect(closedViewer).toMatchObject({
      ok: true,
      result: { viewerAssetId: null },
    });

    const favoriteFilter = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_set_discovery',
      arguments: {
        favoriteFilter: 'yes',
        formatFilter: 'png',
        ratingFilter: '5',
      },
    }));
    expect(favoriteFilter).toMatchObject({
      ok: true,
      result: {
        favoriteFilter: 'yes',
        formatFilter: 'png',
        ratingFilter: '5',
      },
    });
    const clearedFilters = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_set_discovery',
      arguments: {
        favoriteFilter: 'any',
        formatFilter: null,
        ratingFilter: null,
      },
    }));
    expect(clearedFilters).toMatchObject({
      ok: true,
      result: {
        favoriteFilter: 'any',
        formatFilter: '',
        ratingFilter: '',
      },
    });

    const focus = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_focus',
      arguments: {},
    }));
    expect(focus.ok).toBe(true);
    expect(JSON.stringify(focus)).not.toContain(temporaryRoot);
    const selection = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_select_assets',
      arguments: {
        assetIds,
        mode: 'replace',
      },
    }));
    expect(selection.ok).toBe(true);
    expect(JSON.stringify(selection)).not.toContain(temporaryRoot);

    await expect(window.locator('.asset-card[aria-pressed="true"]')).toHaveCount(2);
    await expect(window.locator('.asset-card[aria-pressed="true"]').first()).toHaveAttribute(
      'data-asset-id',
      assetIds[0]!,
    );

    // Cross-folder reveal after same-scope paths: put assets in different folders.
    await window.getByRole('button', { name: '添加文件夹' }).click();
    const secondFolderInput = window.locator('.nav-inline-edit input');
    await expect(secondFolderInput).toBeVisible();
    await secondFolderInput.fill('附着浏览目标乙');
    await secondFolderInput.press('Enter');
    const secondFolderCard = window.locator('.folder-card').filter({ hasText: '附着浏览目标乙' });
    await expect(secondFolderCard).toHaveCount(1);
    const secondFolderId = await secondFolderCard.getAttribute('data-folder-id');
    expect(secondFolderId).toBeTruthy();

    await window.locator(`.asset-card[data-asset-id="${assetIds[0]}"]`).click();
    await window.locator(`.asset-card[data-asset-id="${assetIds[0]}"]`).click({ button: 'right' });
    await window.getByRole('menuitem', { name: /移动到文件夹/ }).click();
    await window.getByLabel('目标文件夹').selectOption(targetFolderId!);
    await window.getByRole('button', { name: '确认移动' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已移动 1 项资产');

    await window.locator(`.asset-card[data-asset-id="${assetIds[1]}"]`).click();
    await window.locator(`.asset-card[data-asset-id="${assetIds[1]}"]`).click({ button: 'right' });
    await window.getByRole('menuitem', { name: /移动到文件夹/ }).click();
    await window.getByLabel('目标文件夹').selectOption(secondFolderId!);
    await window.getByRole('button', { name: '确认移动' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已移动 1 项资产');

    const openedFolderA = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_open_folder',
      arguments: { folderId: targetFolderId },
    }));
    expect(openedFolderA).toMatchObject({
      ok: true,
      result: { browseTarget: 'folder', folderId: targetFolderId },
    });
    await expect(window.locator(`.asset-card[data-asset-id="${assetIds[0]}"]`)).toBeVisible();

    const crossFolderReveal = readToolEnvelope(await client.callTool({
      name: 'serpent_desktop_reveal_asset',
      arguments: { assetId: assetIds[1], position: 'center' },
    }));
    expect(crossFolderReveal).toMatchObject({
      ok: true,
      result: {
        assetId: assetIds[1],
        position: 'center',
        status: 'switched-folder',
        folderId: secondFolderId,
      },
    });
    expect(JSON.stringify(crossFolderReveal)).not.toContain(temporaryRoot);
    // chooseFolder returns before pending reveal selection paints; wait for both
    // the destination folder content and the applied selection.
    await expect(window.locator(`.asset-card[data-asset-id="${assetIds[1]}"]`)).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(async () => {
        const state = readToolEnvelope(await client!.callTool({
          name: 'serpent_desktop_get_state',
          arguments: {},
        }));
        return {
          folderId: state.result?.folderId,
          selectedAssetIds: state.result?.selectedAssetIds,
        };
      }, { timeout: 15_000 })
      .toEqual({
        folderId: secondFolderId,
        selectedAssetIds: [assetIds[1]],
      });
    await expect(window.locator(`.asset-card[data-asset-id="${assetIds[1]}"][aria-pressed="true"]`)).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await client?.close();
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
