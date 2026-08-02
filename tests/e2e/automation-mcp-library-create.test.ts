import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from '@playwright/test';

import {
  electronLaunchEnv,
  resolveElectronExecutablePath,
} from './electron-test-helpers';

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
  if (!textPart) throw new Error('MCP tool response did not contain text content.');
  return JSON.parse(textPart.text) as ToolEnvelope;
}

test('drives unbound library.create and inspect through a real MCP stdio Electron host', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-library-create-e2e-'));
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const sourcePath = path.join(temporaryRoot, 'stdio-import.txt');
  const displayName = 'stdio-mcp-library';
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  writeFileSync(sourcePath, 'real MCP stdio import fixture');

  const transport = new StdioClientTransport({
    command: executablePath,
    args: [applicationDirectory],
    cwd: applicationDirectory,
    stderr: 'pipe',
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_MCP: '1',
      SERPENT_MCP_ALLOW_UNBOUND: '1',
      SERPENT_MCP_WRITE_ACCESS: '1',
      SERPENT_MCP_USER_DATA_PATH: userDataPath,
      SERPENT_E2E_AUTOMATION_CONFIRM: '1',
    }),
  });
  const client = new Client(
    { name: 'serpent-real-stdio-e2e', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'serpent_library_create',
      'serpent_library_inspect',
      'serpent_file_import',
      'serpent_asset_ai_content_get',
    ]));

    const createdResponse = await client.callTool({
      name: 'serpent_library_create',
      arguments: {
        displayName,
        selectedParentPath: temporaryRoot,
        idempotencyKey: 'stdio-library-create',
      },
    });
    const created = readToolEnvelope(createdResponse);
    expect(created.ok).toBe(true);
    expect(created.result).toMatchObject({ displayName });
    expect(JSON.stringify(created)).not.toContain(temporaryRoot);

    const inspectedResponse = await client.callTool({
      name: 'serpent_library_inspect',
      arguments: {},
    });
    const inspected = readToolEnvelope(inspectedResponse);
    expect(inspected.ok).toBe(true);
    expect(inspected.result).toMatchObject({ displayName });
    expect(JSON.stringify(inspected)).not.toContain(temporaryRoot);

    const importedResponse = await client.callTool({
      name: 'serpent_file_import',
      arguments: {
        sourceKind: 'files',
        sourcePaths: [sourcePath],
        idempotencyKey: 'stdio-file-import',
      },
    });
    const imported = readToolEnvelope(importedResponse);
    expect(imported.ok).toBe(true);
    expect(imported.result).toMatchObject({ status: 'completed' });
    expect(JSON.stringify(imported)).not.toContain(temporaryRoot);

    const importedAssetId = (
      imported.result?.completion as { assets?: Array<{ assetId?: unknown }> } | undefined
    )?.assets?.[0]?.assetId;
    expect(typeof importedAssetId).toBe('string');
    if (typeof importedAssetId !== 'string') throw new Error('MCP import did not return an asset id.');
    const aiContent = readToolEnvelope(await client.callTool({
      name: 'serpent_asset_ai_content_get',
      arguments: { assetId: importedAssetId },
    }));
    expect(aiContent).toMatchObject({
      ok: true,
      result: {
        assetId: importedAssetId,
        description: null,
        tags: [],
        rating: null,
        modelVersion: null,
      },
    });
    expect(JSON.stringify(aiContent)).not.toContain(temporaryRoot);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }

  const libraryPath = path.join(temporaryRoot, displayName);
  expect(existsSync(path.join(libraryPath, '.serpent', 'library.db'))).toBe(true);

  const reopenedTransport = new StdioClientTransport({
    command: executablePath,
    args: [applicationDirectory],
    cwd: applicationDirectory,
    stderr: 'pipe',
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_MCP: '1',
      SERPENT_MCP_LIBRARY_PATH: libraryPath,
      SERPENT_MCP_WRITE_ACCESS: '1',
      SERPENT_MCP_USER_DATA_PATH: path.join(temporaryRoot, 'reopened-user-data'),
      SERPENT_E2E_AUTOMATION_CONFIRM: '1',
    }),
  });
  const reopenedClient = new Client(
    { name: 'serpent-real-stdio-reopen-e2e', version: '1.0.0' },
    { capabilities: {} },
  );
  try {
    await reopenedClient.connect(reopenedTransport);
    const inspectedResponse = await reopenedClient.callTool({
      name: 'serpent_library_inspect',
      arguments: {},
    });
    const inspected = readToolEnvelope(inspectedResponse);
    expect(inspected.ok).toBe(true);
    expect(inspected.result).toMatchObject({ displayName });
    expect(JSON.stringify(inspected)).not.toContain(temporaryRoot);
  } finally {
    await reopenedClient.close().catch(() => undefined);
    await reopenedTransport.close().catch(() => undefined);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
