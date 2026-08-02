import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { expect, test } from '@playwright/test';

import {
  electronLaunchEnv,
  resolveElectronExecutablePath,
} from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

type ToolEnvelope = {
  ok: boolean;
  code?: string;
  result?: Record<string, unknown>;
  [key: string]: unknown;
};

type Host = {
  client: Client;
  transport: StdioClientTransport;
  notifications: Array<Record<string, unknown>>;
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

function hasLibraryChanged(
  notifications: Array<Record<string, unknown>>,
  libraryId: unknown,
): boolean {
  return notifications.some((notification) => {
    const data = notification.data;
    return typeof data === 'object'
      && data !== null
      && 'type' in data
      && data.type === 'library.changed'
      && 'libraryId' in data
      && data.libraryId === libraryId;
  });
}

async function expectNoLibraryChanged(
  notifications: Array<Record<string, unknown>>,
  libraryId: unknown,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(hasLibraryChanged(notifications, libraryId)).toBe(false);
}

async function startHost(
  temporaryRoot: string,
  name: string,
  options: { libraryPath?: string; unbound?: boolean; writeAccess?: boolean } = {},
): Promise<Host> {
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const notifications: Array<Record<string, unknown>> = [];
  const transport = new StdioClientTransport({
    command: executablePath,
    args: [applicationDirectory],
    cwd: applicationDirectory,
    stderr: 'pipe',
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_MCP: '1',
      ...(options.unbound ? { SERPENT_MCP_ALLOW_UNBOUND: '1' } : {}),
      ...(options.libraryPath ? { SERPENT_MCP_LIBRARY_PATH: options.libraryPath } : {}),
      ...(options.writeAccess ? { SERPENT_MCP_WRITE_ACCESS: '1' } : {}),
      SERPENT_MCP_USER_DATA_PATH: path.join(temporaryRoot, `${name}-user-data`),
      SERPENT_E2E_AUTOMATION_CONFIRM: '1',
    }),
  });
  const client = new Client(
    { name: `serpent-${name}-e2e`, version: '1.0.0' },
    { capabilities: {} },
  );
  client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
    notifications.push(notification.params as Record<string, unknown>);
  });
  await client.connect(transport);
  return { client, transport, notifications };
}

async function closeHost(host: Host): Promise<void> {
  await host.client.close().catch(() => undefined);
  await host.transport.close().catch(() => undefined);
}

async function createLibrary(temporaryRoot: string, name: string): Promise<{
  libraryId: string;
  libraryPath: string;
}> {
  const host = await startHost(temporaryRoot, `${name}-creator`, {
    unbound: true,
    writeAccess: true,
  });
  const response = await host.client.callTool({
    name: 'serpent_library_create',
    arguments: {
      displayName: name,
      selectedParentPath: temporaryRoot,
      idempotencyKey: `${name}-create`,
    },
  });
  const created = readToolEnvelope(response);
  expect(created.ok).toBe(true);
  const libraryId = created.result?.libraryId;
  expect(typeof libraryId).toBe('string');
  await closeHost(host);
  return {
    libraryId: libraryId as string,
    libraryPath: path.join(temporaryRoot, name),
  };
}

test('filters library.changed for unbound and different-library stdio hosts', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-filter-e2e-'));
  const libraryA = await createLibrary(temporaryRoot, 'stdio-mcp-filter-a');
  const libraryB = await createLibrary(temporaryRoot, 'stdio-mcp-filter-b');
  const unboundHost = await startHost(temporaryRoot, 'unbound', {
    unbound: true,
    writeAccess: true,
  });
  const boundHostA = await startHost(temporaryRoot, 'bound-a', {
    libraryPath: libraryA.libraryPath,
    writeAccess: true,
  });
  const boundHostB = await startHost(temporaryRoot, 'bound-b', {
    libraryPath: libraryB.libraryPath,
    writeAccess: true,
  });

  try {
    const tools = await unboundHost.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('serpent_library_create');

    const writeResponse = await boundHostB.client.callTool({
      name: 'serpent_tag_create',
      arguments: { name: 'different-library-event' },
    });
    const writeResult = readToolEnvelope(writeResponse);
    expect(writeResult.ok).toBe(true);

    await expectNoLibraryChanged(unboundHost.notifications, libraryB.libraryId);
    await expectNoLibraryChanged(boundHostA.notifications, libraryB.libraryId);
    expect(JSON.stringify(unboundHost.notifications)).not.toContain(temporaryRoot);
    expect(JSON.stringify(boundHostA.notifications)).not.toContain(temporaryRoot);
    expect(JSON.stringify(writeResult)).not.toContain(temporaryRoot);
  } finally {
    await closeHost(boundHostB);
    await closeHost(boundHostA);
    await closeHost(unboundHost);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('supports two concurrent stdio hosts on one library with lease-bounded writes', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-dual-host-e2e-'));
  const library = await createLibrary(temporaryRoot, 'stdio-mcp-dual-host');
  const firstHost = await startHost(temporaryRoot, 'dual-first', {
    libraryPath: library.libraryPath,
    writeAccess: true,
  });
  const secondHost = await startHost(temporaryRoot, 'dual-second', {
    libraryPath: library.libraryPath,
    writeAccess: true,
  });

  try {
    const [firstTools, secondTools] = await Promise.all([
      firstHost.client.listTools(),
      secondHost.client.listTools(),
    ]);
    expect(firstTools.tools.map((tool) => tool.name)).toContain('serpent_library_inspect');
    expect(secondTools.tools.map((tool) => tool.name)).toContain('serpent_library_inspect');

    const [firstInspect, secondInspect] = await Promise.all([
      firstHost.client.callTool({ name: 'serpent_library_inspect', arguments: {} }),
      secondHost.client.callTool({ name: 'serpent_library_inspect', arguments: {} }),
    ]);
    const firstInspectResult = readToolEnvelope(firstInspect);
    const secondInspectResult = readToolEnvelope(secondInspect);
    expect(firstInspectResult).toMatchObject({
      ok: true,
      result: { displayName: 'stdio-mcp-dual-host' },
    });
    expect(secondInspectResult).toMatchObject({
      ok: true,
      result: { displayName: 'stdio-mcp-dual-host' },
    });
    expect(JSON.stringify(firstInspectResult)).not.toContain(temporaryRoot);
    expect(JSON.stringify(secondInspectResult)).not.toContain(temporaryRoot);

    const writeResults = await Promise.all([
      firstHost.client.callTool({
        name: 'serpent_tag_create',
        arguments: { name: 'dual-host-first-write' },
      }),
      secondHost.client.callTool({
        name: 'serpent_tag_create',
        arguments: { name: 'dual-host-second-write' },
      }),
    ]);
    for (const response of writeResults) {
      const result = readToolEnvelope(response);
      expect(result.ok || result.code === 'LIBRARY_BUSY').toBe(true);
      expect(JSON.stringify(result)).not.toContain(temporaryRoot);
    }
  } finally {
    await closeHost(secondHost);
    await closeHost(firstHost);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
