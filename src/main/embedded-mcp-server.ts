import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import {
  AUTOMATION_API_VERSION,
  automationCapabilityRegistry,
  automationCapabilitySchema,
  type AutomationCapability,
} from '../automation/command-registry';
import type {
  AutomationCommandGateway,
  AutomationExecutionContext,
  AutomationPermissionBroker,
} from '../automation/command-gateway';
import type {
  AutomationExecutionJournal,
  AutomationLibraryContextChangedEvent,
} from './automation-execution-journal';
import { createSerpentMcpServer, type SerpentMcpSessionEvent } from '../mcp/create-serpent-mcp-server';
import type { SerpentMcpPluginToolBridge } from '../mcp/call-tool';
import {
  MCP_ENDPOINT_PATH,
  MCP_MAX_PORT,
  MCP_MIN_PORT,
  type McpAccessMode,
  type McpConfigFormat,
  type McpRuntimeState,
  type McpSettingsSnapshot,
  type McpServerPreferences,
} from '../shared/mcp';
import { McpClientCredentialStore } from './mcp-client-credentials';
import { buildMcpAgentConnectionText, buildMcpClientConfigText } from '../shared/mcp-client-config';
import type { McpPermissionPolicyStore } from './mcp-permission-policy-store';
import type { McpPermissionBroker } from './mcp-permission-broker';
import { McpSettingsStore } from './mcp-settings-store';

const MAX_HTTP_BODY_BYTES = 1 * 1024 * 1024;
const MAX_SESSIONS = 64;
const DEFAULT_INITIALIZE_TIMEOUT_MS = 60_000;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MCP_READ_CAPABILITIES: readonly AutomationCapability[] = automationCapabilityRegistry
  .filter((definition) => definition.defaultPolicy === 'allow')
  .map((definition) => definition.capability);
const DEFAULT_MCP_CAPABILITIES: readonly AutomationCapability[] = automationCapabilitySchema.options;

export interface EmbeddedMcpLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface EmbeddedMcpWorkerClient {
  request(command: { type: 'library.list' }): Promise<{
    ok: boolean;
    type?: string;
    libraries?: Array<{ libraryId: string; displayName: string; libraryPath: string }>;
  }>;
  onLibraryChanged(listener: (event: { libraryId: string; changeSequence: number }) => void): () => void;
}

export interface EmbeddedMcpServerOptions {
  userDataPath: string;
  settingsStore?: McpSettingsStore;
  credentialStore?: McpClientCredentialStore;
  journal: AutomationExecutionJournal;
  gateway: AutomationCommandGateway;
  workerClient: EmbeddedMcpWorkerClient;
  logger: EmbeddedMcpLogger;
  getPluginTools: () => SerpentMcpPluginToolBridge | undefined;
  permissionPolicyStore?: McpPermissionPolicyStore;
  permissionBroker?: AutomationPermissionBroker;
  initializeTimeoutMs?: number;
  sessionIdleTimeoutMs?: number;
  onSnapshotChanged?: (snapshot: McpSettingsSnapshot) => void;
  onCommandCompleted?: (input: {
    commandId: string;
    result: unknown;
  }) => void;
}

export class EmbeddedMcpServerError extends Error {
  public readonly code:
    | 'MCP_SERVER_NOT_ENABLED'
    | 'MCP_SERVER_NOT_RUNNING'
    | 'MCP_SERVER_PORT_UNAVAILABLE'
    | 'MCP_SERVER_START_FAILED'
    | 'MCP_SERVER_STOP_FAILED'
    | 'MCP_SERVER_AUTH_REQUIRED'
    | 'MCP_SERVER_ORIGIN_REJECTED'
    | 'MCP_SERVER_REQUEST_TOO_LARGE'
    | 'MCP_SERVER_INVALID_REQUEST'
    | 'MCP_SERVER_TOO_MANY_SESSIONS'
    | 'MCP_CLIENT_UNAUTHORIZED'
    | 'MCP_CLIENT_TOKEN_UNAVAILABLE'
    | 'MCP_CLIENT_REVOKED'
    | 'MCP_SESSION_NOT_FOUND'
    | 'MCP_SESSION_CLOSED';

  public constructor(code: EmbeddedMcpServerError['code'], message: string) {
    super(message);
    this.name = 'EmbeddedMcpServerError';
    this.code = code;
  }
}

type EmbeddedSession = {
  sessionId: string;
  credentialId: string;
  clientName?: string;
  executionId: string;
  server: Server;
  transport: StreamableHTTPServerTransport;
  closing: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
};

function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/u.exec(header.trim());
  return match?.[1];
}

function clientNameFromInitializeBody(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const request = body as { method?: unknown; params?: unknown };
  if (request.method !== 'initialize' || typeof request.params !== 'object' || request.params === null) return undefined;
  const clientInfo = (request.params as { clientInfo?: unknown }).clientInfo;
  if (typeof clientInfo !== 'object' || clientInfo === null) return undefined;
  const name = (clientInfo as { name?: unknown }).name;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 128 && !/[\p{Cc}]/u.test(trimmed)
    ? trimmed
    : undefined;
}

function allowedHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  return host === `127.0.0.1:${port}`;
}

function allowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}`;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent || response.destroyed) return;
  const serialized = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(serialized, 'utf8'));
  response.end(serialized);
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = (): void => {
      request.removeListener('aborted', onAborted);
      request.removeListener('close', onClose);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAborted = (): void => {
      fail(new EmbeddedMcpServerError('MCP_SESSION_CLOSED', 'The MCP client disconnected before the request was received.'));
    };
    const onClose = (): void => {
      if (!request.complete) onAborted();
    };
    request.once('aborted', onAborted);
    request.once('close', onClose);
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > MAX_HTTP_BODY_BYTES) {
        request.resume();
        fail(new EmbeddedMcpServerError(
          'MCP_SERVER_REQUEST_TOO_LARGE',
          'The MCP request body exceeds the 1 MiB limit.',
        ));
        return;
      }
      chunks.push(buffer);
    });
    request.on('error', fail);
    request.on('end', () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new EmbeddedMcpServerError('MCP_SERVER_INVALID_REQUEST', 'The MCP request body is not valid JSON.'));
      }
    });
  });
}

function isPortUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'EADDRINUSE' || code === 'EACCES' || code === 'EPERM';
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    // Windows review: wedged/half-open keep-alive sockets can make server.close()
    // wait forever; force-close connections after a grace period.
    const timer = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, 5_000);
    timer.unref();
    server.closeIdleConnections();
    server.close((error) => {
      clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new EmbeddedMcpServerError('MCP_SESSION_CLOSED', 'The MCP client disconnected before the operation completed.'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Main-owned, loopback-only MCP service. It deliberately owns the HTTP
 * listener and the per-connection MCP transport so renderer code never sees a
 * token, socket, file descriptor, or arbitrary network capability.
 */
export class EmbeddedMcpServer {
  readonly #settings: McpSettingsStore;
  readonly #credentials: McpClientCredentialStore;
  readonly #journal: AutomationExecutionJournal;
  readonly #gateway: AutomationCommandGateway;
  readonly #workerClient: EmbeddedMcpWorkerClient;
  readonly #logger: EmbeddedMcpLogger;
  readonly #getPluginTools: () => SerpentMcpPluginToolBridge | undefined;
  readonly #onCommandCompleted: EmbeddedMcpServerOptions['onCommandCompleted'];
  readonly #permissionPolicyStore?: McpPermissionPolicyStore;
  readonly #permissionBroker?: AutomationPermissionBroker;
  readonly #initializeTimeoutMs: number;
  readonly #sessionIdleTimeoutMs: number;
  readonly #onSnapshotChanged: EmbeddedMcpServerOptions['onSnapshotChanged'];
  readonly #sessions = new Map<string, EmbeddedSession>();
  readonly #closedSessionIds = new Set<string>();
  readonly #snapshotListeners = new Set<(snapshot: McpSettingsSnapshot) => void>();
  readonly #journalUnsubscribe: () => void;
  readonly #workerUnsubscribe: () => void;
  /** Last known per-library change sequence (ADR-0031 §2 response echo). */
  readonly #libraryChangeSequences = new Map<string, number>();
  #runtime: McpRuntimeState = { status: 'stopped' };
  #httpServer: HttpServer | undefined;
  #startPromise: Promise<McpSettingsSnapshot> | undefined;

  public constructor(options: EmbeddedMcpServerOptions) {
    this.#settings = options.settingsStore ?? new McpSettingsStore(options.userDataPath);
    this.#credentials = options.credentialStore ?? new McpClientCredentialStore(options.userDataPath);
    this.#journal = options.journal;
    this.#gateway = options.gateway;
    this.#workerClient = options.workerClient;
    this.#logger = options.logger;
    this.#getPluginTools = options.getPluginTools;
    this.#onCommandCompleted = options.onCommandCompleted;
    this.#permissionPolicyStore = options.permissionPolicyStore;
    this.#permissionBroker = options.permissionBroker;
    this.#initializeTimeoutMs = Math.max(1, options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS);
    this.#sessionIdleTimeoutMs = Math.max(1, options.sessionIdleTimeoutMs ?? DEFAULT_SESSION_IDLE_TIMEOUT_MS);
    this.#onSnapshotChanged = options.onSnapshotChanged;
    this.#journalUnsubscribe = this.#journal.onContextChanged((event) => {
      // Journal context is an internal execution/audit detail. It must never
      // alter the stateless MCP tool catalogue or create an implicit target.
      this.#logContextChange(event);
    });
    this.#workerUnsubscribe = this.#workerClient.onLibraryChanged((event) => {
      // The library.changed stream is the freshness source for the response
      // echo; the mutating call may report the sequence one event behind,
      // the following call and library.change-sequence carry the fresh value.
      this.#libraryChangeSequences.set(event.libraryId, event.changeSequence);
      this.#notifySessions({ type: 'library-changed', ...event });
    });
  }

  public get preferences(): McpServerPreferences {
    return this.#settings.preferences;
  }

  public snapshot(): McpSettingsSnapshot {
    const runtime = this.#runtime.status === 'running'
      ? {
        ...this.#runtime,
        connectedClientCount: this.#sessions.size,
        activeSessionCount: this.#sessions.size,
      }
      : this.#runtime;
    const recentActivity = this.#journal.list()
      .filter((record) => record.source === 'mcp' && record.clientCredentialId !== undefined)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 8)
      .map((record) => ({
        executionId: record.executionId,
        credentialId: record.clientCredentialId!,
        ...(record.clientName === undefined ? {} : { clientName: record.clientName }),
        commandCount: record.commandCount,
        succeededCommandCount: record.succeededCommandCount,
        failedCommandCount: record.failedCommandCount,
        lastCommandId: record.lastCommandId,
        failureCode: record.failureCode,
        createdAt: record.createdAt,
        finishedAt: record.finishedAt,
      }));
    return {
      preferences: this.#settings.preferences,
      runtime,
      credentials: this.#credentials.list(),
      credentialPermissions: this.#permissionPolicyStore?.snapshots(
        this.#credentials.list().map((credential) => credential.credentialId),
      ) ?? [],
      recentActivity,
    };
  }

  public onSnapshot(listener: (snapshot: McpSettingsSnapshot) => void): () => void {
    this.#snapshotListeners.add(listener);
    return () => this.#snapshotListeners.delete(listener);
  }

  /** Called by Main whenever active plugin contributions may have changed. */
  public notifyToolsChanged(): void {
    this.#notifySessions({ type: 'tools-changed' });
  }

  public async initialize(): Promise<void> {
    if (this.#settings.preferences.enabled && this.#settings.preferences.autoStart) {
      try {
        await this.start();
      } catch (error) {
        this.#logger.error('mcp.server.autostart', error);
      }
    }
  }

  public async setEnabled(enabled: boolean): Promise<McpSettingsSnapshot> {
    const preferences = this.#settings.setPreferences({
      enabled,
      ...(enabled ? {} : { autoStart: false }),
    });
    if (!enabled && this.#runtime.status !== 'stopped') await this.stop();
    if (enabled && preferences.autoStart && this.#runtime.status === 'stopped') await this.start();
    return this.#publish();
  }

  public async setAutoStart(autoStart: boolean): Promise<McpSettingsSnapshot> {
    if (autoStart && !this.#settings.preferences.enabled) {
      throw new EmbeddedMcpServerError('MCP_SERVER_NOT_ENABLED', 'Enable the MCP server before enabling automatic start.');
    }
    this.#settings.setPreferences({ autoStart });
    return this.#publish();
  }

  public async setAccessMode(credentialId: string, mode: McpAccessMode): Promise<McpSettingsSnapshot> {
    this.#assertActiveCredential(credentialId);
    this.#permissionPolicyStore?.setMode(credentialId, mode);
    return this.#publish();
  }

  public renameCredential(credentialId: string, label: string): McpSettingsSnapshot {
    if (!this.#credentials.rename(credentialId, label)) {
      throw new EmbeddedMcpServerError('MCP_CLIENT_UNAUTHORIZED', 'The MCP client credential is unavailable.');
    }
    return this.#publish();
  }

  public async setPort(port: number): Promise<McpSettingsSnapshot> {
    if (!Number.isInteger(port) || port < MCP_MIN_PORT || port > MCP_MAX_PORT) {
      throw new EmbeddedMcpServerError('MCP_SERVER_START_FAILED', 'The MCP port is invalid.');
    }
    if (this.#runtime.status !== 'stopped') await this.stop();
    this.#settings.setPreferences({ port });
    return this.#publish();
  }

  public async start(): Promise<McpSettingsSnapshot> {
    if (!this.#settings.preferences.enabled) {
      throw new EmbeddedMcpServerError('MCP_SERVER_NOT_ENABLED', 'Enable the MCP server before starting it.');
    }
    if (this.#runtime.status === 'running') return this.snapshot();
    if (this.#startPromise !== undefined) return this.#startPromise;
    this.#startPromise = this.#startInternal().finally(() => {
      this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  public async stop(): Promise<McpSettingsSnapshot> {
    const pendingStart = this.#startPromise;
    if (pendingStart !== undefined) {
      try {
        await pendingStart;
      } catch {
        // A failed start still leaves the lifecycle in a state that stop can
        // normalize below. The original start error has already been logged.
      }
    }
    if (this.#runtime.status === 'stopped') return this.snapshot();
    this.#runtime = { status: 'stopping' };
    this.#publish();
    const sessions = [...this.#sessions.keys()];
    await Promise.all(sessions.map((sessionId) => this.#closeSession(sessionId)));
    // Serpent-8b5b.2: a stopped server must not leave confirmable challenges.
    (this.#permissionBroker as McpPermissionBroker | undefined)?.clearAllChallenges();
    const server = this.#httpServer;
    this.#httpServer = undefined;
    try {
      if (server !== undefined) await closeHttpServer(server);
      this.#runtime = { status: 'stopped' };
      return this.#publish();
    } catch (error) {
      this.#runtime = {
        status: 'error',
        code: 'MCP_SERVER_STOP_FAILED',
        message: 'The MCP server could not stop cleanly.',
      };
      this.#logger.error('mcp.server.stop', error);
      this.#publish();
      throw new EmbeddedMcpServerError('MCP_SERVER_STOP_FAILED', 'The MCP server could not stop cleanly.');
    }
  }

  public async createClientConfig(format: McpConfigFormat, label?: string): Promise<{
    credentialId: string;
    snapshot: McpSettingsSnapshot;
    configText: string;
    connectionText: string;
  }> {
    if (this.#runtime.status !== 'running') {
      if (!this.#settings.preferences.enabled) {
        throw new EmbeddedMcpServerError('MCP_SERVER_NOT_ENABLED', 'Enable and start the MCP server before copying a client configuration.');
      }
      await this.start();
    }
    if (this.#runtime.status !== 'running') {
      throw new EmbeddedMcpServerError('MCP_SERVER_NOT_RUNNING', 'The MCP server is not running.');
    }
    const credential = this.#credentials.issue(label);
    const configText = this.#buildConfigText(format, this.#runtime.endpoint, credential.token);
    const connectionText = buildMcpAgentConnectionText(format, this.#runtime.endpoint, credential.token);
    return { credentialId: credential.credentialId, snapshot: this.#publish(), configText, connectionText };
  }

  /** Return an Agent-ready bundle without changing the existing credential. */
  public async copyAgentConnection(
    credentialId: string,
    format: McpConfigFormat,
  ): Promise<{ credentialId: string; snapshot: McpSettingsSnapshot; configText: string; connectionText: string }> {
    if (this.#runtime.status !== 'running') {
      if (!this.#settings.preferences.enabled) {
        throw new EmbeddedMcpServerError('MCP_SERVER_NOT_ENABLED', 'Enable and start the MCP server before copying a client configuration.');
      }
      await this.start();
    }
    if (this.#runtime.status !== 'running') {
      throw new EmbeddedMcpServerError('MCP_SERVER_NOT_RUNNING', 'The MCP server is not running.');
    }
    const existing = this.#credentials.list().find(
      (candidate) => candidate.credentialId === credentialId,
    );
    if (existing === undefined || existing.revokedAt !== null) {
      throw new EmbeddedMcpServerError('MCP_CLIENT_UNAUTHORIZED', 'The MCP client credential is unavailable.');
    }
    const token = this.#credentials.tokenFor(credentialId);
    if (token === undefined) {
      throw new EmbeddedMcpServerError('MCP_CLIENT_TOKEN_UNAVAILABLE', 'The MCP client credential token is unavailable. Create a new client credential.');
    }
    const configText = this.#buildConfigText(format, this.#runtime.endpoint, token);
    const connectionText = buildMcpAgentConnectionText(format, this.#runtime.endpoint, token);
    return { credentialId, snapshot: this.#publish(), configText, connectionText };
  }

  #buildConfigText(format: McpConfigFormat, endpoint: string, token: string): string {
    return buildMcpClientConfigText(format, endpoint, token);
  }

  public async revokeCredential(credentialId: string): Promise<McpSettingsSnapshot> {
    this.#credentials.revoke(credentialId);
    this.#permissionPolicyStore?.clearCredential(credentialId);
    this.#permissionBroker?.clearCredential(credentialId);
    // Serpent-8b5b.2: revoked credentials must not be able to confirm
    // outstanding dangerous challenges.
    (this.#permissionBroker as McpPermissionBroker | undefined)?.clearCredentialChallenges(credentialId);
    await Promise.all([...this.#sessions.values()]
      .filter((session) => session.credentialId === credentialId)
      .map((session) => this.#closeSession(session.sessionId)));
    return this.#publish();
  }

  public async close(): Promise<void> {
    this.#journalUnsubscribe();
    this.#workerUnsubscribe();
    if (this.#runtime.status !== 'stopped') await this.stop();
  }

  async #startInternal(): Promise<McpSettingsSnapshot> {
    const port = this.#settings.preferences.port;
    this.#runtime = { status: 'starting' };
    this.#publish();
    const server = createServer((request, response) => {
      void this.#handleRequest(request, response).catch((error: unknown) => {
        this.#logger.error('mcp.server.request', error, { method: request.method, url: request.url });
        const code = error instanceof EmbeddedMcpServerError ? error.code : 'MCP_SERVER_START_FAILED';
        const statusCode = code === 'MCP_SERVER_INVALID_REQUEST'
          ? 400
          : code === 'MCP_SERVER_REQUEST_TOO_LARGE'
            ? 413
            : code === 'MCP_CLIENT_UNAUTHORIZED' || code === 'MCP_CLIENT_REVOKED'
              ? 401
              : code === 'MCP_SESSION_NOT_FOUND'
                ? 404
                : code === 'MCP_SESSION_CLOSED'
                  ? 410
                  : 500;
        // Serpent review: never leak raw internal error messages (they may
        // contain disk paths); log the detail, send a fixed message.
        this.#logger.error('mcp.server.request-failed', error, { code, statusCode });
        writeJson(response, statusCode, {
          error: error instanceof EmbeddedMcpServerError
            ? error.message
            : 'The MCP request failed.',
          code,
        });
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
      });
    } catch (error) {
      this.#runtime = {
        status: 'error',
        code: isPortUnavailable(error) ? 'MCP_SERVER_PORT_UNAVAILABLE' : 'MCP_SERVER_START_FAILED',
        message: isPortUnavailable(error)
          ? `Port ${port} is unavailable.`
          : 'The MCP server could not start.',
      };
      this.#logger.error('mcp.server.start', error, { port });
      this.#publish();
      throw new EmbeddedMcpServerError(this.#runtime.code, this.#runtime.message);
    }
    this.#httpServer = server;
    server.on('error', (error) => {
      if (this.#httpServer !== server) return;
      this.#logger.error('mcp.server.runtime', error, { port });
      this.#runtime = {
        status: 'error',
        code: isPortUnavailable(error) ? 'MCP_SERVER_PORT_UNAVAILABLE' : 'MCP_SERVER_START_FAILED',
        message: isPortUnavailable(error)
          ? `Port ${port} is unavailable.`
          : 'The MCP server encountered a listener error.',
      };
      this.#httpServer = undefined;
      void closeHttpServer(server).catch((closeError) => {
        this.#logger.error('mcp.server.runtime-close', closeError, { port });
      });
      void Promise.all([...this.#sessions.keys()].map((sessionId) => this.#closeSession(sessionId)))
        .catch((closeError) => {
          this.#logger.error('mcp.server.runtime-session-close', closeError, { port });
        });
      this.#publish();
    });
    this.#runtime = {
      status: 'running',
      endpoint: `http://127.0.0.1:${port}${MCP_ENDPOINT_PATH}`,
      port,
      connectedClientCount: 0,
      activeSessionCount: 0,
      startedAt: new Date().toISOString(),
    };
    this.#logger.info('mcp.server.started', 'Embedded MCP Streamable HTTP server started.', {
      port,
      address: '127.0.0.1',
    });
    return this.#publish();
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Use the actually bound port while running (preferences may differ
    // briefly during stop/port-change windows).
    const port = this.#runtime.status === 'running' ? this.#runtime.port : this.#settings.preferences.port;
    if (!allowedHost(request.headers.host, port) || !allowedOrigin(request.headers.origin, port)) {
      writeJson(response, 403, {
        code: 'MCP_CLIENT_UNAUTHORIZED',
        error: 'MCP requests must originate from the Serpent loopback endpoint.',
      });
      return;
    }
    const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (requestUrl.pathname !== MCP_ENDPOINT_PATH) {
      writeJson(response, 404, { code: 'MCP_SESSION_NOT_FOUND', error: 'MCP endpoint not found.' });
      return;
    }
    const token = bearerToken(request);
    if (token === undefined) {
      writeJson(response, 401, {
        code: 'MCP_CLIENT_UNAUTHORIZED',
        error: 'MCP authentication is required.',
      });
      return;
    }
    const credentialState = this.#credentials.authenticationState(token);
    if (credentialState === 'revoked') {
      writeJson(response, 401, { code: 'MCP_CLIENT_REVOKED', error: 'The MCP client credential has been revoked.' });
      return;
    }
    const credential = this.#credentials.authenticate(token);
    if (credential === undefined) {
      writeJson(response, 401, { code: 'MCP_CLIENT_UNAUTHORIZED', error: 'MCP authentication is required.' });
      return;
    }
    const sessionId = typeof request.headers['mcp-session-id'] === 'string'
      ? request.headers['mcp-session-id']
      : undefined;
    const session = sessionId === undefined ? undefined : this.#sessions.get(sessionId);
    if (sessionId !== undefined && session === undefined) {
      writeJson(response, this.#closedSessionIds.has(sessionId) ? 410 : 404, {
        code: this.#closedSessionIds.has(sessionId) ? 'MCP_SESSION_CLOSED' : 'MCP_SESSION_NOT_FOUND',
        error: this.#closedSessionIds.has(sessionId) ? 'The MCP session is closed.' : 'MCP session not found.',
      });
      return;
    }
    if (session !== undefined && session.credentialId !== credential.credentialId) {
      writeJson(response, 401, { code: 'MCP_CLIENT_UNAUTHORIZED', error: 'The MCP session credential is invalid.' });
      return;
    }
    if (session !== undefined) {
      this.#touchSession(session);
      // Serpent review: the 'close' listener must stay attached until the
      // response actually closes — for GET (SSE) the transport resolves at
      // handoff while the stream stays open, so removing the listeners in a
      // finally would let a dropped SSE client linger until the idle timeout.
      // `once` self-removes; POST/DELETE responses close immediately with
      // writableFinished set, so they never tear down the session.
      const closeOnDisconnect = (): void => {
        if (!response.writableFinished) void this.#closeSession(session.sessionId);
      };
      request.once('aborted', closeOnDisconnect);
      response.once('close', closeOnDisconnect);
      try {
        if (request.method === 'POST') {
          const body = await readBody(request);
          await session.transport.handleRequest(request, response, body);
        } else {
          await session.transport.handleRequest(request, response);
        }
        if (request.method === 'DELETE') await this.#closeSession(session.sessionId);
      } finally {
        if (!session.closing) this.#touchSession(session);
      }
      return;
    }
    if (request.method !== 'POST') {
      // The SDK client probes GET before POST. A 405 tells it that this
      // endpoint supports GET only for an established session.
      response.setHeader('Allow', 'POST, OPTIONS');
      writeJson(response, 405, { code: 'MCP_SESSION_NOT_FOUND', error: 'An MCP session must be initialized with POST.' });
      return;
    }
    if (this.#sessions.size >= MAX_SESSIONS) {
      writeJson(response, 429, { code: 'MCP_SERVER_TOO_MANY_SESSIONS', error: 'Too many active MCP sessions.' });
      return;
    }
    const body = await readBody(request);
    const generatedSessionId = randomUUID();
    const clientName = clientNameFromInitializeBody(body);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => generatedSessionId,
    });
    const grantedCapabilities = [...DEFAULT_MCP_READ_CAPABILITIES];
    const execution = this.#journal.create({
      source: 'mcp',
      libraryId: null,
      clientCredentialId: credential.credentialId,
      ...(clientName === undefined ? {} : { clientName }),
      declaredCapabilities: DEFAULT_MCP_CAPABILITIES,
      initialGrantedCapabilities: grantedCapabilities,
    });
    this.#journal.start(execution.executionId);
    const backend = {
      getExecutionContext: (): AutomationExecutionContext | undefined => this.#journal.resolve(execution.executionId),
      getToolExposure: () => {
        return {
          accessMode: this.#permissionPolicyStore?.getMode(credential.credentialId) ?? 'auto',
          hostCapabilities: ['desktop-ui'] as const,
        };
      },
      getPluginTools: (): SerpentMcpPluginToolBridge | undefined => this.#getPluginTools(),
      getLibraryChangeSequence: (libraryId: string): number | undefined => {
        return this.#libraryChangeSequences.get(libraryId);
      },
      subscribe: (listener: (event: SerpentMcpSessionEvent) => void) => {
        const onContext = (): void => listener({ type: 'context-changed' });
        const unsubscribe = this.#journal.onContextChanged(onContext);
        return unsubscribe;
      },
    };
    const mcpServer = createSerpentMcpServer({
      backend,
      gateway: this.#gateway,
      serverName: 'serpent',
      serverVersion: String(AUTOMATION_API_VERSION),
      ...(this.#onCommandCompleted === undefined ? {} : { onCommandCompleted: this.#onCommandCompleted }),
    });
    const currentSession: EmbeddedSession = {
      sessionId: generatedSessionId,
      credentialId: credential.credentialId,
      ...(clientName === undefined ? {} : { clientName }),
      executionId: execution.executionId,
      server: mcpServer,
      transport,
      closing: false,
    };
    transport.onclose = () => {
      void this.#closeSession(generatedSessionId);
    };
    transport.onerror = (error) => {
      this.#logger.error('mcp.session.transport', error, { sessionId: generatedSessionId });
    };
    this.#sessions.set(generatedSessionId, currentSession);
    this.#touchSession(currentSession);
    this.#publish();
    const closeOnInitialDisconnect = (): void => {
      if (!response.writableFinished) void this.#closeSession(generatedSessionId);
    };
    request.once('aborted', closeOnInitialDisconnect);
    response.once('close', closeOnInitialDisconnect);
    try {
      await withTimeout(
        (async () => {
          await mcpServer.connect(transport);
          await transport.handleRequest(request, response, body);
        })(),
        this.#initializeTimeoutMs,
        () => new EmbeddedMcpServerError(
          'MCP_SESSION_CLOSED',
          'MCP client initialization timed out before the connection was established.',
        ),
      );
    } catch (error) {
      await this.#closeSession(generatedSessionId);
      throw error;
    } finally {
      request.removeListener('aborted', closeOnInitialDisconnect);
      response.removeListener('close', closeOnInitialDisconnect);
      if (!currentSession.closing) this.#touchSession(currentSession);
    }
  }

  #touchSession(session: EmbeddedSession): void {
    if (session.idleTimer !== undefined) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (session.closing) return;
      this.#logger.info('mcp.session.idle-timeout', 'MCP session closed after inactivity.', {
        sessionId: session.sessionId,
      });
      void this.#closeSession(session.sessionId);
    }, this.#sessionIdleTimeoutMs);
  }

  async #closeSession(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.closing) return;
    session.closing = true;
    if (session.idleTimer !== undefined) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
    this.#sessions.delete(sessionId);
    this.#closedSessionIds.add(sessionId);
    while (this.#closedSessionIds.size > MAX_SESSIONS * 2) {
      const oldest = this.#closedSessionIds.values().next().value;
      if (typeof oldest !== 'string') break;
      this.#closedSessionIds.delete(oldest);
    }
    // Serpent review: endSession matches on the record's sessionId, not the
    // executionId — the previous call passed the execution id and silently
    // leaked every session's execution as permanently 'running'.
    // The HTTP transport is disposable; the Main-owned execution and any
    // durable job/idempotency record must outlive this connection.
    this.#journal.detachSession(session.sessionId);
    this.#permissionBroker?.clearExecution(session.executionId);
    try {
      await session.server.close();
    } catch (error) {
      this.#logger.error('mcp.session.close', error, { sessionId });
    }
    this.#publish();
  }

  #notifySessions(event: SerpentMcpSessionEvent): void {
    for (const session of this.#sessions.values()) {
      // The session backend reads current context lazily; this notification is
      // only a protocol hint and never carries a path or secret.
      if (event.type === 'library-changed') {
        void session.server.sendLoggingMessage({
          level: 'info',
          logger: 'serpent.library',
          data: event,
        }).catch(() => undefined);
      } else if (event.type === 'tools-changed') {
        void session.server.sendToolListChanged().catch(() => undefined);
      }
    }
  }

  #logContextChange(event: AutomationLibraryContextChangedEvent): void {
    this.#logger.info('mcp.context.changed', 'MCP session context changed.', {
      executionId: event.executionId,
      previousLibraryId: event.previousLibraryId,
      libraryId: event.libraryId,
      contextRevision: event.contextRevision,
    });
  }

  #assertActiveCredential(credentialId: string): void {
    const credential = this.#credentials.list().find((candidate) => candidate.credentialId === credentialId);
    if (credential === undefined) {
      throw new EmbeddedMcpServerError('MCP_CLIENT_UNAUTHORIZED', 'The MCP client credential is unknown.');
    }
    if (credential.revokedAt !== null) {
      throw new EmbeddedMcpServerError('MCP_CLIENT_REVOKED', 'The MCP client credential has been revoked.');
    }
  }

  #publish(): McpSettingsSnapshot {
    const snapshot = this.snapshot();
    this.#onSnapshotChanged?.(snapshot);
    for (const listener of this.#snapshotListeners) listener(snapshot);
    return snapshot;
  }
}
