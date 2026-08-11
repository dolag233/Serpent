import { describe, expect, it, vi } from 'vitest';

import {
  automationCommandRegistry,
  automationCapabilityRegistry,
  automationCapabilitySchema,
  automationCriticalOperationRegistry,
  AUTOMATION_MAX_PAGE_SIZE,
  type AutomationCapability,
  describeAutomationCommands,
  getAutomationCapabilityDefinition,
  getAutomationCommandPermissionMetadata,
  generateAutomationTypeDeclaration,
} from '../../src/automation/command-registry';
import {
  createAutomationCommandGateway,
  type AutomationCommandEnvelope,
  type AutomationGatewayAuditLogger,
  type AutomationExecutionAuditSink,
  type AutomationExecutionResolver,
  type AutomationWorkerClient,
} from '../../src/automation/command-gateway';
import { AutomationLibraryWorkerAdapter } from '../../src/main/automation-worker-adapter';
import { automationScriptCommandIdSchema } from '../../src/shared/automation-script-api';
import { createPublicError } from '../../src/shared/protocol/errors';
import { parseWorkerRequest, type WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';

const allReadCapabilities = [
  'library.read',
  'folder.read',
  'asset.read',
  'metadata.read',
  'tag.read',
  'collection.read',
  'job.read',
] as const;

function request(
  commandId: string,
  input: unknown = {},
  executionId = 'execution-1',
  idempotencyKey?: string,
): AutomationCommandEnvelope {
  return {
    apiVersion: 1,
    commandId,
    executionId,
    input: idempotencyKey === undefined || typeof input !== 'object' || input === null
      ? input
      : { ...(input as Record<string, unknown>), idempotencyKey },
  };
}

function resolver(overrides: Partial<{
  source: 'desktop-console' | 'script' | 'mcp' | 'test';
  clientCredentialId: string;
  clientName: string;
  libraryId: string | null;
  grantedCapabilities: readonly AutomationCapability[];
}> = {}): AutomationExecutionResolver {
  const context = {
    executionId: 'execution-1',
    source: overrides.source ?? 'test',
    ...(overrides.clientCredentialId === undefined
      ? {}
      : { clientCredentialId: overrides.clientCredentialId }),
    ...(overrides.clientName === undefined ? {} : { clientName: overrides.clientName }),
    libraryId: overrides.libraryId === undefined ? 'library-1' : overrides.libraryId,
    grantedCapabilities: overrides.grantedCapabilities === undefined
      ? [...allReadCapabilities]
      : [...overrides.grantedCapabilities],
  };
  return {
    resolve: (executionId) => executionId === 'execution-1'
      ? context
      : undefined,
  };
}

function gateway(worker: AutomationWorkerClient, overrides = {}) {
  return createAutomationCommandGateway(worker, resolver(overrides));
}

function asset(assetId: string) {
  return {
    assetId,
    locationKind: 'managed' as const,
    managedFolderId: null,
    relativeFilePath: `${assetId}.png`,
    displayName: `${assetId}.png`,
    currentRevisionId: `revision-${assetId}`,
    byteSize: 1,
    modifiedAt: '2026-07-28T00:00:00.000Z',
    availability: 'available' as const,
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    mediaType: 'image' as const,
    width: null,
    height: null,
    durationMs: null,
  };
}

function sequenceAsset(assetId: string) {
  return {
    ...asset(assetId),
    sequence: {
      sequenceId: `sequence-${assetId}`,
      fps: 24,
      frameCount: 3,
      frames: [0, 1, 2].map((frameNumber) => ({
        assetId: `${assetId}-frame-${frameNumber}`,
        displayName: `${assetId}_${frameNumber}.png`,
        relativeFilePath: `${assetId}_${frameNumber}.png`,
        currentRevisionId: `revision-${assetId}-${frameNumber}`,
        frameNumber,
        thumbnailArtifactId: null,
      })),
    },
  };
}

class RecordingWorker implements AutomationWorkerClient {
  readonly commands: WorkerCommand[] = [];

  constructor(private readonly nextResult: WorkerResult) {}

  async request(command: WorkerCommand): Promise<WorkerResult> {
    this.commands.push(command);
    return this.nextResult;
  }
}

describe('Automation Command Registry', () => {
  it('contains complete read/write descriptors and exports JSON/TypeScript contracts', () => {
    expect(automationCommandRegistry).toHaveLength(81);
    expect(new Set(automationCommandRegistry.map((command) => command.commandId)).size)
      .toBe(automationCommandRegistry.length);
    const registryIds = new Set(automationCommandRegistry.map((command) => command.commandId));
    for (const commandId of automationScriptCommandIdSchema.options) {
      expect(registryIds).toContain(commandId);
    }
    const descriptor = (commandId: string) => automationCommandRegistry.find((command) => command.commandId === commandId)!;
    // Serpent-10lo: folder/collection parent ids are strict UUIDs — non-UUID
    // values are rejected by the schema (this is the intended contract).
    const PARENT_FOLDER_ID = '00000000-0000-4000-8000-0000000000f1';
    const PARENT_COLLECTION_ID = '00000000-0000-4000-8000-0000000000c1';
    expect(descriptor('folder.create').toWorkerCommand('library-1', descriptor('folder.create').inputSchema.parse({
      name: 'Child',
      parentFolderId: PARENT_FOLDER_ID,
    }) as never)).toMatchObject({ type: 'folder.create', parentFolderId: PARENT_FOLDER_ID });
    expect(descriptor('collection.create').toWorkerCommand('library-1', descriptor('collection.create').inputSchema.parse({
      name: 'Child',
      parentId: PARENT_COLLECTION_ID,
    }) as never)).toMatchObject({ type: 'collection.create', parentId: PARENT_COLLECTION_ID });
    expect(descriptor('collection.update').toWorkerCommand('library-1', descriptor('collection.update').inputSchema.parse({
      collectionId: 'child-collection',
      parentId: PARENT_COLLECTION_ID,
    }) as never)).toMatchObject({ type: 'collection.update', parentId: PARENT_COLLECTION_ID });
    for (const command of automationCommandRegistry) {
      expect(command.apiVersion).toBe(1);
      if (command.commandId === 'asset.rating.set'
        || command.commandId === 'asset.metadata.set'
        || command.commandId === 'tag.create'
        || command.commandId === 'tag.assign'
        || command.commandId === 'tag.remove'
        || command.commandId === 'collection.create'
        || command.commandId === 'collection.assets.add'
        || command.commandId === 'collection.assets.remove'
        || command.commandId === 'ai.enqueue') {
        expect(command.impact).toBe('metadata-write');
        expect(command.approvalPolicy).toBe('execution');
        expect(command.mcp.public).toBe(false);
      } else if (command.commandId === 'asset.paths.copy') {
        expect(command.impact).not.toBe('read');
        expect(command.approvalPolicy).toBe('execution');
        expect(command.mcp.public).toBe(false);
      } else if (command.commandId === 'folder.create') {
        expect(command.impact).toBe('file-write');
        expect(command.approvalPolicy).toBe('execution');
        expect(command.mcp.public).toBe(false);
      } else if (command.commandId === 'asset.content.stage') {
        expect(command.impact).toBe('file-write');
        expect(command.approvalPolicy).toBe('none');
        expect(command.mcp.public).toBe(false);
      } else if ([
        'asset.trash',
        'asset.content.replace',
        'asset.content.replace-batch',
        'asset.move',
        'asset.rename-file',
        'asset.rename-files',
        'asset.restore-if-original-vacant',
        'library.create',
        'file.import',
      ].includes(command.commandId)) {
        expect(command.impact).toBe('file-write');
        expect(command.approvalPolicy).toBe('plan');
        expect(command.mcp.public).toBe(false);
      } else if (command.commandId === 'asset.delete-permanent') {
        // Serpent-8b5b.2: the dangerous command is a write with no plan
        // approval — the two-phase challenge replaces it.
        expect(command.impact).toBe('destructive');
        expect(command.approvalPolicy).toBe('none');
        expect(command.mcp.public).toBe(false);
      } else if ([
        'library.close', 'library.rename', 'library.delete-from-disk', 'library.export', 'library.import-folder', 'library.import-zip',
        'folder.rename', 'folder.move', 'folder.delete-empty',
        'linked-folder.create', 'linked-folder.relink', 'linked-folder.remove', 'linked-folder.rules.set', 'linked-folder.refresh',
        'asset.copy', 'asset.preview.get', 'asset.refresh', 'asset.metadata.set-many',
        'tag.rename', 'tag.delete', 'tag.delete-many', 'tag.merge',
        'collection.update', 'collection.reorder', 'collection.delete', 'collection.assets.reorder',
        'smart-collection.create', 'smart-collection.update', 'smart-collection.delete',
      ].includes(command.commandId)) {
        expect(command.impact).not.toBe('read');
        expect(command.approvalPolicy).toBe(command.commandId === 'library.delete-from-disk' ? 'none' : 'execution');
      } else {
        expect(command.impact).toBe('read');
        expect(command.approvalPolicy).toBe('none');
      }
      if (command.commandId === 'asset.trash' || command.commandId === 'asset.move') {
        expect(command.supportsUndo).toBe(true);
      }
      if (command.commandId === 'asset.content.replace') {
        expect(command.requiredCapabilities).toEqual(['library.read', 'asset.read', 'content.write']);
        expect(command.allowedSources).toEqual(['desktop-console', 'script', 'mcp', 'test', 'plugin']);
        expect(command.approvalPolicy).toBe('plan');
        expect(command.supportsUndo).toBe(false);
        expect(command.atomicity).toBe('recoverable-file-operation');
      }
      if (command.commandId === 'asset.content.replace-batch') {
        expect(command.requiredCapabilities).toEqual(['library.read', 'asset.read', 'content.write']);
        expect(command.supportsBatch).toBe(true);
        expect(command.approvalPolicy).toBe('plan');
        expect(command.supportsUndo).toBe(false);
        expect(command.atomicity).toBe('recoverable-file-operation');
      }
      if (command.commandId === 'asset.content.read') {
        expect(command.requiredCapabilities).toEqual(['library.read', 'asset.read', 'content.read']);
        expect(command.allowedSources).toEqual(['desktop-console', 'script', 'mcp', 'test', 'plugin']);
        expect(command.approvalPolicy).toBe('none');
        expect(command.mcp.public).toBe(false);
        expect(command.supportsUndo).toBe(false);
      }
      if (command.commandId === 'file.import') {
        // Import recovery refs are not wired; do not advertise undo yet.
        expect(command.supportsUndo).toBe(false);
      }
      if (command.commandId === 'library.create' || command.commandId === 'file.import') {
        expect(command.supportsIdempotencyKey).toBe(true);
      }
      if (!['execution.status', 'library.list-open', 'library.list-recent', 'library.open', 'library.show-in-desktop', 'ui.notify', 'library.delete-from-disk'].includes(command.commandId)) {
        expect(command.requiredCapabilities.length).toBeGreaterThan(0);
      }
      expect(command.mcp.toolName).toMatch(/^serpent_/u);
      expect(command.mcp.outputLimit).toBeLessThanOrEqual(AUTOMATION_MAX_PAGE_SIZE);
      expect(command.inputSchema.toJSONSchema()).toBeTypeOf('object');
      expect(command.resultSchema.toJSONSchema()).toBeTypeOf('object');
    }

    const description = describeAutomationCommands();
    expect(description.apiVersion).toBe(1);
    expect(description.commands.map((command) => command.commandId)).toContain('asset.search');
    expect(description.commands.map((command) => command.commandId)).toContain('tag.create');
    expect(description.commands.map((command) => command.commandId)).toContain('folder.create');
    expect(description.commands.map((command) => command.commandId)).toContain('library.change-sequence');
    expect(description.commands.map((command) => command.commandId)).toContain('asset.ai-content.get');

    const declaration = generateAutomationTypeDeclaration('@serpent/test-api');
    expect(declaration).toContain('const serpent: SerpentAutomationApi');
    expect(declaration).toContain('interface SerpentScriptAssetSearchPage');
    expect(declaration).toContain('readonly currentRevisionId: string;');
    expect(declaration).toContain('search(input: { query: string | null; limit?: number; offset?: number })');
    expect(declaration).toContain('changeSequence(): Promise<{ readonly changeSequence: number }>');
    expect(declaration).toContain('setRating(assetIds: readonly string[]');
    expect(declaration).toContain('copyFilePaths(assetIds: readonly string[]');
    expect(declaration).toContain('renameFiles(items: readonly');
    expect(declaration).toContain('restoreIfOriginalVacant(assetIds: readonly string[]');
    expect(declaration).toContain('tags: {');
    expect(declaration).toContain('create(name: string): Promise<SerpentScriptTag>');
    expect(declaration).toContain('folders: {');
    expect(declaration).toContain('create(name: string, parentFolderId?: string | null)');
    expect(declaration).toContain('setMetadata(input: { assetId: string');
    expect(declaration).toContain('getAiContent(assetId: string): Promise<SerpentAiContent>');
    expect(declaration).toContain('create(name: string, parentId?: string | null)');
    expect(declaration).toContain('addAssets(collectionId: string, assetIds: readonly string[])');
    expect(declaration).toContain('enqueue(input?: { assetIds?: readonly string[]');
    expect(declaration).not.toContain('zod');
    expect(declaration).not.toContain('cli');
  });

  it('keeps capability risk metadata complete and separates critical operations', () => {
    expect(automationCapabilityRegistry).toHaveLength(automationCapabilitySchema.options.length);
    expect(new Set(automationCapabilityRegistry.map((definition) => definition.capability)).size)
      .toBe(automationCapabilityRegistry.length);
    for (const definition of automationCapabilityRegistry) {
      expect(getAutomationCapabilityDefinition(definition.capability)).toEqual(definition);
      if (definition.defaultPolicy === 'allow') {
        expect(definition.riskTier).toBe('safe');
        expect(definition.canPersist).toBe(false);
      } else {
        expect(definition.riskTier).toBe('controlled');
        expect(definition.canPersist).toBe(true);
      }
    }

    expect(automationCriticalOperationRegistry).toHaveLength(7);
    expect(automationCriticalOperationRegistry.map((operation) => operation.operation)).toEqual([
      'library.delete-from-disk',
      'folder.delete-from-disk',
      'linked-folder.delete-from-disk',
      'asset.delete-from-disk',
      'asset.delete-permanent',
      'asset.delete-linked-source',
      'trash.purge',
    ]);
    for (const operation of automationCriticalOperationRegistry) {
      expect(operation).toMatchObject({
        riskTier: 'critical',
        canPersist: false,
        exposedToMcp: operation.operation === 'library.delete-from-disk'
          || operation.operation === 'asset.delete-permanent',
      });
    }

    for (const command of automationCommandRegistry) {
      const metadata = getAutomationCommandPermissionMetadata(command);
      // Serpent-8b5b.2: the single MCP-exposed dangerous command is critical.
      const expectedTier = command.criticalOperation === true
        ? 'critical'
        : command.impact === 'read' ? 'safe' : 'controlled';
      expect(metadata.riskTier).toBe(expectedTier);
      expect(metadata.requiresCriticalConfirmation).toBe(command.criticalOperation === true);
      for (const capability of command.requiredCapabilities) {
        expect(getAutomationCapabilityDefinition(capability)).toBeDefined();
      }
    }
  });
});

describe('Automation Command Gateway', () => {
  it('asks the Main permission broker for an MCP controlled capability before dispatch', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'tag.created',
      tag: { tagId: 'tag-new', name: '天气-雨', assetCount: 0 },
    });
    const permissionBroker = {
      authorize: vi.fn(async () => ({ allowed: true as const, scope: 'allow-once' as const })),
      clearExecution: vi.fn(),
      clearCredential: vi.fn(),
      clearCapability: vi.fn(),
    };
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      source: 'mcp',
      clientCredentialId: '00000000-0000-4000-8000-000000000001',
      clientName: 'Test MCP client',
    }), { permissionBroker });

    await expect(commandGateway.execute(request('tag.create', { name: '天气-雨' }))).resolves.toMatchObject({
      ok: true,
      result: { id: 'tag-new', name: '天气-雨' },
    });
    expect(permissionBroker.authorize).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        source: 'mcp',
        clientCredentialId: '00000000-0000-4000-8000-000000000001',
      }),
      descriptor: expect.objectContaining({ commandId: 'tag.create' }),
      commandInput: { name: '天气-雨' },
    }));
    expect(worker.commands).toEqual([{
      type: 'tag.create',
      libraryId: 'library-1',
      name: '天气-雨',
    }]);
  });

  it('does not dispatch an MCP controlled command when the permission broker denies it', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'tag.created',
      tag: { tagId: 'tag-new', name: '天气-雨', assetCount: 0 },
    });
    const permissionBroker = {
      authorize: vi.fn(async () => ({ allowed: false as const, reason: 'denied' as const })),
      clearExecution: vi.fn(),
      clearCredential: vi.fn(),
      clearCapability: vi.fn(),
    };
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      source: 'mcp',
      clientCredentialId: '00000000-0000-4000-8000-000000000002',
    }), { permissionBroker });

    await expect(commandGateway.execute(request('tag.create', { name: '天气-雨' }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_CAPABILITY_DENIED' },
    });
    expect(permissionBroker.authorize).toHaveBeenCalledOnce();
    expect(worker.commands).toEqual([]);
  });

  it('uses one broker decision for an MCP plan and dispatches only the approved proof', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.trashed',
      trashedCount: 1,
      operationId: 'operation-trash-1',
    });
    const plan = {
      planHash: 'a'.repeat(64),
      expectedChangeSequence: 42,
      assetStates: [{ assetId: 'asset-1', stateToken: 'b'.repeat(64) }],
    };
    const permissionBroker = {
      authorize: vi.fn(async () => ({ allowed: true as const, scope: 'allow-session' as const })),
      clearExecution: vi.fn(),
      clearCredential: vi.fn(),
      clearCapability: vi.fn(),
    };
    const planApprovals: unknown[] = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      source: 'mcp',
      clientCredentialId: '00000000-0000-4000-8000-000000000003',
      clientName: 'Planner',
    }), {
      permissionBroker,
      filePlanApprovalHandler: {
        prepareAndApprove: async (input) => {
          planApprovals.push(input);
          expect(input.requestApproval).toBeDefined();
          const approved = await input.requestApproval!({
            commandId: input.commandId,
            executionId: input.executionId,
            libraryId: input.libraryId,
            commandInput: input.commandInput,
            source: 'mcp',
            clientName: input.clientName,
            libraryDisplayName: input.libraryDisplayName,
            summary: {
              operation: 'trash',
              targetCount: 1,
              executableCount: 1,
              blockedCount: 0,
              conflictCount: 0,
              undoSupported: true,
            },
          });
          return approved ? plan : undefined;
        },
      },
    });

    await expect(commandGateway.execute(request('asset.trash', { assetIds: ['asset-1'] }))).resolves.toMatchObject({
      ok: true,
      result: { trashedCount: 1, operationId: 'operation-trash-1' },
    });
    expect(planApprovals).toHaveLength(1);
    expect(permissionBroker.authorize).toHaveBeenCalledOnce();
    expect(permissionBroker.authorize).toHaveBeenCalledWith(expect.objectContaining({
      planSummary: expect.objectContaining({ operation: 'trash', executableCount: 1 }),
    }));
    expect(worker.commands).toEqual([{
      type: 'asset.trash',
      libraryId: 'library-1',
      assetIds: ['asset-1'],
      automationPlan: plan,
    }]);
  });

  it('fires the import-completed hook for a successful automation import (Serpent-ihpx)', async () => {
    const plan = {
      planHash: 'a'.repeat(64),
      expectedChangeSequence: 0,
      assetStates: [],
    };
    const asset = (assetId: string) => ({
      assetId,
      locationKind: 'managed' as const,
      managedFolderId: null,
      relativeFilePath: `${assetId}.png`,
      displayName: `${assetId}.png`,
      currentRevisionId: `revision-${assetId}`,
      byteSize: 10,
      modifiedAt: '2026-08-11T00:00:00.000Z',
      availability: 'available' as const,
      rating: 0,
      favorite: false,
      deletedAt: null,
      trashedFromPath: null,
      trashedFromTombstoneId: null,
      remainingDays: null,
      thumbnailStatus: 'pending' as const,
      thumbnailArtifactId: `thumb-${assetId}`,
      mediaType: 'image' as const,
      width: 100,
      height: 100,
      durationMs: null,
    });
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.import.completed',
      completion: {
        importedCount: 2,
        fileCount: 2,
        assetCount: 2,
        skippedCount: 0,
        replacedCount: 0,
        assets: [asset('asset-imported-1'), asset('asset-imported-2')],
      },
    });
    const completed: Array<{ libraryId: string; importedAssetIds: string[]; source: string }> = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: [...allReadCapabilities, 'file.import'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => plan,
      },
      onImportCompleted: (input) => completed.push(input),
    });

    await expect(commandGateway.execute(request('file.import', {
      sourceKind: 'files',
      sourcePaths: ['/tmp/a.png', '/tmp/b.png'],
    }))).resolves.toMatchObject({ ok: true });
    expect(completed).toEqual([{
      libraryId: 'library-1',
      importedAssetIds: ['asset-imported-1', 'asset-imported-2'],
      source: 'test',
    }]);
  });

  it('does not fire the import-completed hook when nothing was imported', async () => {
    const plan = {
      planHash: 'a'.repeat(64),
      expectedChangeSequence: 0,
      assetStates: [],
    };
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.import.completed',
      completion: {
        importedCount: 0,
        fileCount: 0,
        assetCount: 0,
        skippedCount: 3,
        replacedCount: 0,
        assets: [],
      },
    });
    const completed: unknown[] = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: [...allReadCapabilities, 'file.import'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => plan,
      },
      onImportCompleted: (input) => completed.push(input),
    });

    await expect(commandGateway.execute(request('file.import', {
      sourceKind: 'files',
      sourcePaths: ['/tmp/skipped.png'],
    }))).resolves.toMatchObject({ ok: true });
    expect(completed).toEqual([]);
  });

  it('keeps the import succeeded when the import-completed hook throws', async () => {
    const plan = {
      planHash: 'a'.repeat(64),
      expectedChangeSequence: 0,
      assetStates: [],
    };
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.import.completed',
      completion: {
        importedCount: 1,
        fileCount: 1,
        assetCount: 1,
        skippedCount: 0,
        replacedCount: 0,
        assets: [{
          assetId: 'asset-imported-1',
          locationKind: 'managed' as const,
          managedFolderId: null,
          relativeFilePath: 'a.png',
          displayName: 'a.png',
          currentRevisionId: 'revision-a',
          byteSize: 10,
          modifiedAt: '2026-08-11T00:00:00.000Z',
          availability: 'available' as const,
          rating: 0,
          favorite: false,
          deletedAt: null,
          trashedFromPath: null,
          trashedFromTombstoneId: null,
          remainingDays: null,
          thumbnailStatus: 'pending' as const,
          thumbnailArtifactId: 'thumb-a',
          mediaType: 'image' as const,
          width: 100,
          height: 100,
          durationMs: null,
        }],
      },
    });
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: [...allReadCapabilities, 'file.import'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => plan,
      },
      onImportCompleted: () => {
        throw new Error('post-import side effect exploded');
      },
    });

    await expect(commandGateway.execute(request('file.import', {
      sourceKind: 'files',
      sourcePaths: ['/tmp/a.png'],
    }))).resolves.toMatchObject({ ok: true });
  });

  it('does not fire the import-completed hook when the import reports conflicts', async () => {
    const plan = {
      planHash: 'a'.repeat(64),
      expectedChangeSequence: 0,
      assetStates: [],
    };
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.import.conflicts',
      plan: {
        importId: 'import-conflicts-1',
        fileCount: 2,
        totalBytes: 20,
        suspectedDuplicateCount: 2,
        libraryDuplicateCount: 0,
        nameConflictCount: 0,
        examples: [{ displayName: 'a.png', kind: 'suspected-duplicate' as const }],
      },
    });
    const completed: unknown[] = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: [...allReadCapabilities, 'file.import'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => plan,
      },
      onImportCompleted: (input) => completed.push(input),
    });

    await expect(commandGateway.execute(request('file.import', {
      sourceKind: 'files',
      sourcePaths: ['/tmp/a.png', '/tmp/b.png'],
    }))).resolves.toMatchObject({ ok: true, result: { status: 'conflicts' } });
    expect(completed).toEqual([]);
  });

  it('does not re-fire the import-completed hook for an idempotent replay', async () => {
    const plan = {
      planHash: 'a'.repeat(64),
      expectedChangeSequence: 0,
      assetStates: [],
    };
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.import.completed',
      completion: {
        importedCount: 1,
        fileCount: 1,
        assetCount: 1,
        skippedCount: 0,
        replacedCount: 0,
        assets: [{
          assetId: 'asset-imported-1',
          locationKind: 'managed' as const,
          managedFolderId: null,
          relativeFilePath: 'a.png',
          displayName: 'a.png',
          currentRevisionId: 'revision-a',
          byteSize: 10,
          modifiedAt: '2026-08-11T00:00:00.000Z',
          availability: 'available' as const,
          rating: 0,
          favorite: false,
          deletedAt: null,
          trashedFromPath: null,
          trashedFromTombstoneId: null,
          remainingDays: null,
          thumbnailStatus: 'pending' as const,
          thumbnailArtifactId: 'thumb-a',
          mediaType: 'image' as const,
          width: 100,
          height: 100,
          durationMs: null,
        }],
      },
    });
    const completed: Array<{ importedAssetIds: string[] }> = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: [...allReadCapabilities, 'file.import'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => plan,
      },
      onImportCompleted: (input) => completed.push(input),
    });
    const envelope = request('file.import', {
      sourceKind: 'files',
      sourcePaths: ['/tmp/a.png'],
    }, 'execution-1', 'import-key-1');

    await expect(commandGateway.execute(envelope)).resolves.toMatchObject({ ok: true });
    await expect(commandGateway.execute(envelope)).resolves.toMatchObject({ ok: true });
    expect(worker.commands).toHaveLength(1);
    expect(completed).toEqual([{ libraryId: 'library-1', importedAssetIds: ['asset-imported-1'], source: 'test' }]);
  });

  it('re-plans one stale MCP import instead of surfacing a transient VERSION_CONFLICT', async () => {
    const worker: AutomationWorkerClient & { commands: WorkerCommand[] } = {
      commands: [],
      request: vi.fn(async (command: WorkerCommand): Promise<WorkerResult> => {
        worker.commands.push(command);
        if (worker.commands.length === 1) {
          return { ok: false, error: createPublicError('VERSION_CONFLICT', undefined, 2) };
        }
        return {
          ok: true,
          type: 'asset.import.completed',
          completion: {
            importedCount: 1,
            fileCount: 1,
            assetCount: 1,
            skippedCount: 0,
            replacedCount: 0,
            assets: [asset('asset-retried')],
          },
        };
      }),
    };
    const plans = [0, 1].map((index) => ({
      planHash: `${index}`.repeat(64),
      expectedChangeSequence: index,
      assetStates: [],
      importPlan: {
        planHash: `${index}`.repeat(64),
        expectedChangeSequence: index,
        sourceStates: [],
      },
    }));
    let approvals = 0;
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      source: 'mcp',
      clientCredentialId: '00000000-0000-4000-8000-000000000004',
      grantedCapabilities: [...allReadCapabilities, 'file.import'],
    }), {
      filePlanApprovalHandler: { prepareAndApprove: async () => plans[approvals++]! },
    });

    await expect(commandGateway.execute(request('file.import', {
      sourceKind: 'files',
      sourcePaths: ['/tmp/retry.png'],
    }))).resolves.toMatchObject({ ok: true, result: { status: 'completed' } });
    expect(approvals).toBe(2);
    expect(worker.commands).toHaveLength(2);
    expect(worker.commands[0]).toMatchObject({ type: 'asset.import.prepare', automationPlan: plans[0]!.importPlan });
    expect(worker.commands[1]).toMatchObject({ type: 'asset.import.prepare', automationPlan: plans[1]!.importPlan });
  });

  it('rejects library-scoped commands before Worker dispatch when a headless execution is unbound', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'tag.list',
      tags: [],
    });
    const unboundResolver: AutomationExecutionResolver = {
      resolve: () => ({
        executionId: 'execution-1',
        source: 'test',
        libraryId: null,
        grantedCapabilities: [...allReadCapabilities],
      }),
    };
    const commandGateway = createAutomationCommandGateway(worker, unboundResolver);

    await expect(commandGateway.execute(request('tag.list'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_LIBRARY_NOT_BOUND' },
    });
    expect(worker.commands).toEqual([]);
  });

  it('validates input, injects the bound library id, and preserves the Worker result', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'tag.list',
      tags: [{ tagId: 'tag-1', name: 'y2k', assetCount: 4 }],
    });
    const commandGateway = gateway(worker);

    const result = await commandGateway.execute(request('tag.list'));

    expect(worker.commands).toEqual([{ type: 'tag.list', libraryId: 'library-1' }]);
    expect(result).toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'tag.list',
      executionId: 'execution-1',
      result: {
        items: [{ tagId: 'tag-1', name: 'y2k', assetCount: 4 }],
        total: 1,
        offset: 0,
        limit: 50,
        hasMore: false,
      },
    });
  });

  it('routes AI content reads through the bound library without exposing paths', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'ai.content.got',
      assetId: 'asset-1',
      description: 'AI generated description',
      tags: ['cloud', 'cumulus'],
      rating: 4,
      modelVersion: 'test-model',
    });
    const commandGateway = gateway(worker);

    const result = await commandGateway.execute(
      request('asset.ai-content.get', { assetId: 'asset-1' }),
    );

    expect(worker.commands).toEqual([{
      type: 'ai.content.get',
      libraryId: 'library-1',
      assetId: 'asset-1',
    }]);
    expect(result).toMatchObject({
      ok: true,
      commandId: 'asset.ai-content.get',
      result: {
        assetId: 'asset-1',
        description: 'AI generated description',
        tags: ['cloud', 'cumulus'],
        rating: 4,
        modelVersion: 'test-model',
      },
    });
    expect(JSON.stringify(result)).not.toContain('libraryPath');
  });

  it('routes an approved batch rating write through the same Gateway contract', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.rating.updated',
      updatedCount: 2,
      skipped: [{ assetId: 'missing', reason: 'asset_not_found' }],
    });
    const commandGateway = gateway(worker, {
      grantedCapabilities: [...allReadCapabilities, 'metadata.write'],
    });

    await expect(commandGateway.execute(request('asset.rating.set', {
      assetIds: ['asset-1', 'asset-2', 'missing'],
      rating: 4,
    }))).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'asset.rating.set',
      executionId: 'execution-1',
      result: {
        updatedCount: 2,
        skipped: [{ assetId: 'missing', reason: 'asset_not_found' }],
      },
    });
    expect(worker.commands).toEqual([{
      type: 'asset.rating.set',
      libraryId: 'library-1',
      assetIds: ['asset-1', 'asset-2', 'missing'],
      rating: 4,
    }]);
  });

  it('routes tag create/assign and folder create through metadata/file-write Gateway contracts', async () => {
    const tagWorker = new RecordingWorker({
      ok: true,
      type: 'tag.created',
      tag: { tagId: 'tag-new', name: '天气-雨', assetCount: 0 },
    });
    const tagGateway = gateway(tagWorker, {
      grantedCapabilities: [...allReadCapabilities, 'tag.write'],
    });
    await expect(tagGateway.execute(request('tag.create', { name: '天气-雨' }))).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'tag.create',
      executionId: 'execution-1',
      result: { id: 'tag-new', name: '天气-雨', assetCount: 0 },
    });
    expect(tagWorker.commands).toEqual([{
      type: 'tag.create',
      libraryId: 'library-1',
      name: '天气-雨',
    }]);

    const assignWorker = new RecordingWorker({
      ok: true,
      type: 'tag.assigned',
      assignedCount: 1,
      skipped: [],
    });
    const assignGateway = gateway(assignWorker, {
      grantedCapabilities: [...allReadCapabilities, 'tag.write'],
    });
    await expect(assignGateway.execute(request('tag.assign', {
      assetIds: ['asset-1'],
      tagIds: ['tag-new'],
    }))).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'tag.assign',
      executionId: 'execution-1',
      result: { assignedCount: 1, skipped: [] },
    });

    const folderWorker = new RecordingWorker({
      ok: true,
      type: 'folder.created',
      folder: {
        folderId: 'folder-new',
        parentFolderId: null,
        name: '天气',
        relativePath: '天气',
        directAssetCount: 0,
        childFolderCount: 0,
      },
    });
    const folderGateway = gateway(folderWorker, {
      grantedCapabilities: [...allReadCapabilities, 'folder.write'],
    });
    await expect(folderGateway.execute(request('folder.create', { name: '天气' }))).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'folder.create',
      executionId: 'execution-1',
      result: { id: 'folder-new', parentId: null, name: '天气' },
    });
    expect(folderWorker.commands).toEqual([{
      type: 'folder.create',
      libraryId: 'library-1',
      name: '天气',
    }]);
  });

  it('routes collection.create, asset.metadata.set, and ai.enqueue through Gateway contracts', async () => {
    const collectionWorker = new RecordingWorker({
      ok: true,
      type: 'collection.created',
      collection: {
        collectionId: 'collection-new',
        parentId: null,
        name: '灵感',
        description: null,
        coverAssetId: null,
        position: 0,
        assetCount: 0,
        childCollectionCount: 0,
      },
    });
    const collectionGateway = gateway(collectionWorker, {
      grantedCapabilities: [...allReadCapabilities, 'collection.write'],
    });
    await expect(collectionGateway.execute(request('collection.create', { name: '灵感' }))).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'collection.create',
      executionId: 'execution-1',
      result: { id: 'collection-new', parentId: null, name: '灵感', assetCount: 0 },
    });
    expect(collectionWorker.commands).toEqual([{
      type: 'collection.create',
      libraryId: 'library-1',
      name: '灵感',
    }]);

    const metadataWorker = new RecordingWorker({
      ok: true,
      type: 'asset.metadata.updated',
      metadata: {
        assetId: 'asset-1',
        description: '雨后',
        rating: 4,
        favorite: true,
        palette: null,
        automaticPalette: [],
        effectivePalette: [],
        paletteSource: null,
        sourcePageUrl: null,
        author: null,
        tags: [],
        entityVersion: 2,
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    });
    const metadataGateway = gateway(metadataWorker, {
      grantedCapabilities: [...allReadCapabilities, 'metadata.write'],
    });
    await expect(metadataGateway.execute(request('asset.metadata.set', {
      assetId: 'asset-1',
      expectedVersion: 1,
      description: '雨后',
      rating: 4,
      favorite: true,
    }))).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'asset.metadata.set',
      executionId: 'execution-1',
      result: {
        assetId: 'asset-1',
        description: '雨后',
        rating: 4,
        favorite: true,
        palette: null,
        automaticPalette: [],
        effectivePalette: [],
        paletteSource: null,
        sourcePageUrl: null,
        author: null,
        tags: [],
        entityVersion: 2,
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
    });
    expect(metadataWorker.commands).toEqual([{
      type: 'asset.metadata.set',
      libraryId: 'library-1',
      assetId: 'asset-1',
      expectedVersion: 1,
      description: '雨后',
      rating: 4,
      favorite: true,
    }]);

    const aiWorker = new RecordingWorker({
      ok: true,
      type: 'ai.jobs.enqueued',
      libraryId: 'library-1',
      enqueued: 2,
      jobIds: ['job-1', 'job-2'],
      alreadyPendingJobIds: ['job-pending'],
      skippedAssetIds: ['asset-missing'],
    });
    const aiGateway = gateway(aiWorker, {
      grantedCapabilities: [...allReadCapabilities, 'ai.enqueue'],
    });
    await expect(aiGateway.execute(request('ai.enqueue', {
      assetIds: ['asset-1', 'asset-2'],
      resumePaused: true,
    }))).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'ai.enqueue',
      executionId: 'execution-1',
      result: {
        enqueued: 2,
        jobIds: ['job-1', 'job-2'],
        alreadyPendingJobIds: ['job-pending'],
        skippedAssetIds: ['asset-missing'],
      },
    });
    expect(aiWorker.commands).toEqual([{
      type: 'ai.enqueue-analysis',
      libraryId: 'library-1',
      assetIds: ['asset-1', 'asset-2'],
      resumePaused: true,
    }]);
  });

  it('copies paths only through a Main-owned external-effect handler and never returns them to the caller', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'media.asset-paths',
      assetIds: ['asset-1', 'asset-2'],
      absolutePaths: ['/private/library/one.png', '/private/library/two.png'],
    });
    const copied: string[][] = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: ['library.read', 'asset.read', 'clipboard.write'],
    }), {
      externalEffectHandler: {
        apply: ({ commandId, workerResult }) => {
          expect(commandId).toBe('asset.paths.copy');
          expect(workerResult).toMatchObject({ type: 'media.asset-paths' });
          copied.push((workerResult as Extract<WorkerResult, { type: 'media.asset-paths' }>).absolutePaths);
        },
      },
    });

    await expect(commandGateway.execute(request('asset.paths.copy', {
      assetIds: ['asset-1', 'asset-2'],
    }))).resolves.toEqual({
      ok: true,
      apiVersion: 1,
      commandId: 'asset.paths.copy',
      executionId: 'execution-1',
      result: { copiedCount: 2 },
    });
    expect(worker.commands).toEqual([{
      type: 'media.get-asset-paths', libraryId: 'library-1', assetIds: ['asset-1', 'asset-2'],
    }]);
    expect(copied).toEqual([['/private/library/one.png', '/private/library/two.png']]);
  });

  it('requires a fresh approved file plan before dispatching a recoverable filesystem write', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.trashed',
      trashedCount: 2,
      operationId: 'operation-1',
    });
    const plan = {
      planHash: 'a'.repeat(64),
      expectedChangeSequence: 42,
      assetStates: [
        { assetId: 'asset-1', stateToken: 'b'.repeat(64) },
        { assetId: 'asset-2', stateToken: 'c'.repeat(64) },
      ],
    };
    const approvals: unknown[] = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: ['library.read', 'asset.read', 'trash.write'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async (input) => {
          approvals.push(input);
          return plan;
        },
      },
    });

    await expect(commandGateway.execute(request('asset.trash', {
      assetIds: ['asset-1', 'asset-2'],
    }))).resolves.toMatchObject({
      ok: true,
      result: { trashedCount: 2 },
    });
    expect(approvals).toEqual([{
      commandId: 'asset.trash',
      executionId: 'execution-1',
      libraryId: 'library-1',
      source: 'test',
      commandInput: { assetIds: ['asset-1', 'asset-2'] },
    }]);
    expect(worker.commands).toEqual([{
      type: 'asset.trash',
      libraryId: 'library-1',
      assetIds: ['asset-1', 'asset-2'],
      automationPlan: plan,
    }]);
  });

  it('requires a fresh approved file plan before dispatching asset.move', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.moved',
      movedCount: 1,
      skippedCount: 0,
      operationId: 'operation-move-1',
      assets: [],
    });
    const plan = {
      planHash: 'd'.repeat(64),
      expectedChangeSequence: 7,
      assetStates: [
        { assetId: 'asset-1', stateToken: 'e'.repeat(64) },
      ],
    };
    const approvals: unknown[] = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: ['library.read', 'asset.read', 'folder.read', 'file.move'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async (input) => {
          approvals.push(input);
          return plan;
        },
      },
    });

    await expect(commandGateway.execute(request('asset.move', {
      assetIds: ['asset-1'],
      targetFolderId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      conflictStrategy: 'keep-both',
    }))).resolves.toMatchObject({
      ok: true,
      result: { movedCount: 1, skippedCount: 0, operationId: 'operation-move-1' },
    });
    expect(approvals).toEqual([{
      commandId: 'asset.move',
      executionId: 'execution-1',
      libraryId: 'library-1',
      source: 'test',
      commandInput: {
        assetIds: ['asset-1'],
        targetFolderId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        conflictStrategy: 'keep-both',
      },
    }]);
    expect(worker.commands).toEqual([{
      type: 'asset.move',
      libraryId: 'library-1',
      assetIds: ['asset-1'],
      targetFolderId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      conflictStrategy: 'keep-both',
      automationPlan: plan,
    }]);
  });

  it('dispatches one approved plan for a batch content replacement', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.content.batch-replaced',
      operationId: 'operation-content-batch-1',
      items: [
        { assetId: 'asset-1', revisionId: 'revision-new-1', byteSize: 3 },
        { assetId: 'asset-2', revisionId: 'revision-new-2', byteSize: 4 },
      ],
    });
    const plan = {
      planHash: 'f'.repeat(64),
      expectedChangeSequence: 42,
      assetStates: [
        { assetId: 'asset-1', stateToken: 'a'.repeat(64) },
        { assetId: 'asset-2', stateToken: 'b'.repeat(64) },
      ],
    };
    const approvals: unknown[] = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: ['library.read', 'asset.read', 'content.write'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async (input) => {
          approvals.push(input);
          return plan;
        },
      },
    });

    await expect(commandGateway.execute(request('asset.content.replace-batch', {
      items: [
        { assetId: 'asset-1', dataBase64: 'AQID', expectedRevisionId: 'revision-1' },
        { assetId: 'asset-2', stagingToken: 'staging-2', expectedRevisionId: 'revision-2' },
      ],
    }))).resolves.toMatchObject({
      ok: true,
      result: { operationId: 'operation-content-batch-1' },
    });
    expect(approvals).toHaveLength(1);
    expect(worker.commands).toEqual([{
      type: 'asset.content.replace-batch',
      libraryId: 'library-1',
      items: [
        { assetId: 'asset-1', dataBase64: 'AQID', expectedRevisionId: 'revision-1' },
        { assetId: 'asset-2', stagingToken: 'staging-2', expectedRevisionId: 'revision-2' },
      ],
      automationPlan: plan,
    }]);
  });

  it('records a recovery reference in an undo group for a successful trash command', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.trashed',
      trashedCount: 1,
      operationId: 'operation-trash-1',
    });
    const undoEvents: unknown[] = [];
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: ['library.read', 'asset.read', 'trash.write'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => ({
          planHash: 'a'.repeat(64),
          expectedChangeSequence: 42,
          assetStates: [{ assetId: 'asset-1', stateToken: 'b'.repeat(64) }],
        }),
      },
      undoGroupHandler: {
        create: (input) => {
          undoEvents.push(['create', input]);
          return { undoGroupId: 'undo-group-1' };
        },
        append: (input) => undoEvents.push(['append', input]),
        complete: (input) => undoEvents.push(['complete', input]),
      },
    });

    await expect(commandGateway.execute(request('asset.trash', { assetIds: ['asset-1'] }))).resolves.toMatchObject({
      ok: true,
      undoGroupId: 'undo-group-1',
      result: { trashedCount: 1, operationId: 'operation-trash-1' },
    });
    expect(undoEvents).toEqual([
      ['create', { executionId: 'execution-1', libraryId: 'library-1' }],
      ['append', {
        undoGroupId: 'undo-group-1',
        item: {
          itemId: 'operation-trash-1',
          kind: 'asset.trash',
          reference: 'operation-trash-1',
          reversible: true,
        },
      }],
      ['complete', { undoGroupId: 'undo-group-1', status: 'succeeded' }],
    ]);
  });

  it('surfaces INTERNAL_ERROR when undo group finalization fails after a successful Worker write', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.trashed',
      trashedCount: 1,
      operationId: 'operation-trash-1',
    });
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: ['library.read', 'asset.read', 'trash.write'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => ({
          planHash: 'a'.repeat(64),
          expectedChangeSequence: 42,
          assetStates: [{ assetId: 'asset-1', stateToken: 'b'.repeat(64) }],
        }),
      },
      undoGroupHandler: {
        create: () => ({ undoGroupId: 'undo-group-1' }),
        append: () => {
          throw new Error('journal missing');
        },
        complete: () => undefined,
      },
    });

    await expect(commandGateway.execute(request('asset.trash', { assetIds: ['asset-1'] }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
  });

  it('rejects library.create without a binding handler as INTERNAL_ERROR', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.opened',
      library: {
        libraryId: 'library-new',
        displayName: 'New',
        libraryPath: '/libraries/new',
      },
    });
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      libraryId: null,
      grantedCapabilities: ['library.create'],
    }));

    await expect(commandGateway.execute(request('library.create', {
      displayName: 'New',
      selectedParentPath: '/tmp',
    }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(worker.commands).toEqual([]);
  });

  it('replays an idempotent library.create result without redispatching the Worker', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.opened',
      library: {
        libraryId: 'library-new',
        displayName: 'New',
        libraryPath: '/libraries/new',
      },
    });
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      libraryId: null,
      grantedCapabilities: ['library.create'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => ({
          planHash: 'a'.repeat(64),
          expectedChangeSequence: 0,
          assetStates: [{ assetId: 'library-create', stateToken: 'b'.repeat(64) }],
        }),
      },
      libraryBindingHandler: {
        bindLibrary: () => undefined,
      },
    });
    const firstRequest = request('library.create', {
      displayName: 'New',
      selectedParentPath: '/tmp',
    }, 'execution-1', 'create-key');

    const first = await commandGateway.execute(firstRequest);
    const second = await commandGateway.execute(firstRequest);

    expect(first).toEqual(second);
    expect(worker.commands).toHaveLength(1);
  });

  it('rejects an idempotency key reused with a different payload', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.opened',
      library: {
        libraryId: 'library-new',
        displayName: 'New',
        libraryPath: '/libraries/new',
      },
    });
    const commandGateway = createAutomationCommandGateway(worker, resolver({
      libraryId: null,
      grantedCapabilities: ['library.create'],
    }), {
      filePlanApprovalHandler: {
        prepareAndApprove: async () => ({
          planHash: 'a'.repeat(64),
          expectedChangeSequence: 0,
          assetStates: [{ assetId: 'library-create', stateToken: 'b'.repeat(64) }],
        }),
      },
      libraryBindingHandler: {
        bindLibrary: () => undefined,
      },
    });

    await commandGateway.execute(request('library.create', {
      displayName: 'New',
      selectedParentPath: '/tmp',
    }, 'execution-1', 'create-key'));
    await expect(commandGateway.execute(request('library.create', {
      displayName: 'Different',
      selectedParentPath: '/tmp',
    }, 'execution-1', 'create-key'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_INVALID_REQUEST' },
    });
    expect(worker.commands).toHaveLength(1);
  });

  it('does not dispatch a file write when no desktop plan approver is available or the plan is cancelled', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.trashed',
      trashedCount: 1,
      operationId: 'operation-1',
    });
    const noApprover = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: ['library.read', 'asset.read', 'trash.write'],
    }));
    await expect(noApprover.execute(request('asset.trash', { assetIds: ['asset-1'] }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });

    const cancelled = createAutomationCommandGateway(worker, resolver({
      grantedCapabilities: ['library.read', 'asset.read', 'trash.write'],
    }), {
      filePlanApprovalHandler: { prepareAndApprove: async () => undefined },
    });
    await expect(cancelled.execute(request('asset.trash', { assetIds: ['asset-1'] }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'CANCELLED' },
    });
    expect(worker.commands).toEqual([]);
  });

  it('does not let unavailable execution history turn a completed command into a failure', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'tag.list',
      tags: [{ tagId: 'tag-1', name: 'y2k', assetCount: 4 }],
    });
    const unavailableAudit: AutomationExecutionAuditSink = {
      recordCommandResult: () => {
        throw new Error('Journal disk is temporarily unavailable.');
      },
    };
    const diagnostics: Array<{ scope: string; context?: Record<string, unknown> }> = [];
    const auditLogger: AutomationGatewayAuditLogger = {
      error: (scope, _error, context) => diagnostics.push({ scope, context }),
    };
    const commandGateway = createAutomationCommandGateway(worker, resolver(), {
      auditSink: unavailableAudit,
      auditLogger,
    });

    await expect(commandGateway.execute(request('tag.list'))).resolves.toMatchObject({
      ok: true,
      result: { total: 1 },
    });
    expect(diagnostics).toEqual([{
      scope: 'automation.execution.audit-failed',
      context: {
        executionId: 'execution-1',
        commandId: 'tag.list',
        outcome: 'succeeded',
      },
    }]);
  });

  it('does not dispatch a command after the authoritative execution signal is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = createAutomationCommandGateway(worker, {
      resolve: () => ({
        executionId: 'execution-1',
        source: 'desktop-console',
        libraryId: 'library-1',
        grantedCapabilities: [...allReadCapabilities],
        abortSignal: controller.signal,
      }),
    });

    await expect(commandGateway.execute(request('tag.list'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_EXECUTION_CANCELLED' },
    });
    expect(worker.commands).toEqual([]);
  });

  it('propagates cancellation into an in-flight Worker request and reports a stable cancellation result', async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    let finishWorker: (() => void) | undefined;
    const worker: AutomationWorkerClient = {
      request: async (_command, options) => {
        receivedSignal = options?.signal;
        await new Promise<void>((resolve) => {
          finishWorker = resolve;
        });
        return { ok: true, type: 'tag.list', tags: [] };
      },
    };
    const commandGateway = createAutomationCommandGateway(worker, {
      resolve: () => ({
        executionId: 'execution-1',
        source: 'desktop-console',
        libraryId: 'library-1',
        grantedCapabilities: [...allReadCapabilities],
        abortSignal: controller.signal,
      }),
    });

    const requestInFlight = commandGateway.execute(request('tag.list'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort();
    finishWorker?.();

    await expect(requestInFlight).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_EXECUTION_CANCELLED' },
    });
    expect(receivedSignal).toBe(controller.signal);
  });

  it('enforces the execution concurrent command budget before dispatching excess work to the Worker', async () => {
    let releaseFirstWorkerRequest: (() => void) | undefined;
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    worker.request = async (command) => {
      worker.commands.push(command);
      await new Promise<void>((resolve) => {
        releaseFirstWorkerRequest = resolve;
      });
      return { ok: true, type: 'tag.list', tags: [] };
    };
    const commandGateway = createAutomationCommandGateway(worker, {
      resolve: () => ({
        executionId: 'execution-1',
        source: 'desktop-console',
        libraryId: 'library-1',
        grantedCapabilities: [...allReadCapabilities],
        resourceBudget: {
          maxWallTimeMs: 60_000,
          maxCpuTimeMs: 10_000,
          maxMemoryBytes: 64 * 1024 * 1024,
          maxOutputBytes: 1024 * 1024,
          maxConcurrentCommands: 1,
          maxPendingPromises: 128,
        },
      }),
    });

    const first = commandGateway.execute(request('tag.list'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await expect(commandGateway.execute(request('tag.list'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_CONCURRENCY_LIMIT_REACHED' },
    });
    expect(worker.commands).toHaveLength(1);

    releaseFirstWorkerRequest?.();
    await expect(first).resolves.toMatchObject({ ok: true, result: { total: 0 } });
  });

  it('keeps the command slot until asynchronous execution audit has completed', async () => {
    let releaseFirstAudit: (() => void) | undefined;
    let auditCalls = 0;
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = createAutomationCommandGateway(worker, {
      resolve: () => ({
        executionId: 'execution-1',
        source: 'desktop-console',
        libraryId: 'library-1',
        grantedCapabilities: [...allReadCapabilities],
        resourceBudget: {
          maxWallTimeMs: 60_000,
          maxCpuTimeMs: 10_000,
          maxMemoryBytes: 64 * 1024 * 1024,
          maxOutputBytes: 1024 * 1024,
          maxConcurrentCommands: 1,
          maxPendingPromises: 128,
        },
      }),
    }, {
      auditSink: {
        recordCommandResult: async () => {
          auditCalls++;
          if (auditCalls !== 1) return;
          await new Promise<void>((resolve) => {
            releaseFirstAudit = resolve;
          });
        },
      },
      auditLogger: { error: () => undefined },
    });

    const first = commandGateway.execute(request('tag.list'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await expect(commandGateway.execute(request('tag.list'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_CONCURRENCY_LIMIT_REACHED' },
    });
    expect(worker.commands).toHaveLength(1);

    releaseFirstAudit?.();
    await expect(first).resolves.toMatchObject({ ok: true, result: { total: 0 } });
  });

  it('gives Desktop Console, Script, and MCP the same registered result', async () => {
    const sources = ['desktop-console', 'script', 'mcp'] as const;
    const results = await Promise.all(sources.map(async (source) => {
      const commandGateway = createAutomationCommandGateway(new RecordingWorker({
        ok: true,
        type: 'tag.list',
        tags: [{ tagId: 'tag-1', name: 'retro', assetCount: 2 }],
      }), resolver({ source }));
      return commandGateway.execute(request('tag.list'));
    }));

    expect(results.map((result) => result.ok && result.result)).toEqual([
      {
        items: [{ tagId: 'tag-1', name: 'retro', assetCount: 2 }],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      },
      {
        items: [{ tagId: 'tag-1', name: 'retro', assetCount: 2 }],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      },
      {
        items: [{ tagId: 'tag-1', name: 'retro', assetCount: 2 }],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      },
    ]);
  });

  it('passes through stable PublicError results from the Worker unchanged', async () => {
    const worker = new RecordingWorker({
      ok: false,
      error: createPublicError('LIBRARY_NOT_OPEN'),
    });
    const commandGateway = gateway(worker);

    await expect(commandGateway.execute(request('asset.list'))).resolves.toEqual({
      ok: false,
      error: createPublicError('LIBRARY_NOT_OPEN'),
    });
  });

  it('fails closed before dispatch when authorization, API version, or command id is invalid', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = gateway(worker, { grantedCapabilities: ['library.read'] });

    await expect(commandGateway.execute(request('tag.list'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_CAPABILITY_DENIED' },
    });
    await expect(commandGateway.execute({ ...request('tag.list'), apiVersion: 2 })).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_API_VERSION_UNSUPPORTED' },
    });
    await expect(commandGateway.execute(request('tag.create'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_CAPABILITY_DENIED' },
    });
    await expect(commandGateway.execute(request('library.destroy'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_COMMAND_NOT_FOUND' },
    });
    expect(worker.commands).toEqual([]);
  });

  it('rejects a Worker response that does not match the registered command result', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = gateway(worker);

    await expect(commandGateway.execute(request('asset.list'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_RESULT_INVALID' },
    });
  });

  it('projects library.inspect to the one library explicitly bound by the execution', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.list',
      libraries: [
        { libraryId: 'library-other', displayName: 'Other', libraryPath: '/libraries/other' },
        { libraryId: 'library-1', displayName: 'Selected', libraryPath: '/libraries/selected' },
      ],
    });
    const commandGateway = gateway(worker);

    await expect(commandGateway.execute(request('library.inspect'))).resolves.toMatchObject({
      ok: true,
      result: { libraryId: 'library-1', displayName: 'Selected' },
    });
    const inspected = await commandGateway.execute(request('library.inspect'));
    expect(inspected.ok && inspected.result).toEqual({
      libraryId: 'library-1',
      displayName: 'Selected',
    });
  });

  it('reads library.change-sequence as a readonly Worker command for the bound library', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.change-sequence',
      libraryId: 'library-1',
      changeSequence: 3,
    });
    const commandGateway = gateway(worker);

    await expect(commandGateway.execute(request('library.change-sequence'))).resolves.toMatchObject({
      ok: true,
      result: { changeSequence: 3 },
    });
    expect(worker.commands).toEqual([{
      type: 'library.change-sequence',
      libraryId: 'library-1',
    }]);
  });

  it('rejects library.change-sequence before Worker dispatch when the execution is unbound', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.change-sequence',
      libraryId: 'library-1',
      changeSequence: 0,
    });
    const unboundResolver: AutomationExecutionResolver = {
      resolve: () => ({
        executionId: 'execution-1',
        source: 'test',
        libraryId: null,
        grantedCapabilities: [...allReadCapabilities],
      }),
    };
    const commandGateway = createAutomationCommandGateway(worker, unboundResolver);

    await expect(commandGateway.execute(request('library.change-sequence'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_LIBRARY_NOT_BOUND' },
    });
    expect(worker.commands).toEqual([]);
  });

  it('rejects a Worker response that does not match library.change-sequence', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'library.list',
      libraries: [],
    });
    const commandGateway = gateway(worker);

    await expect(commandGateway.execute(request('library.change-sequence'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_RESULT_INVALID' },
    });
  });

  it('uses only Main-owned execution state and rejects caller-supplied grants or library context', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = gateway(worker, {
      libraryId: 'main-owned-library',
    });

    await expect(commandGateway.execute({
      ...request('tag.list'),
      context: {
        source: 'mcp',
        libraryId: 'caller-selected-library',
        grantedCapabilities: [...allReadCapabilities],
      },
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_INVALID_REQUEST' },
    });
    await expect(commandGateway.execute(request('tag.list'))).resolves.toMatchObject({
      ok: true,
    });
    await expect(commandGateway.execute(request('tag.list', {}, 'unknown-execution'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_EXECUTION_NOT_FOUND' },
    });
    expect(worker.commands).toEqual([{ type: 'tag.list', libraryId: 'main-owned-library' }]);
  });

  it('cannot self-grant capabilities through an automation request payload', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = gateway(worker, { grantedCapabilities: ['library.read'] });

    await expect(commandGateway.execute(request('tag.list'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_CAPABILITY_DENIED' },
    });
    expect(worker.commands).toEqual([]);
  });

  it('enforces paged, bounded asset-list results at the Gateway boundary', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.list',
      assets: [asset('asset-1'), sequenceAsset('asset-2'), asset('asset-3')],
    });
    const commandGateway = gateway(worker);

    await expect(commandGateway.execute(request('asset.list', {
      recursive: true,
      limit: 1,
      offset: 1,
    }))).resolves.toMatchObject({
      ok: true,
      result: {
        items: [expect.objectContaining({ assetId: 'asset-2' })],
        total: 3,
        limit: 1,
        offset: 1,
        hasMore: true,
      },
    });
    expect(worker.commands).toEqual([{
      type: 'asset.list',
      libraryId: 'library-1',
      recursive: true,
    }]);
    await expect(commandGateway.execute(request('asset.list', {
      recursive: true,
      limit: AUTOMATION_MAX_PAGE_SIZE,
      offset: 0,
    }))).resolves.toMatchObject({
      ok: true,
      result: { limit: AUTOMATION_MAX_PAGE_SIZE, offset: 0 },
    });
    const projected = await commandGateway.execute(request('asset.list', {
      recursive: true,
      limit: 1,
      offset: 1,
    }));
    expect(projected).toMatchObject({
      ok: true,
      result: { items: [{ sequence: { sequenceId: 'sequence-asset-2', frameCount: 3 } }] },
    });
    expect(JSON.stringify(projected)).toContain('sequence-asset-2');
    expect(JSON.stringify(projected)).not.toContain('"frames"');
    await expect(commandGateway.execute(request('asset.list', {
      recursive: true,
      limit: AUTOMATION_MAX_PAGE_SIZE + 1,
    }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_INVALID_REQUEST' },
    });
  });

  it('accepts the 200-item folder page boundary but rejects 201', async () => {
    const commandGateway = gateway(new RecordingWorker({
      ok: true,
      type: 'folder.list',
      folders: [],
    }));

    await expect(commandGateway.execute(request('folder.list', {
      limit: AUTOMATION_MAX_PAGE_SIZE,
      offset: 0,
    }))).resolves.toMatchObject({
      ok: true,
      result: { items: [], total: 0, limit: AUTOMATION_MAX_PAGE_SIZE, offset: 0, hasMore: false },
    });
    await expect(commandGateway.execute(request('folder.list', {
      limit: AUTOMATION_MAX_PAGE_SIZE + 1,
    }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_INVALID_REQUEST' },
    });
  });

  it('forces search paging and rejects desktop scopeMode from the public automation API', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'asset.search.result',
      items: [asset('asset-3'), asset('asset-4')],
      total: 10,
      offset: 2,
    });
    const commandGateway = gateway(worker);

    await expect(commandGateway.execute(request('asset.search', {
      query: null,
      limit: 1,
      offset: 2,
    }))).resolves.toMatchObject({
      ok: true,
      result: {
        items: [expect.objectContaining({ assetId: 'asset-3' })],
        total: 10,
        offset: 2,
        limit: 1,
        hasMore: true,
      },
    });
    expect(worker.commands).toEqual([{
      type: 'asset.search',
      libraryId: 'library-1',
      query: null,
      scopeMode: false,
      limit: 1,
      offset: 2,
    }]);
    await expect(commandGateway.execute(request('asset.search', {
      query: null,
      scopeMode: true,
    }))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_INVALID_REQUEST' },
    });
  });

  it('returns execution.status from the Main journal without dispatching to the Worker', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = createAutomationCommandGateway(worker, resolver({ source: 'mcp' }), {
      executionStatusHandler: {
        getStatus: (executionId) => executionId === 'execution-1'
          ? {
              source: 'mcp',
              projection: {
                executionId: 'execution-1',
                status: 'running',
                commandCount: 2,
                succeededCommandCount: 1,
                failedCommandCount: 1,
                lastCommandId: 'asset.search',
                failureCode: 'AUTOMATION_COMMAND_FAILED',
                deadlineAt: '2026-07-31T12:30:00.000Z',
                createdAt: '2026-07-31T12:00:00.000Z',
                finishedAt: null,
                summary: { succeeded: 1, failed: 1 },
              },
            }
          : undefined,
      },
    });

    await expect(commandGateway.execute(request('execution.status', {}, 'execution-1'))).resolves.toMatchObject({
      ok: true,
      commandId: 'execution.status',
      result: {
        executionId: 'execution-1',
        status: 'running',
        commandCount: 2,
        succeededCommandCount: 1,
        failedCommandCount: 1,
        lastCommandId: 'asset.search',
        failureCode: 'AUTOMATION_COMMAND_FAILED',
        deadlineAt: '2026-07-31T12:30:00.000Z',
        createdAt: '2026-07-31T12:00:00.000Z',
        finishedAt: null,
        summary: { succeeded: 1, failed: 1 },
      },
    });
    expect(worker.commands).toHaveLength(0);
  });

  it('delivers ui.notify via Main handler without Worker and without a bound library', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const notified: unknown[] = [];
    const commandGateway = createAutomationCommandGateway(
      worker,
      resolver({
        libraryId: null,
        grantedCapabilities: ['ui.notify'],
      }),
      {
        uiNotifyHandler: {
          notify: (input) => {
            notified.push(input);
          },
        },
      },
    );

    await expect(commandGateway.execute(request('ui.notify', {
      severity: 'warning',
      message: 'Model download finished.',
      mode: 'toast',
    }))).resolves.toMatchObject({
      ok: true,
      commandId: 'ui.notify',
      result: { shown: true, mode: 'toast', severity: 'warning' },
    });
    expect(notified).toEqual([{
      severity: 'warning',
      message: 'Model download finished.',
      mode: 'toast',
    }]);
    expect(worker.commands).toHaveLength(0);
  });

  it('allows bounded ui.notify without write capability', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = createAutomationCommandGateway(
      worker,
      resolver({ grantedCapabilities: [...allReadCapabilities] }),
      {
        uiNotifyHandler: { notify: () => undefined },
      },
    );
    await expect(commandGateway.execute(request('ui.notify', {
      severity: 'info',
      message: 'hello',
    }))).resolves.toMatchObject({
      ok: true,
      commandId: 'ui.notify',
      result: { shown: true, mode: 'toast', severity: 'info' },
    });
  });

  it('rejects cross-session execution.status peek', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'tag.list', tags: [] });
    const commandGateway = createAutomationCommandGateway(worker, resolver({ source: 'mcp' }), {
      executionStatusHandler: {
        getStatus: () => ({
          source: 'mcp',
          projection: {
            executionId: 'execution-other',
            status: 'succeeded',
            commandCount: 0,
            succeededCommandCount: 0,
            failedCommandCount: 0,
            lastCommandId: null,
            failureCode: null,
            deadlineAt: '2026-07-31T12:30:00.000Z',
            createdAt: '2026-07-31T12:00:00.000Z',
            finishedAt: '2026-07-31T12:05:00.000Z',
            summary: null,
          },
        }),
      },
    });

    await expect(commandGateway.execute(request(
      'execution.status',
      { executionId: 'execution-other' },
      'execution-1',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTOMATION_EXECUTION_NOT_FOUND' },
    });
    expect(worker.commands).toHaveLength(0);
  });
});

describe('AutomationLibraryWorkerAdapter', () => {
  it('uses the fail-closed dispatch only for Gateway reads', async () => {
    const calls: Array<{ command: WorkerCommand; options: unknown }> = [];
    const adapter = new AutomationLibraryWorkerAdapter({
      request: async (command, options) => {
        calls.push({ command, options });
        return { ok: true, type: 'tag.list', tags: [] };
      },
    });

    await adapter.request({ type: 'tag.list', libraryId: 'library-1' }, { readonly: true });
    await adapter.request({ type: 'asset.rating.set', libraryId: 'library-1', assetIds: ['asset-1'], rating: 4 });
    expect(calls).toEqual([
      {
        command: { type: 'tag.list', libraryId: 'library-1' },
        options: { dispatch: 'automation-readonly' },
      },
      {
        command: { type: 'asset.rating.set', libraryId: 'library-1', assetIds: ['asset-1'], rating: 4 },
        options: undefined,
      },
    ]);
  });

  it('keeps the automation dispatch marker inside the validated Worker envelope', () => {
    expect(parseWorkerRequest({
      requestId: 'automation-read-1',
      dispatch: 'automation-readonly',
      command: { type: 'tag.list', libraryId: 'library-1' },
    })).toMatchObject({ dispatch: 'automation-readonly' });
  });

  it('stops awaiting a Worker result when its execution is cancelled', async () => {
    let resolveWorker: ((value: WorkerResult) => void) | undefined;
    const adapter = new AutomationLibraryWorkerAdapter({
      request: async () => new Promise<WorkerResult>((resolve) => {
        resolveWorker = resolve;
      }),
    });
    const controller = new AbortController();
    const pending = adapter.request(
      { type: 'tag.list', libraryId: 'library-1' },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toThrow('cancelled while awaiting Worker response');
    resolveWorker?.({ ok: true, type: 'tag.list', tags: [] });
  });
});
