import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import {
  describeCliCommands,
  type CliCommandId,
} from '../shared/cli-command-registry';
import { parseSearchExpression } from '../shared/search-expression';
import { resolveFolderReference } from '../shared/resource-reference';
import type { CliInvocation } from './argv';

export interface CliExecutionContext {
  version: string;
  request(command: WorkerCommand): Promise<WorkerResult>;
}

function expectSuccess(result: WorkerResult): Exclude<WorkerResult, { ok: false }> {
  if (!result.ok) throw Object.assign(new Error(result.error.message), result.error);
  return result;
}

async function withLibrary(
  libraryPath: string,
  context: CliExecutionContext,
  run: (libraryId: string, library: unknown) => Promise<unknown>,
): Promise<unknown> {
  const opened = expectSuccess(await context.request({
    type: 'library.open-readonly',
    selectedLibraryPath: libraryPath,
  }));
  if (opened.type !== 'library.opened') throw new Error('Unexpected library open result.');
  try {
    return await run(opened.library.libraryId, opened.library);
  } finally {
    await context.request({ type: 'library.close', libraryId: opened.library.libraryId });
  }
}

function libraryPath(input: CliInvocation['input']): string {
  if (!input.libraryPath) throw new Error('Library path is required.');
  return input.libraryPath;
}

export async function executeCliInvocation(
  invocation: CliInvocation,
  context: CliExecutionContext,
): Promise<unknown> {
  const input = invocation.input;
  switch (invocation.commandId) {
    case 'version':
      return { version: context.version };
    case 'commands':
      return describeCliCommands();
    case 'health':
      if (!input.libraryPath) return { status: 'ok', version: context.version };
      return withLibrary(input.libraryPath, context, async (_libraryId, library) => ({
        status: 'ok',
        version: context.version,
        library,
      }));
    case 'library.inspect':
      return withLibrary(libraryPath(input), context, async (_libraryId, library) => library);
    case 'folder.list':
      return withLibrary(libraryPath(input), context, async (libraryId) => {
        const managed = expectSuccess(await context.request({ type: 'folder.list', libraryId }));
        const linked = expectSuccess(await context.request({
          type: 'linked-folder.list',
          libraryId,
        }));
        if (managed.type !== 'folder.list' || linked.type !== 'linked-folder.list') {
          throw new Error('Unexpected folder list result.');
        }
        return { managed: managed.folders, linked: linked.folders };
      });
    case 'asset.list':
      return withLibrary(libraryPath(input), context, async (libraryId) => {
        let folderId: string | undefined;
        if (typeof input.folderRef === 'string') {
          const managed = expectSuccess(await context.request({
            type: 'folder.list',
            libraryId,
          }));
          const linked = expectSuccess(await context.request({
            type: 'linked-folder.list',
            libraryId,
          }));
          if (managed.type !== 'folder.list' || linked.type !== 'linked-folder.list') {
            throw new Error('Unexpected folder reference result.');
          }
          folderId = resolveFolderReference(
            input.folderRef,
            managed.folders,
            linked.folders,
          );
        }
        const result = expectSuccess(await context.request({
          type: 'asset.list',
          libraryId,
          recursive: input.recursive === true,
          ...(folderId ? { folderId } : {}),
        }));
        if (result.type !== 'asset.list') throw new Error('Unexpected asset list result.');
        return result.assets.filter((asset) => asset.deletedAt === null);
      });
    case 'tag.list':
      return withLibrary(libraryPath(input), context, async (libraryId) => {
        const result = expectSuccess(await context.request({ type: 'tag.list', libraryId }));
        if (result.type !== 'tag.list') throw new Error('Unexpected tag list result.');
        return result.tags;
      });
    case 'collection.list':
      return withLibrary(libraryPath(input), context, async (libraryId) => {
        const result = expectSuccess(await context.request({ type: 'collection.list', libraryId }));
        if (result.type !== 'collection.list') {
          throw new Error('Unexpected collection list result.');
        }
        return result.collections;
      });
    case 'smart-collection.list':
      return withLibrary(libraryPath(input), context, async (libraryId) => {
        const result = expectSuccess(await context.request({
          type: 'smart-collection.list',
          libraryId,
        }));
        if (result.type !== 'smart-collection.list') {
          throw new Error('Unexpected smart collection list result.');
        }
        return result.collections;
      });
    case 'search':
      return withLibrary(libraryPath(input), context, async (libraryId) => {
        const result = expectSuccess(await context.request({
          type: 'asset.search',
          libraryId,
          query: parseSearchExpression(String(input.query)),
          limit: Number(input.limit),
          offset: Number(input.offset),
        }));
        if (result.type !== 'asset.search.result') {
          throw new Error('Unexpected search result.');
        }
        return {
          items: result.items,
          total: result.total,
          offset: result.offset,
          snippets: result.snippets,
        };
      });
    case 'job.list':
      return withLibrary(libraryPath(input), context, async (libraryId) => {
        const kind = input.kind as 'all' | 'media' | 'ai';
        const results: Record<string, unknown> = {};
        if (kind !== 'ai') {
          const media = expectSuccess(await context.request({
            type: 'media.list-jobs',
            libraryId,
          }));
          if (media.type !== 'media.jobs.listed') {
            throw new Error('Unexpected media job result.');
          }
          results.media = media;
        }
        if (kind !== 'media') {
          const ai = expectSuccess(await context.request({ type: 'ai.status', libraryId }));
          if (ai.type !== 'ai.jobs.status') throw new Error('Unexpected AI job result.');
          results.ai = ai;
        }
        return kind === 'all' ? results : results[kind];
      });
    default:
      return assertNever(invocation.commandId);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled CLI command: ${String(value)}`);
}

export function humanOutput(commandId: CliCommandId, value: unknown): string {
  if (commandId === 'version' && typeof value === 'object' && value && 'version' in value) {
    return `Serpent CLI ${String(value.version)}`;
  }
  if (commandId === 'health' && typeof value === 'object' && value && 'status' in value) {
    return 'Serpent CLI 状态正常。';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '没有结果。';
    return value.map((item) => JSON.stringify(item)).join('\n');
  }
  return JSON.stringify(value, null, 2);
}
