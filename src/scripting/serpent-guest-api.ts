import type {
  AutomationScriptCommandId,
} from '../shared/automation-script-api';

export type SerpentGuestCommandDefinition = {
  readonly path: `${string}.${string}`;
  readonly commandId: AutomationScriptCommandId;
  readonly buildInput: (...args: unknown[]) => unknown;
  readonly projectResult?: (value: unknown) => unknown;
};

export type SerpentGuestApiAdapters = {
  executeCommand: (
    commandId: AutomationScriptCommandId,
    input: unknown,
    options?: { causeChain?: readonly string[] },
  ) => Promise<unknown>;
};

export type SerpentGuestApi = Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;

export function projectSerpentGuestAssetPageResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) {
    return value;
  }
  const page = value as {
    items: unknown[];
    total?: unknown;
    offset?: unknown;
    limit?: unknown;
    hasMore?: unknown;
  };
  return {
    items: page.items.map((item) => {
      if (!item || typeof item !== 'object' || typeof (item as { assetId?: unknown }).assetId !== 'string') {
        return item;
      }
      const asset = item as Record<string, unknown> & { assetId: string };
      return {
        id: asset.assetId,
        name: typeof asset.displayName === 'string' ? asset.displayName : asset.assetId,
        rating: typeof asset.rating === 'number' ? asset.rating : 0,
        favorite: asset.favorite === true,
        locationKind: asset.locationKind === 'linked' ? 'linked' : 'managed',
        folderId: typeof asset.managedFolderId === 'string' ? asset.managedFolderId : null,
      };
    }),
    total: typeof page.total === 'number' ? page.total : page.items.length,
    offset: typeof page.offset === 'number' ? page.offset : 0,
    limit: typeof page.limit === 'number' ? page.limit : page.items.length,
    hasMore: page.hasMore === true,
  };
}

export function projectSerpentGuestLibraryInspectResult(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const library = value as Record<string, unknown>;
  if (typeof library.libraryId !== 'string') return value;
  return {
    id: library.libraryId,
    displayName: typeof library.displayName === 'string' ? library.displayName : library.libraryId,
  };
}

const guestCommandDefinitions: readonly SerpentGuestCommandDefinition[] = [
  {
    path: 'assets.search',
    commandId: 'asset.search',
    buildInput: (input = {}) => input,
    projectResult: projectSerpentGuestAssetPageResult,
  },
  {
    path: 'assets.list',
    commandId: 'asset.list',
    buildInput: (input = {}) => input,
    projectResult: projectSerpentGuestAssetPageResult,
  },
  {
    path: 'assets.getMetadata',
    commandId: 'asset.metadata.get',
    buildInput: (assetId) => ({ assetId }),
  },
  {
    path: 'assets.getAiContent',
    commandId: 'asset.ai-content.get',
    buildInput: (assetId) => ({ assetId }),
  },
  {
    path: 'assets.setMetadata',
    commandId: 'asset.metadata.set',
    buildInput: (input) => input,
  },
  {
    path: 'assets.getExtractedMetadata',
    commandId: 'asset.extracted-metadata.get',
    buildInput: (assetId) => ({ assetId }),
  },
  {
    path: 'assets.setRating',
    commandId: 'asset.rating.set',
    buildInput: (assetIds, rating) => ({ assetIds, rating }),
  },
  {
    path: 'assets.copyFilePaths',
    commandId: 'asset.paths.copy',
    buildInput: (assetIds) => ({ assetIds }),
  },
  {
    path: 'assets.moveToTrash',
    commandId: 'asset.trash',
    buildInput: (assetIds) => ({ assetIds }),
  },
  {
    path: 'assets.replaceContent',
    commandId: 'asset.content.replace',
    buildInput: (assetId, dataBase64, options = {}) => ({
      assetId,
      dataBase64,
      ...((options && typeof options === 'object') ? options : {}),
    }),
  },
  {
    path: 'assets.readContent',
    commandId: 'asset.content.read',
    buildInput: (assetId, options = {}) => ({
      assetId,
      ...((options && typeof options === 'object') ? options : {}),
    }),
  },
  {
    path: 'assets.moveToFolder',
    commandId: 'asset.move',
    buildInput: (assetIds, targetFolderId, options = {}) => ({
      assetIds,
      targetFolderId,
      ...((options && typeof options === 'object') ? options : {}),
    }),
  },
  {
    path: 'assets.renameFile',
    commandId: 'asset.rename-file',
    buildInput: (assetId, newBaseName) => ({ assetId, newBaseName }),
  },
  {
    path: 'assets.renameFiles',
    commandId: 'asset.rename-files',
    buildInput: (items) => ({ items }),
  },
  {
    path: 'library.inspect',
    commandId: 'library.inspect',
    buildInput: () => ({}),
    projectResult: projectSerpentGuestLibraryInspectResult,
  },
  {
    path: 'library.changeSequence',
    commandId: 'library.change-sequence',
    buildInput: () => ({}),
  },
  {
    path: 'library.create',
    commandId: 'library.create',
    buildInput: (input) => input,
  },
];

export const SERPENT_GUEST_COMMANDS = guestCommandDefinitions;

export const SERPENT_GUEST_ASSET_METHODS = guestCommandDefinitions
  .filter(({ path }) => path.startsWith('assets.'))
  .map(({ path }) => path.slice('assets.'.length));

export const SERPENT_GUEST_LIBRARY_METHODS = guestCommandDefinitions
  .filter(({ path }) => path.startsWith('library.'))
  .map(({ path }) => path.slice('library.'.length));

function setNestedMethod(
  root: SerpentGuestApi,
  namespace: string,
  method: string,
  value: (...args: unknown[]) => Promise<unknown>,
): void {
  const target = root[namespace] ?? {};
  target[method] = value;
  root[namespace] = target;
}

export function createSerpentGuestApi(adapters: SerpentGuestApiAdapters): SerpentGuestApi {
  const api: SerpentGuestApi = {};
  for (const definition of guestCommandDefinitions) {
    const [namespace, method] = definition.path.split('.');
    if (namespace === undefined || method === undefined) {
      throw new Error(`Invalid Guest API command path: ${definition.path}`);
    }
    setNestedMethod(api, namespace, method, async (...args) => {
      const result = await adapters.executeCommand(
        definition.commandId,
        definition.buildInput(...args),
      );
      return definition.projectResult?.(result) ?? result;
    });
  }
  return api;
}
