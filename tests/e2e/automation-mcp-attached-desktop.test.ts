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

    const cards = window.locator('.asset-card');
    const assetIds = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-asset-id')).filter(
        (assetId): assetId is string => assetId !== null,
      ),
    );
    expect(assetIds).toHaveLength(2);

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
  } finally {
    await client?.close();
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
