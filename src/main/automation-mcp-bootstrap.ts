import type { AutomationCommandGateway } from '../automation/command-gateway';
import type { AutomationExecutionJournal } from './automation-execution-journal';
import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import type { LibraryChangedEvent } from '../shared/protocol/responses';
import type { SerpentMcpPluginToolBridge } from '../mcp/call-tool';
import {
  startAutomationMcpHost,
  type AutomationMcpHostHandle,
} from './automation-mcp-host';

export type AutomationMcpBootstrapLogger = {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
};

export type AutomationMcpBootstrapDeps = {
  journal: AutomationExecutionJournal;
  gateway: AutomationCommandGateway;
  request(command: WorkerCommand): Promise<WorkerResult>;
  onLibraryChanged?: (listener: (event: LibraryChangedEvent) => void) => () => void;
  logger: AutomationMcpBootstrapLogger;
  env?: NodeJS.ProcessEnv;
  pluginTools?: SerpentMcpPluginToolBridge;
};

/**
 * Opens the configured library, or starts unbound for library.create, and attaches stdio MCP. Returns null when
 * `SERPENT_MCP` is not enabled so Desktop startup stays unchanged.
 */
export async function maybeStartAutomationMcpMode(
  deps: AutomationMcpBootstrapDeps,
): Promise<AutomationMcpHostHandle | null> {
  const env = deps.env ?? process.env;
  if (env.SERPENT_MCP !== '1') return null;

  const libraryPath = env.SERPENT_MCP_LIBRARY_PATH?.trim();
  if (!libraryPath && env.SERPENT_MCP_ALLOW_UNBOUND !== '1') {
    throw new Error('SERPENT_MCP=1 requires SERPENT_MCP_LIBRARY_PATH or SERPENT_MCP_ALLOW_UNBOUND=1.');
  }

  const writeAccessGranted = env.SERPENT_MCP_WRITE_ACCESS === '1';
  deps.logger.info('automation.mcp', 'Starting headless MCP host.', {
    writeAccessGranted,
    pluginTools: deps.pluginTools,
  });

  let libraryId: string | null = null;
  if (libraryPath) {
    const opened = await deps.request({
      type: 'library.open',
      selectedLibraryPath: libraryPath,
    });
    if (!opened.ok || opened.type !== 'library.opened') {
      throw new Error('MCP host failed to open the configured library.');
    }
    libraryId = opened.library.libraryId;
  }

  const handle = await startAutomationMcpHost({
    journal: deps.journal,
    gateway: deps.gateway,
    libraryId,
    onLibraryChanged: deps.onLibraryChanged,
    writeAccessGranted,
  });
  deps.logger.info('automation.mcp', 'MCP stdio server connected.', {
    executionId: handle.executionId,
    libraryId: libraryId ?? 'unbound',
  });
  return handle;
}

/**
 * Keep MCP JSON-RPC on stdout. Route console helpers to stderr before the
 * transport starts. Electron/Forge may still emit frames in unpackaged
 * launches; packaged `serpent-mcp` is the purity target.
 */
export function redirectConsoleToStderrForMcp(): void {
  const write = (...args: unknown[]): void => {
    process.stderr.write(`${args.map(String).join(' ')}\n`);
  };
  console.log = write;
  console.info = write;
  console.debug = write;
  console.warn = write;
}
