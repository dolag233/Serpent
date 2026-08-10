import type { AutomationExecutionContext } from '../../src/automation/command-gateway';
import type { AutomationCapability } from '../../src/automation/command-registry';
import type { SerpentMcpToolExposure } from '../../src/mcp/tool-catalog';

export const readCapabilities = [
  'library.read',
  'folder.read',
  'asset.read',
  'content.read',
  'metadata.read',
  'tag.read',
  'collection.read',
  'job.read',
] as const satisfies readonly AutomationCapability[];

export const allCapabilities = [
  'library.create',
  ...readCapabilities,
  'folder.write',
  'content.write',
  'metadata.write',
  'tag.write',
  'collection.write',
  'ai.enqueue',
  'job.manage',
  'file.import',
  'file.move',
  'file.rename',
  'trash.write',
  'clipboard.write',
  'ui.notify',
] as const satisfies readonly AutomationCapability[];

export const readExposure: SerpentMcpToolExposure = {
  accessMode: 'auto',
  activeLibraryId: 'library-1',
  grantedCapabilities: readCapabilities,
  hostCapabilities: [],
};

export const writeExposure: SerpentMcpToolExposure = {
  accessMode: 'full-access',
  activeLibraryId: 'library-1',
  grantedCapabilities: allCapabilities,
  hostCapabilities: [],
};

export function mcpContext(
  exposure: SerpentMcpToolExposure = readExposure,
): AutomationExecutionContext {
  const libraryId = exposure.activeLibraryId ?? 'library-1';
  const grantedCapabilities = exposure.grantedCapabilities ?? readCapabilities;
  return {
    executionId: 'mcp-execution',
    source: 'mcp',
    clientCredentialId: 'test-credential',
    clientName: 'test-client',
    libraryId,
    activeLibrary: libraryId === null
      ? null
      : { libraryId, displayName: 'Selected' },
    contextRevision: 0,
    authorizedLibraryIds: libraryId === null ? [] : [libraryId],
    hostCapabilities: [...exposure.hostCapabilities],
    grantedCapabilities: [...grantedCapabilities],
    resourceBudget: {
      maxWallTimeMs: 60_000,
      maxCpuTimeMs: 60_000,
      maxMemoryBytes: 64 * 1024 * 1024,
      maxOutputBytes: 1024 * 1024,
      maxConcurrentCommands: 4,
      maxPendingPromises: 32,
    },
  };
}
