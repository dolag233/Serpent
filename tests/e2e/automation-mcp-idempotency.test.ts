import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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

test('polls execution status and retries library.create idempotently through real MCP stdio', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-idempotency-e2e-'));
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const displayName = 'stdio-idempotent-library';
  const idempotencyKey = 'stdio-idempotent-library-create';
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
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
    { name: 'serpent-real-stdio-idempotency-e2e', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'serpent_execution_status',
      'serpent_library_create',
    ]));

    const createArguments = {
      displayName,
      selectedParentPath: temporaryRoot,
      idempotencyKey,
    };
    const created = readToolEnvelope(await client.callTool({
      name: 'serpent_library_create',
      arguments: createArguments,
    }));
    expect(created.ok).toBe(true);
    expect(created.result).toMatchObject({ displayName });
    expect(created.result?.libraryId).toEqual(expect.any(String));
    expect(JSON.stringify(created)).not.toContain(temporaryRoot);

    const status = readToolEnvelope(await client.callTool({
      name: 'serpent_execution_status',
      arguments: {},
    }));
    expect(status.ok).toBe(true);
    expect(status.result).toMatchObject({
      executionId: expect.any(String),
      status: expect.any(String),
      commandCount: expect.any(Number),
      succeededCommandCount: expect.any(Number),
      failedCommandCount: expect.any(Number),
    });
    expect(JSON.stringify(status)).not.toContain(temporaryRoot);

    const retried = readToolEnvelope(await client.callTool({
      name: 'serpent_library_create',
      arguments: createArguments,
    }));
    expect(retried).toMatchObject({
      ok: true,
      result: created.result,
    });
    expect(JSON.stringify(retried)).not.toContain(temporaryRoot);

    const conflicting = readToolEnvelope(await client.callTool({
      name: 'serpent_library_create',
      arguments: {
        ...createArguments,
        displayName: 'stdio-conflicting-library',
      },
    }));
    expect(conflicting.ok).toBe(false);
    expect(JSON.stringify(conflicting)).toContain('AUTOMATION_INVALID_REQUEST');

    const libraryPath = path.join(temporaryRoot, displayName);
    expect(existsSync(path.join(libraryPath, '.serpent', 'library.db'))).toBe(true);
    expect(readdirSync(temporaryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name === displayName))
      .toHaveLength(1);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
