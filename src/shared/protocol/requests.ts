import { z } from 'zod';

import { filterClauseSchema, searchQuerySchema, sortDefinitionSchema } from '../asset-types';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

const displayNameSchema = nonBlankString.max(255);
const identifierSchema = nonBlankString.max(255);
const selectedPathSchema = nonBlankString;
const optionalIdentifierSchema = identifierSchema.optional();
const optionalDescriptionSchema = nonBlankString.max(10000).optional();

export const suspectedDuplicateDecisionSchema = z.enum(['skip', 'merge', 'create-copy']);
export const nameConflictDecisionSchema = z.enum(['keep-both', 'replace', 'skip']);

export const rendererRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('library.create.request'),
    displayName: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('library.open.request'),
  }),
  z.strictObject({
    type: z.literal('library.close.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.list.request'),
  }),
  z.strictObject({
    type: z.literal('folder.create.request'),
    libraryId: identifierSchema,
    parentFolderId: optionalIdentifierSchema,
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('folder.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.list.request'),
    libraryId: identifierSchema,
    folderId: optionalIdentifierSchema,
    recursive: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.import-files.request'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.import-folder.request'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.import.resolve'),
    importId: identifierSchema,
    suspectedDuplicate: suspectedDuplicateDecisionSchema,
    nameConflict: nameConflictDecisionSchema,
  }),
  z.strictObject({
    type: z.literal('asset.import.abandon'),
    importId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.refresh.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.import-linked.request'),
    libraryId: identifierSchema,
    displayName: optionalIdentifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.relink.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('tag.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('tag.create.request'),
    libraryId: identifierSchema,
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('tag.rename.request'),
    libraryId: identifierSchema,
    tagId: identifierSchema,
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('tag.delete.request'),
    libraryId: identifierSchema,
    tagId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('tag.assign.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    tagIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('tag.remove.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    tagIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('collection.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('collection.create.request'),
    libraryId: identifierSchema,
    parentId: optionalIdentifierSchema,
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('collection.update.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    name: optionalIdentifierSchema,
    description: optionalIdentifierSchema,
    coverAssetId: optionalIdentifierSchema,
    position: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('collection.delete.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('collection.assets.add.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('collection.assets.remove.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('collection.assets.reorder.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    orderedAssetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('collection.assets.list.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    recursive: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.metadata.get.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.metadata.set.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    expectedVersion: z.number().int().min(1),
    label: optionalIdentifierSchema,
    description: optionalDescriptionSchema,
    rating: z.number().int().min(0).max(5).optional(),
    favorite: z.boolean().optional(),
    palette: z.array(nonBlankString).max(20).optional(),
    sourcePageUrl: optionalIdentifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.metadata.backfill.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.search.request'),
    libraryId: identifierSchema,
    query: searchQuerySchema,
    filters: z.array(filterClauseSchema).optional(),
    sort: sortDefinitionSchema.optional(),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('smart-collection.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('smart-collection.create.request'),
    libraryId: identifierSchema,
    name: displayNameSchema,
    queryDefinitionJson: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('smart-collection.update.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    name: optionalIdentifierSchema,
    queryDefinitionJson: optionalIdentifierSchema,
    position: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('smart-collection.delete.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('smart-collection.execute.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
  }),
]);

export type RendererRequest = z.infer<typeof rendererRequestSchema>;

export function parseRendererRequest(input: unknown): RendererRequest {
  return rendererRequestSchema.parse(input);
}

export const workerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('library.create'),
    displayName: displayNameSchema,
    selectedParentPath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('library.open'),
    selectedLibraryPath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('library.close'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.list'),
  }),
  z.strictObject({
    type: z.literal('folder.create'),
    libraryId: identifierSchema,
    parentFolderId: optionalIdentifierSchema,
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('folder.list'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.list'),
    libraryId: identifierSchema,
    folderId: optionalIdentifierSchema,
    recursive: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.import.prepare'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
    sourceKind: z.enum(['files', 'folder']),
    sourcePaths: z.array(selectedPathSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('asset.import.resolve'),
    importId: identifierSchema,
    suspectedDuplicate: suspectedDuplicateDecisionSchema,
    nameConflict: nameConflictDecisionSchema,
  }),
  z.strictObject({
    type: z.literal('asset.import.abandon'),
    importId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.refresh'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.import-linked'),
    libraryId: identifierSchema,
    displayName: optionalIdentifierSchema,
    sourceRootPath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.list'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.relink'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    newRootPath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('tag.list'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('tag.create'),
    libraryId: identifierSchema,
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('tag.rename'),
    libraryId: identifierSchema,
    tagId: identifierSchema,
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('tag.delete'),
    libraryId: identifierSchema,
    tagId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('tag.assign'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    tagIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('tag.remove'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    tagIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('collection.list'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('collection.create'),
    libraryId: identifierSchema,
    parentId: optionalIdentifierSchema,
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('collection.update'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    name: optionalIdentifierSchema,
    description: optionalIdentifierSchema,
    coverAssetId: optionalIdentifierSchema,
    position: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('collection.delete'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('collection.assets.add'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('collection.assets.remove'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('collection.assets.reorder'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    orderedAssetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('collection.assets.list'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    recursive: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.metadata.get'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.metadata.set'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    expectedVersion: z.number().int().min(1),
    label: optionalIdentifierSchema,
    description: optionalDescriptionSchema,
    rating: z.number().int().min(0).max(5).optional(),
    favorite: z.boolean().optional(),
    palette: z.array(nonBlankString).max(20).optional(),
    sourcePageUrl: optionalIdentifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.metadata.backfill'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.search'),
    libraryId: identifierSchema,
    query: searchQuerySchema,
    filters: z.array(filterClauseSchema).optional(),
    sort: sortDefinitionSchema.optional(),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('smart-collection.list'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('smart-collection.create'),
    libraryId: identifierSchema,
    name: displayNameSchema,
    queryDefinitionJson: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('smart-collection.update'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    name: optionalIdentifierSchema,
    queryDefinitionJson: optionalIdentifierSchema,
    position: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('smart-collection.delete'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('smart-collection.execute'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
  }),
]);

export type WorkerCommand = z.infer<typeof workerCommandSchema>;
export type SuspectedDuplicateDecision = z.infer<typeof suspectedDuplicateDecisionSchema>;
export type NameConflictDecision = z.infer<typeof nameConflictDecisionSchema>;

export const workerRequestSchema = z.strictObject({
  requestId: identifierSchema,
  command: workerCommandSchema,
});

export type WorkerRequest = z.infer<typeof workerRequestSchema>;

export function parseWorkerRequest(input: unknown): WorkerRequest {
  return workerRequestSchema.parse(input);
}
