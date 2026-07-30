import { randomUUID } from 'node:crypto';

import type { AutomationCommandGateway } from '../automation/command-gateway';
import type { AutomationCapability } from '../automation/command-registry';
import type { AutomationExecutionJournal } from './automation-execution-journal';
import type { SerpentMcpToolExposure } from '../mcp/tool-catalog';
import {
  connectSerpentMcpStdio,
  createSerpentMcpServer,
} from '../mcp/create-serpent-mcp-server';

const DEFAULT_READ_CAPABILITIES = [
  'library.read',
  'folder.read',
  'asset.read',
  'metadata.read',
  'tag.read',
  'collection.read',
  'job.read',
] as const satisfies readonly AutomationCapability[];

const DEFAULT_WRITE_CAPABILITIES = [
  ...DEFAULT_READ_CAPABILITIES,
  'folder.write',
  'tag.write',
  'collection.write',
  'metadata.write',
  'ai.enqueue',
] as const satisfies readonly AutomationCapability[];

export type AutomationMcpHostOptions = {
  journal: AutomationExecutionJournal;
  gateway: AutomationCommandGateway;
  /**
   * Bound library for this MCP connection. Headless `library.create` without a
   * prior libraryId remains a later Phase D/E item once journal allows unset
   * library binding.
   */
  libraryId: string;
  writeAccessGranted?: boolean;
  declaredCapabilities?: readonly AutomationCapability[];
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
    getExposure: () => exposure,
  });
  await connectSerpentMcpStdio(server);

  return {
    executionId: started.executionId,
    sessionId,
    exposure,
    close: async () => {
      options.journal.cancel(started.executionId);
      await server.close();
    },
  };
}
