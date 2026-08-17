import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import type { LibraryService } from './library-service';
import type { WorkerHistoryContext } from '../shared/protocol/requests';

/**
 * Commands whose complete mutation is transaction-only. They execute under a
 * SQLite `BEGIN IMMEDIATE` write transaction plus the durable per-library
 * lease. File-tree transfers and media/AI execution use persisted job phases
 * instead, so they never monopolize a database transaction while performing a
 * download, encode, or large copy.
 *
 * Phase D low-risk automation writes share this fence so Desktop, Script, and
 * MCP cannot bypass the write lease through a parallel dispatcher path.
 */
const BOUNDED_WRITE_COMMAND_TYPES = new Set<string>([
  'asset.rating.set',
  'asset.metadata.set',
  'asset.metadata.set-many',
  'tag.create',
  'tag.rename',
  'tag.delete',
  'tag.delete-many',
  'tag.merge',
  'tag.assign',
  'tag.remove',
  'folder.create',
  'collection.create',
  'collection.update',
  'collection.reorder',
  'collection.delete',
  'collection.assets.add',
  'collection.assets.remove',
  'collection.assets.reorder',
  'smart-collection.create',
  'smart-collection.update',
  'smart-collection.delete',
]);

export function boundedWriteLibraryId(command: WorkerCommand): string | undefined {
  if (!BOUNDED_WRITE_COMMAND_TYPES.has(command.type)) return undefined;
  if (!('libraryId' in command) || typeof command.libraryId !== 'string') {
    throw new Error(`Bounded write command ${command.type} is missing a library id.`);
  }
  return command.libraryId;
}

/**
 * Kept separate from the desktop switch so this narrow, transaction-safe
 * mutation surface cannot silently inherit thumbnail scheduling or a future
 * long-running behavior. New entries require an explicit atomicity review.
 */
export function executeBoundedWriteWorkerCommand(
  libraryService: LibraryService,
  command: WorkerCommand,
  historyContext?: WorkerHistoryContext,
): WorkerResult | undefined {
  switch (command.type) {
    case 'asset.rating.set': {
      const before = command.assetIds.flatMap((assetId) => {
        try {
          return [libraryService.getAssetMetadata({ libraryId: command.libraryId, assetId })];
        } catch {
          return [];
        }
      });
      const { updatedCount, skipped } = libraryService.setAssetsRating(command);
      const skippedIds = new Set(skipped.map((item) => item.assetId));
      const afterIds = command.assetIds.filter((assetId) => !skippedIds.has(assetId));
      const after = afterIds.map((assetId) =>
        libraryService.getAssetMetadata({ libraryId: command.libraryId, assetId }),
      );
      const beforeById = new Map(before.map((item) => [item.assetId, item]));
      const history = libraryService.recordAssetMetadataBatchHistory({
        libraryId: command.libraryId,
        before: after.map((item) => beforeById.get(item.assetId)!).filter(Boolean),
        after,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      });
      return {
        ok: true,
        type: 'asset.rating.updated',
        updatedCount,
        skipped,
        ...(history === null ? {} : { historyEntryId: history.historyEntryId }),
      };
    }
    case 'asset.metadata.set': {
      const before = libraryService.getAssetMetadata(command);
      const metadata = libraryService.setAssetMetadata(command);
      const history = libraryService.recordAssetMetadataHistory({
        libraryId: command.libraryId,
        before,
        after: metadata,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      });
      return { ok: true, type: 'asset.metadata.updated', metadata, historyEntryId: history.historyEntryId };
    }
    case 'asset.metadata.set-many': {
      const before = command.items.map((item) =>
        libraryService.getAssetMetadata({ libraryId: command.libraryId, assetId: item.assetId }),
      );
      const metadata = libraryService.setAssetsMetadata(command);
      const history = libraryService.recordAssetMetadataBatchHistory({
        libraryId: command.libraryId,
        before,
        after: metadata,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      });
      return {
        ok: true,
        type: 'asset.metadata.updated-many',
        metadata,
        ...(history === null ? {} : { historyEntryId: history.historyEntryId }),
      };
    }
    case 'tag.create': {
      const tag = libraryService.createTag(command);
      const historyEntryId = libraryService.recordTagSnapshotHistory({
        libraryId: command.libraryId,
        before: [],
        after: libraryService.getTagHistorySnapshot({ libraryId: command.libraryId, tagIds: [tag.tagId] }),
        commandId: command.type,
        labelKey: 'history.tag.create',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'tag.created', tag, historyEntryId };
    }
    case 'tag.rename': {
      const before = libraryService.getTagHistorySnapshot({ libraryId: command.libraryId, tagIds: [command.tagId] });
      const tag = libraryService.renameTag(command);
      const after = libraryService.getTagHistorySnapshot({ libraryId: command.libraryId, tagIds: [command.tagId] });
      const historyEntryId = libraryService.recordTagSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after,
        commandId: command.type,
        labelKey: 'history.tag.rename',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'tag.renamed', tag, historyEntryId };
    }
    case 'tag.delete': {
      const before = libraryService.getTagHistorySnapshot({ libraryId: command.libraryId, tagIds: [command.tagId] });
      const tagId = libraryService.deleteTag(command);
      const historyEntryId = libraryService.recordTagSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after: [],
        commandId: command.type,
        labelKey: 'history.tag.delete',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'tag.deleted', tagId, historyEntryId };
    }
    case 'tag.delete-many': {
      const before = libraryService.getTagHistorySnapshot({ libraryId: command.libraryId, tagIds: command.tagIds });
      const { deletedTagIds } = libraryService.deleteTags(command);
      const historyEntryId = deletedTagIds.length === 0 ? undefined : libraryService.recordTagSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after: [],
        commandId: command.type,
        labelKey: 'history.tag.delete-many',
        affectedCount: deletedTagIds.length,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'tag.deleted-many', deletedTagIds, ...(historyEntryId ? { historyEntryId } : {}) };
    }
    case 'tag.merge': {
      const before = libraryService.getTagHistorySnapshot({
        libraryId: command.libraryId,
        tagIds: command.sourceTagIds,
      });
      const tag = libraryService.mergeTags(command);
      const after = libraryService.getTagHistorySnapshot({
        libraryId: command.libraryId,
        tagIds: [tag.tagId],
      });
      const historyEntryId = libraryService.recordTagSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after,
        commandId: command.type,
        labelKey: 'history.tag.merge',
        affectedCount: command.sourceTagIds.length + 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return {
        ok: true,
        type: 'tag.merged',
        tag,
        mergedTagIds: command.sourceTagIds,
        historyEntryId,
      };
    }
    case 'tag.assign': {
      const before = libraryService.getHumanTagRelations(command);
      const { assignedCount, skipped } = libraryService.assignTags(command);
      const after = libraryService.getHumanTagRelations(command);
      const beforeKeys = new Set(before.map((item) => `${item.assetId}\u0000${item.tagId}`));
      const history = libraryService.recordTagRelationsHistory({
        libraryId: command.libraryId,
        assetIds: command.assetIds,
        changedRelations: after.filter((item) => !beforeKeys.has(`${item.assetId}\u0000${item.tagId}`)),
        direction: 'add',
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      });
      return { ok: true, type: 'tag.assigned', assignedCount, skipped, ...(history ? { historyEntryId: history.historyEntryId } : {}) };
    }
    case 'tag.remove': {
      const before = libraryService.getHumanTagRelations(command);
      const { removedCount, skipped } = libraryService.removeTags(command);
      const after = libraryService.getHumanTagRelations(command);
      const afterKeys = new Set(after.map((item) => `${item.assetId}\u0000${item.tagId}`));
      const history = libraryService.recordTagRelationsHistory({
        libraryId: command.libraryId,
        assetIds: command.assetIds,
        changedRelations: before.filter((item) => !afterKeys.has(`${item.assetId}\u0000${item.tagId}`)),
        direction: 'remove',
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      });
      return { ok: true, type: 'tag.removed', removedCount, skipped, ...(history ? { historyEntryId: history.historyEntryId } : {}) };
    }
    case 'folder.create': {
      const folder = libraryService.createManagedFolder(command);
      const historyEntryId = libraryService.recordManagedFolderSnapshotHistory({
        libraryId: command.libraryId,
        before: [],
        after: libraryService.getManagedFolderHistorySnapshot({ libraryId: command.libraryId, folderIds: [folder.folderId] }),
        commandId: command.type,
        labelKey: 'history.folder.create',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'folder.created', folder, historyEntryId };
    }
    case 'collection.create': {
      const collection = libraryService.createCollection(command);
      const after = libraryService.getCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [collection.collectionId] });
      const historyEntryId = libraryService.recordCollectionSnapshotHistory({
        libraryId: command.libraryId,
        before: [],
        after,
        beforeMemberships: [],
        afterMemberships: [],
        commandId: command.type,
        labelKey: 'history.collection.create',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'collection.created', collection, historyEntryId };
    }
    case 'collection.update': {
      const before = libraryService.getCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const beforeMemberships = libraryService.getCollectionMembershipHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const collection = libraryService.updateCollection(command);
      const after = libraryService.getCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const afterMemberships = libraryService.getCollectionMembershipHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const historyEntryId = libraryService.recordCollectionSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after,
        beforeMemberships,
        afterMemberships,
        commandId: command.type,
        labelKey: 'history.collection.update',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'collection.updated', collection, historyEntryId };
    }
    case 'collection.reorder': {
      const before = libraryService.getCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: command.orderedCollectionIds });
      const afterMemberships = libraryService.getCollectionMembershipHistorySnapshot({ libraryId: command.libraryId, collectionIds: command.orderedCollectionIds });
      const orderedCollectionIds = libraryService.reorderCollections(command);
      const after = libraryService.getCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: command.orderedCollectionIds });
      const historyEntryId = libraryService.recordCollectionSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after,
        beforeMemberships: afterMemberships,
        afterMemberships,
        commandId: command.type,
        labelKey: 'history.collection.reorder',
        affectedCount: orderedCollectionIds.length,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'collection.reordered', orderedCollectionIds, historyEntryId };
    }
    case 'collection.delete': {
      const before = libraryService.getCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const beforeMemberships = libraryService.getCollectionMembershipHistorySnapshot({ libraryId: command.libraryId, collectionIds: before.map((item) => item.collectionId) });
      const collectionId = libraryService.deleteCollection(command);
      const historyEntryId = libraryService.recordCollectionSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after: [],
        beforeMemberships,
        afterMemberships: [],
        commandId: command.type,
        labelKey: 'history.collection.delete',
        affectedCount: before.length,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'collection.deleted', collectionId, historyEntryId };
    }
    case 'collection.assets.add': {
      const before = libraryService.getCollectionAssetMemberships(command);
      const { collectionId } = libraryService.addCollectionAssets(command);
      const after = libraryService.getCollectionAssetMemberships(command);
      const beforeSet = new Set(before);
      const history = libraryService.recordCollectionMembershipHistory({
        libraryId: command.libraryId,
        collectionId,
        assetIds: after.filter((assetId) => !beforeSet.has(assetId)),
        direction: 'add',
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      });
      return { ok: true, type: 'collection.assets.added', collectionId, ...(history ? { historyEntryId: history.historyEntryId } : {}) };
    }
    case 'collection.assets.remove': {
      const before = libraryService.getCollectionAssetMemberships(command);
      const { collectionId } = libraryService.removeCollectionAssets(command);
      const after = libraryService.getCollectionAssetMemberships(command);
      const afterSet = new Set(after);
      const history = libraryService.recordCollectionMembershipHistory({
        libraryId: command.libraryId,
        collectionId,
        assetIds: before.filter((assetId) => !afterSet.has(assetId)),
        direction: 'remove',
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      });
      return { ok: true, type: 'collection.assets.removed', collectionId, ...(history ? { historyEntryId: history.historyEntryId } : {}) };
    }
    case 'collection.assets.reorder': {
      const beforeCollections = libraryService.getCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const before = libraryService.getCollectionMembershipHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const result = libraryService.reorderCollectionAssets(command);
      const after = libraryService.getCollectionMembershipHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const historyEntryId = libraryService.recordCollectionSnapshotHistory({
        libraryId: command.libraryId,
        before: beforeCollections,
        after: beforeCollections,
        beforeMemberships: before,
        afterMemberships: after,
        commandId: command.type,
        labelKey: 'history.collection.assets.reorder',
        affectedCount: after.length,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'collection.assets.reordered', ...result, historyEntryId };
    }
    case 'smart-collection.create': {
      const collection = libraryService.createSmartCollection(command);
      const historyEntryId = libraryService.recordSmartCollectionSnapshotHistory({
        libraryId: command.libraryId,
        before: [],
        after: libraryService.getSmartCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [collection.collectionId] }),
        commandId: command.type,
        labelKey: 'history.smart-collection.create',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'smart-collection.created', collection, historyEntryId };
    }
    case 'smart-collection.update': {
      const before = libraryService.getSmartCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const collection = libraryService.updateSmartCollection(command);
      const after = libraryService.getSmartCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const historyEntryId = libraryService.recordSmartCollectionSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after,
        commandId: command.type,
        labelKey: 'history.smart-collection.update',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'smart-collection.updated', collection, historyEntryId };
    }
    case 'smart-collection.delete': {
      const before = libraryService.getSmartCollectionHistorySnapshot({ libraryId: command.libraryId, collectionIds: [command.collectionId] });
      const collectionId = libraryService.deleteSmartCollection(command);
      const historyEntryId = libraryService.recordSmartCollectionSnapshotHistory({
        libraryId: command.libraryId,
        before,
        after: [],
        commandId: command.type,
        labelKey: 'history.smart-collection.delete',
        affectedCount: 1,
        source: historyContext?.source,
        sourceReference: historyContext?.sourceReference,
      }).historyEntryId;
      return { ok: true, type: 'smart-collection.deleted', collectionId, historyEntryId };
    }
    default:
      return undefined;
  }
}
