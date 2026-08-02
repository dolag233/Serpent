import { randomUUID } from 'node:crypto';

import type { AutomationCommandGateway } from '../automation/command-gateway';
import type { AutomationCapability } from '../automation/command-registry';
import type { AutomationExecutionJournal } from './automation-execution-journal';
import type { SerpentMcpToolExposure } from '../mcp/tool-catalog';
import type { SerpentMcpPluginToolBridge } from '../mcp/call-tool';
import type { LibraryChangedEvent } from '../shared/protocol/responses';
import {
  connectSerpentMcpStdio,
  createSerpentMcpServer,
} from '../mcp/create-serpent-mcp-server';

const DEFAULT_READ_CAPABILITIES = [
  'library.create',
  'library.read',
  'folder.read',
  'asset.read',
  'metadata.read',
  'tag.read',
  'collection.read',
  'job.read',
  'ui.notify',
] as const satisfies readonly AutomationCapability[];

const DEFAULT_WRITE_CAPABILITIES = [
  ...DEFAULT_READ_CAPABILITIES,
  'folder.write',
  'tag.write',
  'collection.write',
  'metadata.write',
  'ai.enqueue',
  'file.import',
  'file.move',
  'file.rename',
  'trash.write',
  'clipboard.write',
] as const satisfies readonly AutomationCapability[];

export type AutomationMcpHostOptions = {
  journal: AutomationExecutionJournal;
  gateway: AutomationCommandGateway;
  /** Optional initial library binding; null hosts may call library.create first. */
  libraryId: string | null;
  onLibraryChanged?: (listener: (event: LibraryChangedEvent) => void) => () => void;
  writeAccessGranted?: boolean;
  declaredCapabilities?: readonly AutomationCapability[];
  pluginTools?: SerpentMcpPluginToolBridge;
};

export type AutomationMcpHostHandle = {
  executionId: string;
  sessionId: string;
  exposure: SerpentMcpToolExposure;
  close: () => Promise<void>;
};

/**
 * Starts one MCP connection session: creates a Main-owned `source: 'mcp'`
 * execution, optionally grants read capabilities for the connection, and
 * attaches the Registry-backed stdio server.
 *
 * Write tools stay hidden until `writeAccessGranted` is true and a local human
 * authorization path has populated journal grants. This helper never exposes a
 * self-elevation tool.
 */
export async function startAutomationMcpHost(
  options: AutomationMcpHostOptions,
): Promise<AutomationMcpHostHandle> {
  const sessionId = randomUUID();
  const exposure: SerpentMcpToolExposure = {
    writeAccessGranted: options.writeAccessGranted === true,
  };
  const declaredCapabilities = options.declaredCapabilities
    ? [...options.declaredCapabilities]
    : exposure.writeAccessGranted
      ? [...DEFAULT_WRITE_CAPABILITIES]
      : [...DEFAULT_READ_CAPABILITIES];

  const created = options.journal.create({
    source: 'mcp',
    libraryId: options.libraryId,
    sessionId,
    declaredCapabilities,
  });
  const started = options.journal.start(created.executionId);
  if (!started) {
    throw new Error('Failed to start MCP automation execution.');
  }

  // Local host configuration (read library path and optional write-access flag)
  // is the human gate for MCP session grants. Agents never receive a tool that
  // can flip writeAccessGranted or call authorizeFromDesktop themselves.
  if (started.status === 'awaiting-authorization') {
    const authorized = options.journal.authorizeFromDesktop({
      executionId: started.executionId,
      persistence: 'session',
    });
    if (!authorized.ok) {
      options.journal.cancel(started.executionId);
      throw new Error(`MCP session authorization failed: ${authorized.code}`);
    }
  }

  const server = createSerpentMcpServer({
    gateway: options.gateway,
    getExecutionId: () => started.executionId,
    getLibraryId: () => options.journal.get(started.executionId)?.libraryId ?? null,
    getExposure: () => exposure,
    getPluginTools: () => options.pluginTools,
  });
  let transport: Awaited<ReturnType<typeof connectSerpentMcpStdio>>;
  try {
    transport = await connectSerpentMcpStdio(server);
  } catch (error) {
    // Do not leave a live Main-owned execution behind when the stdio transport
    // fails before the MCP client can use it. The deadline timer alone would
    // otherwise retain the execution and its capabilities until expiry.
    options.journal.cancel(started.executionId);
    throw error;
  }
  let closed = false;
  let unsubscribeLibraryChanged: (() => void) | undefined;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    unsubscribeLibraryChanged?.();
    options.journal.cancel(started.executionId);
  };
  const previousOnClose = transport.onclose;
  transport.onclose = () => {
    previousOnClose?.();
    cleanup();
  };
  const registeredUnsubscribe = options.onLibraryChanged?.((event) => {
    const boundLibraryId = options.journal.get(started.executionId)?.libraryId;
    if (boundLibraryId === undefined || boundLibraryId === null || boundLibraryId !== event.libraryId) {
      return;
    }
    void server.sendLoggingMessage({
      level: 'info',
      logger: 'serpent.library',
      data: {
        type: 'library.changed',
        libraryId: event.libraryId,
        changeSequence: event.changeSequence,
      },
    }).catch(() => {
      // A disconnected MCP client cannot receive a push; close() owns cleanup.
    });
  });
  if (closed) registeredUnsubscribe?.();
  else unsubscribeLibraryChanged = registeredUnsubscribe;

  return {
    executionId: started.executionId,
    sessionId,
    exposure,
    close: async () => {
      cleanup();
      await server.close();
    },
  };
}
