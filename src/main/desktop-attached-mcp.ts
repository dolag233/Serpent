import type { AutomationCommandGateway } from '../automation/command-gateway';
import type { AutomationCapability } from '../automation/command-registry';
import type { AutomationExecutionJournal } from './automation-execution-journal';
import {
  desktopControlToolDefinitions,
  desktopControlToolInputSchemas,
  type DesktopControlToolName,
  type DesktopControlToolResult,
  type DesktopBrowseAction,
  type DesktopBrowseState,
  type DesktopSelectionRequest,
  type DesktopSelectionResult,
} from '../shared/desktop-control';
import type { DesktopControlPlaneLogger, DesktopControlSession } from './desktop-control-plane';
import type { DesktopBrowseControl } from './desktop-browse-control';
import {
  DesktopControlPlane,
  type DesktopControlEndpointInfo,
} from './desktop-control-plane';
import { callSerpentMcpTool } from '../mcp/call-tool';
import { listSerpentMcpTools } from '../mcp/tool-catalog';

const DEFAULT_READ_CAPABILITIES = [
  'library.create',
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
  'file.import',
  'file.move',
  'file.rename',
  'trash.write',
  'clipboard.write',
] as const satisfies readonly AutomationCapability[];

type AttachedMcpSession = DesktopControlSession & {
  executionId: string;
};

type DesktopAttachedMcpOptions = {
  userDataPath: string;
  journal: AutomationExecutionJournal;
  gateway: AutomationCommandGateway;
  getActiveLibraryId: () => string | null;
  getLibrarySummary: (libraryId: string) => Promise<{ libraryId: string; displayName: string } | null>;
  confirmAttach: (input: {
    displayName: string;
    requestWriteAccess: boolean;
    clientName: string;
  }) => Promise<boolean>;
  focusMainWindow: () => boolean;
  applySelection: (
    libraryId: string,
    request: DesktopSelectionRequest,
  ) => DesktopSelectionResult;
  browseControl: Pick<
    DesktopBrowseControl,
    'getState' | 'openFolder' | 'setDiscovery' | 'revealAsset' | 'openViewer' | 'closeViewer' | 'navigateViewer'
  >;
  logger: DesktopControlPlaneLogger;
};

export type DesktopAttachedMcpHandle = {
  endpointInfo: DesktopControlEndpointInfo;
  close: () => Promise<void>;
};

function toolResultText(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
} {
  const text = JSON.stringify(payload, null, 2);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      content: [{ type: 'text', text }],
      structuredContent: payload as Record<string, unknown>,
    };
  }
  return { content: [{ type: 'text', text }] };
}

function attachedToolName(value: string): value is DesktopControlToolName {
  return value in desktopControlToolInputSchemas;
}

function publicMcpFailure(message: string, code = 'DESKTOP_CONTROL_REQUEST_FAILED') {
  return toolResultText({
    ok: false,
    code,
    message,
  });
}

function browseMcpFailure(error: unknown) {
  const text = error instanceof Error ? error.message : '';
  const code = text.startsWith('DESKTOP_BROWSE_FOLDER_NOT_FOUND:')
    ? 'DESKTOP_BROWSE_FOLDER_NOT_FOUND'
    : text.startsWith('DESKTOP_BROWSE_ASSET_NOT_FOUND:')
      ? 'DESKTOP_BROWSE_ASSET_NOT_FOUND'
      : text.startsWith('DESKTOP_BROWSE_ASSET_UNAVAILABLE:')
        ? 'DESKTOP_BROWSE_ASSET_UNAVAILABLE'
        : text.startsWith('DESKTOP_BROWSE_ASSET_SCOPE_UNSUPPORTED:')
          ? 'DESKTOP_BROWSE_ASSET_SCOPE_UNSUPPORTED'
          : text.startsWith('DESKTOP_BROWSE_LIBRARY_MISMATCH:')
            ? 'DESKTOP_BROWSE_LIBRARY_MISMATCH'
            : text.startsWith('DESKTOP_BROWSE_BLOCKED:')
              ? 'DESKTOP_BROWSE_BLOCKED'
              : text.startsWith('DESKTOP_BROWSE_VIEWER_CLOSED:')
                ? 'DESKTOP_BROWSE_VIEWER_CLOSED'
                : text.startsWith('DESKTOP_BROWSE_VIEWER_BOUNDARY:')
                  ? 'DESKTOP_BROWSE_VIEWER_BOUNDARY'
                  : 'DESKTOP_BROWSE_UNAVAILABLE';
  const message = code === 'DESKTOP_BROWSE_FOLDER_NOT_FOUND'
    ? 'The requested managed folder was not found.'
    : code === 'DESKTOP_BROWSE_ASSET_NOT_FOUND'
      ? 'The requested asset was not found.'
      : code === 'DESKTOP_BROWSE_ASSET_UNAVAILABLE'
        ? 'The requested asset is unavailable.'
        : code === 'DESKTOP_BROWSE_ASSET_SCOPE_UNSUPPORTED'
          ? 'The requested asset cannot be revealed in the Desktop browse view.'
          : code === 'DESKTOP_BROWSE_LIBRARY_MISMATCH'
            ? 'The Desktop browse state belongs to another library.'
            : code === 'DESKTOP_BROWSE_BLOCKED'
              ? 'The Desktop browse operation is blocked by the current UI state.'
              : code === 'DESKTOP_BROWSE_VIEWER_CLOSED'
                ? 'Desktop viewer is not open.'
                : code === 'DESKTOP_BROWSE_VIEWER_BOUNDARY'
                  ? 'Desktop viewer has no neighbor in that direction.'
                  : 'The attached Desktop browse state is unavailable.';
  return publicMcpFailure(message, code);
}

async function waitForActiveLibrary(
  getActiveLibraryId: () => string | null,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const libraryId = getActiveLibraryId();
    if (libraryId !== null) return libraryId;
    if (Date.now() >= deadline) {
      throw new Error('No active Serpent library is available for attachment.');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function startDesktopAttachedMcp(
  options: DesktopAttachedMcpOptions,
): Promise<DesktopAttachedMcpHandle> {
  const sessions = new Map<string, AttachedMcpSession>();

  const controlPlane = new DesktopControlPlane({
    userDataPath: options.userDataPath,
    logger: options.logger,
    onHello: async ({ clientName, requestWriteAccess }, sessionId) => {
      const libraryId = await waitForActiveLibrary(options.getActiveLibraryId);
      const library = await options.getLibrarySummary(libraryId);
      if (library === null) {
        throw new Error('The active Serpent library is unavailable.');
      }
      const approved = await options.confirmAttach({
        displayName: library.displayName,
        requestWriteAccess,
        clientName,
      });
      if (!approved) throw new Error('Desktop MCP attachment was denied by the local user.');

      const declaredCapabilities = requestWriteAccess
        ? [...DEFAULT_WRITE_CAPABILITIES]
        : [...DEFAULT_READ_CAPABILITIES];
      const created = options.journal.create({
        source: 'mcp',
        libraryId,
        sessionId,
        declaredCapabilities,
      });
      const started = options.journal.start(created.executionId);
      if (started === undefined || started.status !== 'awaiting-authorization') {
        throw new Error('Desktop MCP execution could not enter authorization.');
      }
      const authorized = options.journal.authorizeFromDesktop({
        executionId: started.executionId,
        persistence: 'session',
      });
      if (!authorized.ok) {
        options.journal.cancel(started.executionId);
        throw new Error(`Desktop MCP authorization failed: ${authorized.code}`);
      }

      sessions.set(sessionId, {
        sessionId,
        clientName,
        libraryId,
        writeAccessGranted: requestWriteAccess,
        executionId: started.executionId,
      });
      return {
        ok: true,
        protocolVersion: 1,
        sessionId,
        libraryId,
        displayName: library.displayName,
        writeAccessGranted: requestWriteAccess,
      };
    },
    onMcpRequest: async (session, request) => {
      const attachedSession = sessions.get(session.sessionId);
      if (attachedSession === undefined) {
        throw new Error('Desktop MCP session is no longer active.');
      }
      if (request.method === 'tools/list') {
        const registryTools = listSerpentMcpTools({
          writeAccessGranted: attachedSession.writeAccessGranted,
        });
        return {
          apiVersion: registryTools.apiVersion,
          tools: [
            ...registryTools.tools,
            ...desktopControlToolDefinitions.map((tool) => ({
              name: tool.name,
              description: `${tool.description} · attached Desktop only`,
              inputSchema: tool.inputSchema,
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                openWorldHint: false as const,
              },
            })),
          ],
        };
      }

      const toolName = typeof request.params.name === 'string'
        ? request.params.name
        : '';
      const toolArguments =
        typeof request.params.arguments === 'object' && request.params.arguments !== null
          ? request.params.arguments
          : {};

      if (attachedToolName(toolName)) {
        const parsedInput = desktopControlToolInputSchemas[toolName].safeParse(toolArguments);
        if (!parsedInput.success) {
          return publicMcpFailure('Invalid Desktop control tool arguments.', 'DESKTOP_CONTROL_INVALID_REQUEST');
        }
        if (toolName === 'serpent_desktop_focus') {
          const result: DesktopControlToolResult = {
            focused: options.focusMainWindow(),
          };
          return toolResultText({ ok: true, toolName, result, truncated: false });
        }

        if (toolName === 'serpent_desktop_get_state') {
          try {
            const state: DesktopBrowseState = await options.browseControl.getState(attachedSession.libraryId);
            return toolResultText({ ok: true, toolName, result: state, truncated: false });
          } catch (error) {
            return browseMcpFailure(error);
          }
        }

        if (toolName === 'serpent_desktop_open_folder') {
          const folderInput = parsedInput.data as { folderId: string | null };
          try {
            const state = await options.browseControl.openFolder(
              attachedSession.libraryId,
              folderInput.folderId,
            );
            return toolResultText({ ok: true, toolName, result: state, truncated: false });
          } catch (error) {
            return browseMcpFailure(error);
          }
        }

        if (toolName === 'serpent_desktop_set_discovery') {
          try {
            const state = await options.browseControl.setDiscovery(
              attachedSession.libraryId,
              parsedInput.data as Omit<
                Extract<DesktopBrowseAction, { type: 'set-discovery' }>,
                'type' | 'requestId' | 'libraryId'
              >,
            );
            return toolResultText({ ok: true, toolName, result: state, truncated: false });
          } catch (error) {
            return browseMcpFailure(error);
          }
        }

        if (toolName === 'serpent_desktop_reveal_asset') {
          const revealInput = parsedInput.data as {
            assetId: string;
            position: 'nearest' | 'center';
          };
          try {
            const result = await options.browseControl.revealAsset(
              attachedSession.libraryId,
              revealInput.assetId,
              revealInput.position,
            );
            return toolResultText({ ok: true, toolName, result, truncated: false });
          } catch (error) {
            return browseMcpFailure(error);
          }
        }

        if (toolName === 'serpent_desktop_open_viewer') {
          const viewerInput = parsedInput.data as { assetId: string };
          try {
            const state = await options.browseControl.openViewer(
              attachedSession.libraryId,
              viewerInput.assetId,
            );
            return toolResultText({ ok: true, toolName, result: state, truncated: false });
          } catch (error) {
            return browseMcpFailure(error);
          }
        }

        if (toolName === 'serpent_desktop_close_viewer') {
          try {
            const state = await options.browseControl.closeViewer(attachedSession.libraryId);
            return toolResultText({ ok: true, toolName, result: state, truncated: false });
          } catch (error) {
            return browseMcpFailure(error);
          }
        }

        if (toolName === 'serpent_desktop_navigate_viewer') {
          const navigateInput = parsedInput.data as { direction: 'previous' | 'next' };
          try {
            const state = await options.browseControl.navigateViewer(
              attachedSession.libraryId,
              navigateInput.direction,
            );
            return toolResultText({ ok: true, toolName, result: state, truncated: false });
          } catch (error) {
            return browseMcpFailure(error);
          }
        }

        const selectionInput =
          desktopControlToolInputSchemas.serpent_desktop_select_assets.safeParse(toolArguments);
        if (!selectionInput.success) {
          return publicMcpFailure('Invalid Desktop selection arguments.', 'DESKTOP_CONTROL_INVALID_REQUEST');
        }
        const result = options.applySelection(
          attachedSession.libraryId,
          selectionInput.data,
        );
        return toolResultText({ ok: true, toolName, result, truncated: false });
      }

      const result = await callSerpentMcpTool({
        toolName,
        arguments: toolArguments,
        executionId: attachedSession.executionId,
        exposure: { writeAccessGranted: attachedSession.writeAccessGranted },
        gateway: options.gateway,
      });
      if (!result.ok) {
        return {
          ...toolResultText({
            ok: false,
            code: result.code,
            message: result.message,
            gateway: result.gateway,
          }),
          isError: true,
        };
      }
      return toolResultText({
        ok: true,
        toolName: result.toolName,
        commandId: result.commandId,
        result: result.result,
        ...(result.undoGroupId === undefined ? {} : { undoGroupId: result.undoGroupId }),
        truncated: result.truncated,
      });
    },
    onSessionClosed: (session) => {
      const attachedSession = sessions.get(session.sessionId);
      sessions.delete(session.sessionId);
      if (attachedSession !== undefined) options.journal.cancel(attachedSession.executionId);
    },
  });

  const endpointInfo = await controlPlane.start();
  return {
    endpointInfo,
    close: async () => {
      for (const session of sessions.values()) options.journal.cancel(session.executionId);
      sessions.clear();
      await controlPlane.close();
    },
  };
}
