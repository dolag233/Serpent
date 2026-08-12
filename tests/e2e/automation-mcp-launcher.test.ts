import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from '@playwright/test';

import { electronLaunchEnv } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('headless run-mcp launcher exposes Registry tools on Windows', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-launcher-e2e-'));
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(applicationDirectory, 'scripts', 'run-mcp.mjs'),
      '--headless',
      '--unbound',
      '--write-access',
      '--user-data',
      userDataPath,
    ],
    cwd: applicationDirectory,
    stderr: 'pipe',
    env: electronLaunchEnv({
      SERPENT_VITE_PORT: '52771',
      SERPENT_E2E: '1',
      SERPENT_E2E_AUTOMATION_CONFIRM: '1',
    }),
  });
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    process.stderr.write(String(chunk));
  });
  const client = new Client(
    { name: 'serpent-mcp-launcher-e2e', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'serpent_library_create',
      'serpent_library_inspect',
      'serpent_asset_search',
    ]));
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    try {
      rmSync(temporaryRoot, {
        force: true,
        recursive: true,
        maxRetries: 20,
        retryDelay: 250,
      });
    } catch {
      // Windows may release Chromium cache handles shortly after the child tree exits.
    }
  }
});
