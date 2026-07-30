import { describe, expect, it } from 'vitest';

import {
  automationCommandRegistry,
  AUTOMATION_MAX_PAGE_SIZE,
  type AutomationCapability,
  describeAutomationCommands,
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
): AutomationCommandEnvelope {
  return {
    apiVersion: 1,
    commandId,
    executionId,
    input,
  };
}

function resolver(overrides: Partial<{
  source: 'desktop-console' | 'script' | 'mcp' | 'test';
  libraryId: string;
  grantedCapabilities: readonly AutomationCapability[];
}> = {}): AutomationExecutionResolver {
  const context = {
    executionId: 'execution-1',
    source: overrides.source ?? 'test',
    libraryId: overrides.libraryId ?? 'library-1',
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
    expect(automationCommandRegistry).toHaveLength(30);
    expect(new Set(automationCommandRegistry.map((command) => command.commandId)).size)
      .toBe(automationCommandRegistry.length);
    const registryIds = new Set(automationCommandRegistry.map((command) => command.commandId));
    for (const commandId of automationScriptCommandIdSchema.options) {
      expect(registryIds).toContain(commandId);
    }
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
      } else if (['asset.trash', 'asset.rename-file', 'asset.rename-files', 'asset.restore-if-original-vacant'].includes(command.commandId)) {
        expect(command.impact).toBe('file-write');
        expect(command.approvalPolicy).toBe('plan');
        expect(command.mcp.public).toBe(false);
      } else {
        expect(command.impact).toBe('read');
        expect(command.approvalPolicy).toBe('none');
      }
      expect(command.requiredCapabilities.length).toBeGreaterThan(0);
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

    const declaration = generateAutomationTypeDeclaration('@serpent/test-api');
    expect(declaration).toContain('const serpent: SerpentAutomationApi');
    expect(declaration).toContain('interface SerpentScriptAssetSearchPage');
    expect(declaration).toContain('search(input: { query: string | null; limit?: number; offset?: number })');
    expect(declaration).toContain('setRating(assetIds: readonly string[]');
    expect(declaration).toContain('copyFilePaths(assetIds: readonly string[]');
    expect(declaration).toContain('renameFiles(items: readonly');
    expect(declaration).toContain('restoreIfOriginalVacant(assetIds: readonly string[]');
    expect(declaration).toContain('tags: {');
    expect(declaration).toContain('create(name: string): Promise<SerpentScriptTag>');
    expect(declaration).toContain('folders: {');
    expect(declaration).toContain('create(name: string, parentFolderId?: string | null)');
    expect(declaration).toContain('setMetadata(input: { assetId: string');
    expect(declaration).toContain('create(name: string, parentId?: string | null)');
    expect(declaration).toContain('addAssets(collectionId: string, assetIds: readonly string[])');
    expect(declaration).toContain('enqueue(input?: { assetIds?: readonly string[]');
    expect(declaration).not.toContain('zod');
    expect(declaration).not.toContain('cli');
  });
});

describe('Automation Command Gateway', () => {
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
    const worker = new RecordingWorker({ ok: true, type: 'asset.trashed', trashedCount: 2 });
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
      commandInput: { assetIds: ['asset-1', 'asset-2'] },
    }]);
    expect(worker.commands).toEqual([{
      type: 'asset.trash',
      libraryId: 'library-1',
      assetIds: ['asset-1', 'asset-2'],
      automationPlan: plan,
    }]);
  });

  it('does not dispatch a file write when no desktop plan approver is available or the plan is cancelled', async () => {
    const worker = new RecordingWorker({ ok: true, type: 'asset.trashed', trashedCount: 1 });
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
