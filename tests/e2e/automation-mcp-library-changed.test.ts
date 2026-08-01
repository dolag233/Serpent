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

function waitForNotification(
  notifications: Array<Record<string, unknown>>,
  predicate: (notification: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const existing = notifications.find(predicate);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for MCP library.changed notification.'));
    }, 15_000);
    const interval = setInterval(() => {
      const notification = notifications.find(predicate);
      if (notification) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve(notification);
      }
    }, 25);
  });
}

test('receives bound library.changed push from a real MCP stdio Electron host', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-library-changed-e2e-'));
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const displayName = 'stdio-mcp-library-changed';
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
    { name: 'serpent-real-library-changed-e2e', version: '1.0.0' },
    { capabilities: {} },
  );
  const notifications: Array<Record<string, unknown>> = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
    notifications.push(notification.params as Record<string, unknown>);
  });

  try {
    await client.connect(transport);
    await client.setLoggingLevel('info');

    const createdResponse = await client.callTool({
      name: 'serpent_library_create',
      arguments: {
        displayName,
        selectedParentPath: temporaryRoot,
        idempotencyKey: 'library-changed-create',
      },
    });
    const created = readToolEnvelope(createdResponse);
    expect(created.ok).toBe(true);
    expect(created.result).toMatchObject({ displayName });
    const libraryId = created.result?.libraryId;
    expect(typeof libraryId).toBe('string');

    const sequenceBeforeResponse = await client.callTool({
      name: 'serpent_library_change_sequence',
      arguments: {},
    });
    const sequenceBefore = readToolEnvelope(sequenceBeforeResponse);
    expect(sequenceBefore.ok).toBe(true);
    const initialSequence = sequenceBefore.result?.changeSequence;
    expect(typeof initialSequence).toBe('number');

    const changedNotificationPromise = waitForNotification(
      notifications,
      (notification) => {
        const data = notification.data;
        return typeof data === 'object'
          && data !== null
          && 'type' in data
          && data.type === 'library.changed'
          && 'libraryId' in data
          && data.libraryId === libraryId;
      },
    );
    const tagResponse = await client.callTool({
      name: 'serpent_tag_create',
      arguments: { name: 'mcp-library-changed-tag' },
    });
    const tag = readToolEnvelope(tagResponse);
    expect(tag.ok).toBe(true);
    expect(tag.result).toMatchObject({ name: 'mcp-library-changed-tag' });

    const notification = await changedNotificationPromise;
    const data = notification.data as {
      type?: unknown;
      libraryId?: unknown;
      changeSequence?: unknown;
    };
    expect(data).toEqual({
      type: 'library.changed',
      libraryId,
      changeSequence: expect.any(Number),
    });
    expect(data.changeSequence).toBeGreaterThanOrEqual(initialSequence as number);
    expect(JSON.stringify(notification)).not.toContain(temporaryRoot);
    expect(JSON.stringify(tag)).not.toContain(temporaryRoot);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
