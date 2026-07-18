import { z } from 'zod';

import { filterClauseSchema, linkedFolderRuleSchema, searchQuerySchema, searchScopeSchema, sortDefinitionSchema } from '../asset-types';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

const displayNameSchema = nonBlankString.max(255);
const identifierSchema = nonBlankString.max(255);
// Schema layer rejects only obvious injection shapes (separators, control
// characters, dot segments, blank/overlong input). The portable-name semantics
// (reserved DOS names, trailing space/period, UTF-8 byte limit) are enforced
// by the Worker service layer.
const assetFileBaseNameSchema = nonBlankString.max(255)
  .refine((value) => !/[\\/]/u.test(value), {
    message: 'File base name must not contain path separators.',
  })
  .refine((value) => !/[\p{Cc}]/u.test(value), {
    message: 'File base name must not contain control characters.',
  })
  .refine((value) => value.trim() !== '.' && value.trim() !== '..', {
    message: "File base name must not be '.' or '..'.",
  });
const selectedPathSchema = nonBlankString;
const optionalIdentifierSchema = identifierSchema.optional();
const optionalClearableDescriptionSchema = z.string().max(10000).optional();
const queryDefinitionJsonSchema = nonBlankString.max(65_536);
export const manualPaletteColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/u, {
  message: 'Expected a six-digit hexadecimal color such as #A1B2C3.',
});
export const manualPaletteSchema = z.array(manualPaletteColorSchema).max(20);
const httpUrlSchema = nonBlankString.max(8_192).refine((value) => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, { message: 'Expected an HTTP(S) URL without embedded credentials.' });
export const sourcePageUrlSchema = z.union([
  z.literal(''),
  httpUrlSchema.refine((value) => value === value.trim(), {
    message: 'Source-page URLs must not include surrounding whitespace.',
  }),
]);

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
    type: z.literal('library.list-recent.request'),
  }),
  // The renderer may only name a library path that Main itself recorded in the
  // recent libraries store; Main re-validates membership before dispatching.
  z.strictObject({
    type: z.literal('library.open-recent.request'),
    libraryPath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('folder.create.request'),
    libraryId: identifierSchema,
    parentFolderId: optionalIdentifierSchema,
    name: displayNameSchema,
  }),
  // Renaming a managed folder is identified by folder id plus the new display
  // name only; no filesystem path may cross this boundary. The portable-name
  // semantics are enforced by the Worker service layer.
  z.strictObject({
    type: z.literal('folder.rename.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    newName: displayNameSchema,
  }),
  // Folder shell actions (REQ-MENU-006) are identified by folder id only; no
  // filesystem path may cross this boundary (REQ-COMMAND-003). The Worker
  // resolves the absolute path and Main performs the shell/clipboard action.
  z.strictObject({
    type: z.literal('folder.open-in-file-manager.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.copy-path.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
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
  // This request is created only inside the preload bridge after Electron's
  // webUtils has resolved genuine renderer File objects. Renderer code never
  // accepts or constructs these paths directly.
  z.strictObject({
    type: z.literal('asset.import-drop.request'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
    targetCollectionId: optionalIdentifierSchema,
    sourcePaths: z.array(selectedPathSchema).min(1).max(1_000),
  }),
  z.strictObject({
    type: z.literal('asset.import-drop-invalid.report'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.import-web.request'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
    targetCollectionId: optionalIdentifierSchema,
    mediaUrl: httpUrlSchema,
    mediaType: z.enum(['image', 'video']).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.import-web-invalid.report'),
    libraryId: identifierSchema,
    failure: z.enum(['WEB_MEDIA_NOT_FOUND', 'WEB_MEDIA_URL_INVALID', 'WEB_MEDIA_DROP_TOO_LARGE']),
  }),
  z.strictObject({
    type: z.literal('asset.import-clipboard.request'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
    targetCollectionId: optionalIdentifierSchema,
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
    type: z.literal('linked-folder.rules.get.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.rules.set.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    rules: z.array(linkedFolderRuleSchema).max(200),
  }),
  z.strictObject({
    type: z.literal('linked-folder.assets.copy.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(1_000).refine((ids) => new Set(ids).size === ids.length),
    conflictStrategy: nameConflictDecisionSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.convert.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
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
    description: nonBlankString.max(10_000).nullable().optional(),
    coverAssetId: identifierSchema.nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('collection.reorder.request'),
    libraryId: identifierSchema,
    orderedCollectionIds: z.array(identifierSchema).min(1).max(10_000),
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
    type: z.literal('asset.extracted-metadata.get.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.metadata.set.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    // A metadata row is created with expectedVersion 0, then increments on updates.
    expectedVersion: z.number().int().min(0),
    description: optionalClearableDescriptionSchema,
    rating: z.number().int().min(0).max(5).optional(),
    favorite: z.boolean().optional(),
    palette: manualPaletteSchema.optional(),
    sourcePageUrl: sourcePageUrlSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.metadata.backfill.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    // Batch rating write (REQ-MENU-007): last-write-wins across the whole
    // multi-selection, so no expectedVersion participates in this contract.
    type: z.literal('asset.rating.set.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    rating: z.number().int().min(0).max(5),
  }),
  z.strictObject({
    type: z.literal('asset.search.request'),
    libraryId: identifierSchema,
    query: searchQuerySchema,
    filters: z.array(filterClauseSchema).max(16).optional(),
    scope: searchScopeSchema.optional(),
    sort: sortDefinitionSchema.optional(),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('ai.search-plan.request'),
    naturalQuery: nonBlankString.max(2_000),
  }),
  z.strictObject({
    type: z.literal('smart-collection.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('smart-collection.create.request'),
    libraryId: identifierSchema,
    name: displayNameSchema,
    queryDefinitionJson: queryDefinitionJsonSchema,
  }),
  z.strictObject({
    type: z.literal('smart-collection.update.request'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    name: optionalIdentifierSchema,
    queryDefinitionJson: queryDefinitionJsonSchema.optional(),
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
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.trash.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('asset.restore.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    targetFolderId: identifierSchema.nullable().optional(),
    conflictStrategy: z.enum(['keep-both', 'replace', 'skip']).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.move.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(10_000).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
    targetFolderId: identifierSchema.nullable(),
    conflictStrategy: nameConflictDecisionSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.move-undo.request'),
    libraryId: identifierSchema,
    operationId: identifierSchema,
    conflictStrategy: z.enum(['error', 'keep-both', 'replace', 'skip']).optional(),
  }),
  // REQ-MENU-002 / REQ-COMMAND-003: rename one asset's real file by id and
  // extension-less base name only; no filesystem path may cross this boundary.
  z.strictObject({
    type: z.literal('asset.rename-file.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    newBaseName: assetFileBaseNameSchema,
  }),
  z.strictObject({
    type: z.literal('asset.delete-permanent.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('trash.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('trash.purge.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.delete-linked.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(20).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
    deleteSourceFile: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.relink.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.relink-batch.request'),
    libraryId: identifierSchema,
    keepMetadata: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.relink-batch.apply.request'),
    libraryId: identifierSchema,
    previewId: identifierSchema,
    keepMetadata: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.relink-batch.cancel.request'),
    libraryId: identifierSchema,
    previewId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.export.request'),
    libraryId: identifierSchema,
    format: z.enum(['folder', 'zip']),
    includeLinkedContent: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('library.export.cancel.request'),
    exportId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.import.request'),
  }),
  z.strictObject({
    type: z.literal('library.import-zip.request'),
  }),
  z.strictObject({
    type: z.literal('library.import.cancel.request'),
    importId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.import.copy.request'),
    importId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.import.open-in-place.request'),
    importId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('ai.config.get.request'),
  }),
  z.strictObject({
    type: z.literal('ai.config.set.request'),
    provider: z.enum(['openai', 'gemini', 'anthropic']),
    model: nonBlankString,
    apiKey: nonBlankString.optional(),
    enabledFields: z.strictObject({
      description: z.boolean(),
      tags: z.boolean(),
      structuredMetadata: z.boolean(),
    }).optional(),
    language: nonBlankString.optional(),
    autoAnalyzeEnabled: z.boolean(),
    disclaimerAccepted: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.analyze.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.thumbnail.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.preview.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    mode: z.enum(['client', 'fullscreen']),
  }),
  z.strictObject({
    type: z.literal('asset.close-preview.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.preview-error.report'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    errorCode: nonBlankString.max(120),
    detail: z.string().max(500).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.open-external.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.reveal-in-folder.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.copy-file-path.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.retry-artifact.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    kind: z.enum(['thumbnail', 'webm_proxy']),
  }),
  z.strictObject({
    type: z.literal('media.list-jobs.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.pause-jobs.request'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('media.resume-jobs.request'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('media.cancel-jobs.request'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('media.retry-jobs.request'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('ai.test-connection.request'),
    provider: z.enum(['openai', 'gemini', 'anthropic']),
    model: nonBlankString,
    apiKey: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('ai.clear-content.request'),
    libraryId: identifierSchema,
    scope: z.strictObject({
      kind: z.enum(['asset', 'selection', 'folder', 'library']),
      assetIds: z.array(identifierSchema).min(1).optional(),
      folderId: identifierSchema.optional(),
    }),
    confirm: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('ai.pause-jobs.request'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.resume-jobs.request'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.cancel-jobs.request'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.retry-jobs.request'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('ai.status.request'),
    libraryId: identifierSchema,
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
    type: z.literal('folder.rename'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    newName: displayNameSchema,
  }),
  // Resolves the absolute path of a managed or linked folder. Only Main may
  // consume the result (shell/clipboard); it never reaches the Renderer.
  z.strictObject({
    type: z.literal('folder.get-path'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
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
    type: z.literal('linked-folder.rules.get'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.rules.set'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    rules: z.array(linkedFolderRuleSchema).max(200),
  }),
  z.strictObject({
    type: z.literal('linked-folder.assets.copy'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(1_000),
    conflictStrategy: nameConflictDecisionSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.convert'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
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
    description: nonBlankString.max(10_000).nullable().optional(),
    coverAssetId: identifierSchema.nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('collection.reorder'),
    libraryId: identifierSchema,
    orderedCollectionIds: z.array(identifierSchema).min(1).max(10_000),
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
    type: z.literal('asset.extracted-metadata.get'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.metadata.set'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    // A metadata row is created with expectedVersion 0, then increments on updates.
    expectedVersion: z.number().int().min(0),
    description: optionalClearableDescriptionSchema,
    rating: z.number().int().min(0).max(5).optional(),
    favorite: z.boolean().optional(),
    palette: manualPaletteSchema.optional(),
    sourcePageUrl: sourcePageUrlSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.metadata.backfill'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    // Batch counterpart of the rating field on 'asset.metadata.set'. The
    // Worker validates the same 0–5 integer contract for direct clients.
    type: z.literal('asset.rating.set'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    rating: z.number().int().min(0).max(5),
  }),
  z.strictObject({
    type: z.literal('asset.search'),
    libraryId: identifierSchema,
    query: searchQuerySchema,
    filters: z.array(filterClauseSchema).max(16).optional(),
    scope: searchScopeSchema.optional(),
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
    queryDefinitionJson: queryDefinitionJsonSchema,
  }),
  z.strictObject({
    type: z.literal('smart-collection.update'),
    libraryId: identifierSchema,
    collectionId: identifierSchema,
    name: optionalIdentifierSchema,
    queryDefinitionJson: queryDefinitionJsonSchema.optional(),
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
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.trash'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('asset.restore'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    targetFolderId: identifierSchema.nullable().optional(),
    conflictStrategy: z.enum(['keep-both', 'replace', 'skip']).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.move'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(10_000).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
    targetFolderId: identifierSchema.nullable(),
    conflictStrategy: nameConflictDecisionSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.move-undo'),
    libraryId: identifierSchema,
    operationId: identifierSchema,
    conflictStrategy: z.enum(['error', 'keep-both', 'replace', 'skip']).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.rename-file'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    newBaseName: assetFileBaseNameSchema,
  }),
  z.strictObject({
    type: z.literal('asset.delete-permanent'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('asset.delete-linked'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(20).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
    deleteSourceFile: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.list-trash'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.purge-trash'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.relink'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    newAbsolutePath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('asset.relink-batch.preview'),
    libraryId: identifierSchema,
    newRootPath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('asset.relink-batch.apply'),
    libraryId: identifierSchema,
    newRootPath: selectedPathSchema,
    keepMetadata: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('extension.save-from-url'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
    sourcePageUrl: httpUrlSchema.optional(),
    mediaUrl: httpUrlSchema,
    mediaType: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('library.export'),
    libraryId: identifierSchema,
    destinationPath: selectedPathSchema,
    format: z.enum(['folder', 'zip']),
    includeLinkedContent: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('library.export-cancel'),
    exportId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.import-folder'),
    sourceFolderPath: selectedPathSchema,
    copyToParentPath: selectedPathSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('library.import-cancel'),
    importId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.import-validate'),
    importId: identifierSchema,
    sourceFolderPath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('library.import-zip'),
    sourceZipPath: selectedPathSchema,
    destinationParentPath: selectedPathSchema,
  }),
  z.strictObject({
    type: z.literal('asset.analyze'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    provider: z.enum(['openai', 'gemini', 'anthropic']),
    model: nonBlankString,
    apiKey: nonBlankString,
    enabledFields: z.strictObject({
      description: z.boolean(),
      tags: z.boolean(),
      structuredMetadata: z.boolean(),
    }),
    language: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('media.generate-thumbnail'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.retry-artifact'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    kind: z.enum(['thumbnail', 'webm_proxy']),
  }),
  z.strictObject({
    type: z.literal('media.get-artifact-path'),
    libraryId: identifierSchema,
    artifactId: identifierSchema,
    usage: z.enum(['preview', 'proxy']),
  }),
  z.strictObject({
    type: z.literal('media.get-source-path'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    revisionId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.enqueue-thumbnail-jobs'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.process-thumbnail-queue'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.list-jobs'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.pause-jobs'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('media.resume-jobs'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('media.cancel-jobs'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('media.retry-jobs'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('media.get-asset-path'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.get-thumbnail-artifact'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.get-preview-artifact'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('ai.configure'),
    provider: z.enum(['openai', 'gemini', 'anthropic']),
    encryptedApiKeyBase64: nonBlankString,
    model: nonBlankString,
    descriptionEnabled: z.boolean().optional(),
    tagEnabled: z.boolean().optional(),
    structuredMetadataEnabled: z.boolean().optional(),
    language: nonBlankString.optional(),
    autoAnalyzeEnabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('ai.test-connection'),
    provider: z.enum(['openai', 'gemini', 'anthropic']),
    encryptedApiKeyBase64: nonBlankString,
    model: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('ai.enqueue-analysis'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).optional(),
    folderId: identifierSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('ai.process-queue'),
    libraryId: identifierSchema,
    provider: z.enum(['openai', 'gemini', 'anthropic']),
    model: nonBlankString,
    apiKey: nonBlankString,
    enabledFields: z.strictObject({
      description: z.boolean(),
      tags: z.boolean(),
      structuredMetadata: z.boolean(),
    }),
    language: nonBlankString,
    maxJobs: z.number().int().min(1).max(100).default(20),
  }),
  z.strictObject({
    type: z.literal('ai.clear-content'),
    libraryId: identifierSchema,
    scope: z.strictObject({
      kind: z.enum(['asset', 'selection', 'folder', 'library']),
      assetIds: z.array(identifierSchema).min(1).optional(),
      folderId: identifierSchema.optional(),
    }),
    confirm: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('ai.pause-jobs'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.resume-jobs'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.cancel-jobs'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.retry-jobs'),
    libraryId: identifierSchema,
    jobIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('ai.status'),
    libraryId: identifierSchema,
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

export const activeContextSchema = z.strictObject({
  libraryId: z.string().nullable(),
  selectedFolderId: optionalIdentifierSchema,
});

export type ActiveContext = z.infer<typeof activeContextSchema>;

export function parseActiveContext(input: unknown): ActiveContext {
  return activeContextSchema.parse(input);
}
