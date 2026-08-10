import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AutomationCommandGateway } from '../../src/automation/command-gateway';
import {
  AutomationExecutionJournal,
  createJsonFileAutomationExecutionStore,
  type AutomationExecutionAuditLogger,
} from '../../src/main/automation-execution-journal';
import { EmbeddedMcpServer } from '../../src/main/embedded-mcp-server';
import { McpClientCredentialStore } from '../../src/main/mcp-client-credentials';
import { McpSettingsStore } from '../../src/main/mcp-settings-store';

const roots: string[] = [];
const logger: AutomationExecutionAuditLogger = {
  info: () => undefined,
  error: () => undefined,
};

type HttpResponse = {
  statusCode: number;
  headers: IncomingMessage['headers'];
  body: string;
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('Failed to allocate a test port.'));
        return;
      }
      probe.close((error) => error === undefined ? resolve(address.port) : reject(error));
    });
  });
}

function sendHttp(
  endpoint: string,
  options: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(endpoint);
    const request = httpRequest(target, {
      method: options.method,
      headers: options.headers,
    }, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.once('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

function createGateway(): AutomationCommandGateway {
  return {
    execute: vi.fn(async (envelope: unknown) => ({
      ok: true as const,
      apiVersion: 1 as const,
      commandId: (envelope as { commandId: 'library.list-open' }).commandId,
      executionId: (envelope as { executionId: string }).executionId,
      result: {
        libraries: [],
        activeLibraryId: null,
        contextRevision: 0,
      },
    })),
  };
}

async function createServerHarness(options: {
  initializeTimeoutMs?: number;
  sessionIdleTimeoutMs?: number;
} = {}) {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-http-'));
  roots.push(userDataPath);
  const port = await freePort();
  const settings = new McpSettingsStore(userDataPath);
  settings.setPreferences({ enabled: true, port });
  const journal = new AutomationExecutionJournal({
    store: createJsonFileAutomationExecutionStore(path.join(userDataPath, 'executions.json')),
    logger,
  });
  const workerClient = {
    request: vi.fn(async () => ({ ok: true as const, type: 'library.list' as const, libraries: [] })),
    onLibraryChanged: vi.fn(() => () => undefined),
  };
  const server = new EmbeddedMcpServer({
    userDataPath,
    settingsStore: settings,
    credentialStore: new McpClientCredentialStore(userDataPath),
    journal,
    gateway: createGateway(),
    workerClient,
    logger,
    getPluginTools: () => undefined,
    ...(options.initializeTimeoutMs === undefined ? {} : { initializeTimeoutMs: options.initializeTimeoutMs }),
    ...(options.sessionIdleTimeoutMs === undefined ? {} : { sessionIdleTimeoutMs: options.sessionIdleTimeoutMs }),
  });
  const config = await server.createClientConfig('generic-json', 'HTTP test client');
  const parsedConfig = JSON.parse(config.configText) as {
    mcpServers: { serpent: { url: string; headers: { Authorization: string } } };
  };
  const clientConfig = parsedConfig.mcpServers.serpent;
  return {
    server,
    endpoint: clientConfig.url,
    token: clientConfig.headers.Authorization.replace(/^Bearer /u, ''),
    journal,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Embedded MCP Streamable HTTP server', () => {
  it('starts on loopback, authenticates before parsing, and supports the SDK client', async () => {
    const harness = await createServerHarness();
    const unauthorized = await sendHttp(harness.endpoint, {
      method: 'POST',
      headers: {
        Host: new URL(harness.endpoint).host,
        'Content-Type': 'application/json',
      },
      body: '{not-json',
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(JSON.parse(unauthorized.body)).toMatchObject({ code: 'MCP_CLIENT_UNAUTHORIZED' });

    const client = new Client({ name: 'http-sdk-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(harness.endpoint), {
      requestInit: {
        headers: { Authorization: `Bearer ${harness.token}` },
      },
    });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('serpent_library_list_open');
    expect(harness.journal.list()[0]).toMatchObject({
      source: 'mcp',
      clientName: 'http-sdk-test',
    });
    const progress = vi.fn();
    await client.callTool(
      { name: 'serpent_library_list_open', arguments: {} },
      undefined,
      { onprogress: progress },
    );
    expect(progress).toHaveBeenCalled();
    await client.close();
    await harness.server.close();
  });

  it('rejects forged Host and Origin headers and revokes active credentials', async () => {
    const harness = await createServerHarness();
    const target = new URL(harness.endpoint);
    const forgedHost = await sendHttp(harness.endpoint, {
      method: 'POST',
      headers: {
        Host: `192.168.1.20:${target.port}`,
        Authorization: `Bearer ${harness.token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(forgedHost.statusCode).toBe(403);
    expect(JSON.parse(forgedHost.body)).toMatchObject({ code: 'MCP_CLIENT_UNAUTHORIZED' });

    const forgedOrigin = await sendHttp(harness.endpoint, {
      method: 'POST',
      headers: {
        Host: target.host,
        Origin: 'https://evil.example',
        Authorization: `Bearer ${harness.token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(forgedOrigin.statusCode).toBe(403);

    const credentialId = harness.server.snapshot().credentials[0]?.credentialId;
    expect(credentialId).toBeDefined();
    const revoked = await harness.server.revokeCredential(credentialId!);
    expect(revoked.credentials[0]?.revokedAt).not.toBeNull();
    const afterRevoke = await sendHttp(harness.endpoint, {
      method: 'POST',
      headers: {
        Host: target.host,
        Authorization: `Bearer ${harness.token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(afterRevoke.statusCode).toBe(401);
    expect(JSON.parse(afterRevoke.body)).toMatchObject({ code: 'MCP_CLIENT_REVOKED' });
    await harness.server.close();
  });

  it('rejects localhost Host/Origin aliases instead of widening the loopback allowlist', async () => {
    const harness = await createServerHarness();
    const target = new URL(harness.endpoint);
    const response = await sendHttp(harness.endpoint, {
      method: 'POST',
      headers: {
        Host: `localhost:${target.port}`,
        Origin: `http://localhost:${target.port}`,
        Authorization: `Bearer ${harness.token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(response.statusCode).toBe(403);
    await harness.server.close();
  });

  it('does not block initialize on a broad read/write authorization prompt', async () => {
    const harness = await createServerHarness({ initializeTimeoutMs: 20 });
    const client = new Client({ name: 'no-broad-prompt-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(harness.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${harness.token}` } },
    });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('serpent_library_create');
    await client.close();
    await harness.server.close();
  });

  it('expires an abandoned initialized session so later clients are not stranded', async () => {
    const harness = await createServerHarness({ sessionIdleTimeoutMs: 20 });
    const client = new Client({ name: 'idle-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(harness.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${harness.token}` } },
    });
    await client.connect(transport);
    expect(harness.server.snapshot().runtime).toMatchObject({ status: 'running', activeSessionCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(harness.server.snapshot().runtime).toMatchObject({ status: 'running', activeSessionCount: 0 });
    try {
      await client.close();
    } catch {
      // The server has already closed the abandoned session.
    }
    await harness.server.close();
  });
});
