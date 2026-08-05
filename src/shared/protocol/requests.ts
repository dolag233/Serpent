import { z } from 'zod';

import {
  filterClauseSchema,
  linkedFolderRuleSchema,
  portableRelativePathSchema,
  searchQuerySchema,
  searchScopeSchema,
  sortDefinitionSchema,
} from '../asset-types';
import {
  CONTENT_REPLACE_BATCH_INLINE_MAX_BASE64_LENGTH,
  CONTENT_REPLACE_BATCH_MAX_ITEMS,
  CONTENT_REPLACE_MAX_BYTES,
  CONTENT_REPLACE_MAX_BASE64_LENGTH,
  CONTENT_REPLACE_STAGE_CHUNK_MAX_BASE64_LENGTH,
} from '../content-replace';

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
// Author/creator (Serpent-7x0) mirrors sourcePageUrl's clear-with-empty-string
// contract, without the URL-shape constraint.
export const assetAuthorSchema = z.union([
  z.literal(''),
  nonBlankString.max(255).refine((value) => value === value.trim(), {
    message: 'Author must not include surrounding whitespace.',
  }),
]);

export const suspectedDuplicateDecisionSchema = z.enum(['skip', 'merge', 'create-copy']);
export const nameConflictDecisionSchema = z.enum(['keep-both', 'replace', 'skip']);

const automationFileOperationSchema = z.enum([
  'trash',
  'replace-content',
  'move',
  'rename-file',
  'rename-files',
  'restore-if-original-vacant',
]);
const automationFilePlanAssetStateSchema = z.strictObject({
  assetId: identifierSchema,
  stateToken: z.string().regex(/^[a-f0-9]{64}$/u),
});
const automationFilePlanProofSchema = z.strictObject({
  planHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedChangeSequence: z.number().int().nonnegative(),
  assetStates: z.array(automationFilePlanAssetStateSchema).min(1).max(10_000),
});
export const automationImportPlanProofSchema = z.strictObject({
  planHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedChangeSequence: z.number().int().nonnegative(),
  sourceStates: z.array(z.strictObject({
    sourcePath: selectedPathSchema,
    stateToken: z.string().regex(/^[a-f0-9]{64}$/u),
  })).max(1_000),
});


const aiApiFormatSchema = z.enum([
  'dashscope_native',
  'openai_chat',
  'openai_responses',
  'anthropic',
  'gemini_native',
]);
const aiLanguageIdSchema = z.enum(['zh-CN', 'en', 'ja', 'ko']);
const aiLanguagesSchema = z.array(aiLanguageIdSchema).min(1).max(8);
const aiEnabledFieldsSchema = z.strictObject({
  description: z.boolean(),
  tags: z.boolean(),
  rating: z.boolean(),
});
const aiAnalysisSettingsSchema = z.strictObject({
  forceExistingTags: z.boolean(),
  maxTags: z.number().int().min(1).max(32),
  maxDescriptionCharsZh: z.number().int().min(20).max(500),
  maxDescriptionWordsEn: z.number().int().min(10).max(200),
  outputStyle: z.enum(['normal', 'concise', 'rigorous']),
  ratingRubric: z.string().min(1).max(4_000),
  customDescriptionPrompt: z.string().max(4_000),
  customTagPrompt: z.string().max(4_000),
});
const aiConcurrencyLimitSchema = z.number().int().min(1).max(32);
const aiAnalysisImageEdgeSchema = z.number().int().min(512).max(4096);
const aiReliabilitySettingsSchema = z.strictObject({
  requestTimeoutMs: z.number().int().min(15_000).max(600_000),
  maxAttempts: z.number().int().min(1).max(10),
  retryBaseDelayMs: z.number().int().min(100).max(60_000),
  retryMaxDelayMs: z.number().int().min(1_000).max(600_000),
  retryJitterRatio: z.number().min(0).max(0.5),
});

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
    type: z.literal('library.rename.request'),
    libraryId: identifierSchema,
    displayName: displayNameSchema,
  }),
  // Irreversible: close then delete the library root on disk (Serpent-9i8).
  z.strictObject({
    type: z.literal('library.delete-from-disk.request'),
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
  // Soft-forget: drop from recent list only; disk untouched (Serpent-ucx).
  z.strictObject({
    type: z.literal('library.forget-recent.request'),
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
    type: z.literal('folder.open-with.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.copy-path.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  // Clarification #5 / Serpent-vgp: OS file clipboard (Finder/Explorer).
  z.strictObject({
    type: z.literal('folder.copy.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.paste.request'),
    libraryId: identifierSchema,
    /** Omit or null to paste into library Assets root. */
    folderId: optionalIdentifierSchema.nullable().optional(),
  }),
  z.strictObject({
    type: z.literal('folder.clone.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.move.request'),
    libraryId: identifierSchema,
    folderIds: z.array(identifierSchema).min(1).max(10_000),
    targetParentFolderId: identifierSchema.nullable(),
    conflictStrategy: z.enum(['keep-both', 'skip']).default('keep-both'),
  }),
  z.strictObject({
    type: z.literal('folder.list.request'),
    libraryId: identifierSchema,
    showIgnored: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('folder.browse-entries.request'),
    libraryId: identifierSchema,
    parentFolderId: identifierSchema.nullable(),
    showIgnored: z.boolean().optional(),
  }),
  // Clarification #7 / Serpent-ekj: managed folder trash / permanent disk delete.
  z.strictObject({
    type: z.literal('folder.trash.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.delete-from-disk.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.remove.request'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.delete-subtree.request'),
    libraryId: identifierSchema,
    linkedFolderId: identifierSchema,
    relativePath: portableRelativePathSchema,
    deleteFromDisk: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.list.request'),
    libraryId: identifierSchema,
    folderId: optionalIdentifierSchema,
    recursive: z.boolean(),
    showIgnored: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.sequence.create.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(3).max(10_000),
    fps: z.number().min(1).max(240),
  }),
  z.strictObject({
    type: z.literal('asset.sequence.dissolve.request'),
    libraryId: identifierSchema,
    sequenceId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.sequence.dissolve-batch.request'),
    libraryId: identifierSchema,
    sequenceIds: z.array(identifierSchema).min(1).max(10_000).refine(
      (sequenceIds) => new Set(sequenceIds).size === sequenceIds.length,
      { message: 'sequenceIds must not contain duplicates.' },
    ),
  }),
  z.strictObject({
    type: z.literal('asset.sequence.set-fps.request'),
    libraryId: identifierSchema,
    sequenceId: identifierSchema,
    fps: z.number().min(1).max(240),
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
    imageSequenceDecision: z
      .strictObject({
        action: z.enum(['import-sequence', 'import-selected']),
        firstFrame: z.number().int().nonnegative().optional(),
        fps: z.number().int().min(1).max(240).optional(),
        lastFrame: z.number().int().nonnegative().optional(),
        sequenceIndex: z.number().int().nonnegative().optional(),
        applyToRest: z.boolean().optional(),
      })
      .optional(),
  }),
  z.strictObject({
    type: z.literal('asset.import-drop-invalid.report'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.import-sequence.confirm'),
    libraryId: identifierSchema,
    offerId: identifierSchema,
    action: z.enum(['import-sequence', 'import-selected']),
    sequenceIndex: z.number().int().nonnegative().optional(),
    firstFrame: z.number().int().nonnegative().optional(),
    lastFrame: z.number().int().nonnegative().optional(),
    fps: z.number().int().min(1).max(240).optional(),
    applyToRest: z.boolean().optional(),
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
    type: z.literal('ignore.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('ignore.gitignore.get.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('ignore.gitignore.set.request'),
    libraryId: identifierSchema,
    content: z.string().max(1_000_000),
  }),
  z.strictObject({
    type: z.literal('ignore.set.request'),
    libraryId: identifierSchema,
    locationKind: z.enum(['managed', 'linked']),
    linkedFolderId: optionalIdentifierSchema,
    relativePath: z.string().max(4096),
    pathKind: z.enum(['asset', 'folder', 'extension']),
    ignored: z.boolean(),
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
    type: z.literal('tag.delete-many.request'),
    libraryId: identifierSchema,
    tagIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('tag.merge.request'),
    libraryId: identifierSchema,
    sourceTagIds: z.array(identifierSchema).min(2),
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('tag.cooccurrence.request'),
    libraryId: identifierSchema,
    minWeight: z.number().int().positive().optional(),
    maxNodes: z.number().int().positive().max(500).optional(),
    maxEdges: z.number().int().positive().max(2000).optional(),
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
    // CU-B4: direct memberships for selected assets (context-menu filtering).
    type: z.literal('collection.assets.memberships.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
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
    type: z.literal('asset.color-space.set.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    colorSpace: z.union([nonBlankString.max(120), z.null()]),
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
    author: assetAuthorSchema.optional(),
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
    /** When true, return the full browse scope (up to browse-scope cap); limit/offset ignored. */
    scopeMode: z.boolean().optional(),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
    showIgnored: z.boolean().optional(),
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
    scopeMode: z.boolean().optional(),
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
    type: z.literal('asset.restore-preview.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    targetFolderId: identifierSchema.nullable().optional(),
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
  z.strictObject({
    type: z.literal('asset.copy.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(10_000).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
    targetFolderId: identifierSchema.nullable(),
    conflictStrategy: nameConflictDecisionSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.copy-undo.request'),
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
    type: z.literal('asset.text.read.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    maxBytes: z.number().int().positive().max(2_097_152).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.text.save.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    content: z.string().max(1_048_576),
    expectedRevisionId: identifierSchema.optional(),
    /** When true, insert a new revision row (exit-from-editor commit). */
    createRevision: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.delete-permanent.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('asset.delete-from-disk.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
  }),
  z.strictObject({
    type: z.literal('trash.list.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('trash.list-folders.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('trash.restore-folder.request'),
    libraryId: identifierSchema,
    tombstoneId: identifierSchema,
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
    type: z.literal('asset.relink-batch.preview-at-root.request'),
    libraryId: identifierSchema,
    newRootPath: selectedPathSchema,
    keepMetadata: z.boolean(),
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
    apiFormat: aiApiFormatSchema,
    model: nonBlankString,
    /** Empty or omitted = official default endpoint for the API format. */
    baseUrl: z.string().max(2048).optional(),
    apiKey: nonBlankString.optional(),
    enabledFields: aiEnabledFieldsSchema.optional(),
    analysisSettings: aiAnalysisSettingsSchema.optional(),
    languages: aiLanguagesSchema.optional(),
    /** @deprecated Prefer languages[]. */
    language: nonBlankString.optional(),
    concurrencyLimit: aiConcurrencyLimitSchema.optional(),
    maxAnalysisImageEdgePx: aiAnalysisImageEdgeSchema.optional(),
    reliabilitySettings: aiReliabilitySettingsSchema.optional(),
    autoAnalyzeEnabled: z.boolean(),
    disclaimerAccepted: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('ai.content.get.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.analyze.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('assets.analyze.request'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(10_000),
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
    exrPlane: z.number().int().min(0).max(255).optional(),
    colorSpace: nonBlankString.max(120).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.close-preview.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  // Slice C (Serpent-qvc6): renderer request surface for the 3D viewer. The
  // Worker commands (model.resolve-companions / model.convert-fbx) already
  // exist; these entries let the preload bridge reach them.
  z.strictObject({
    type: z.literal('model.resolve-companions.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('model.convert-fbx.request'),
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
    type: z.literal('asset.open-with.request'),
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
  // Clarification #5 / Serpent-bkef: OS file clipboard for asset files.
  z.strictObject({
    type: z.literal('asset.copy-files.request'),
    libraryId: identifierSchema,
    assetIds: z
      .array(identifierSchema)
      .min(1)
      .max(10_000)
      .refine(
        (assetIds) => new Set(assetIds).size === assetIds.length,
        { message: 'assetIds must not contain duplicates.' },
      ),
  }),
  z.strictObject({
    type: z.literal('asset.retry-artifact.request'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    kind: z.enum(['thumbnail', 'webm_proxy', 'audio_proxy']),
  }),
  z.strictObject({
    type: z.literal('media.list-jobs.request'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('plugin.list-jobs.request'),
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
    apiFormat: aiApiFormatSchema,
    model: nonBlankString,
    /** Omit or blank to use the stored encrypted key. */
    apiKey: z.string().max(512).optional(),
    baseUrl: z.string().max(2048).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.list-models.request'),
    apiFormat: aiApiFormatSchema,
    /** Omit or blank to use the stored encrypted key. */
    apiKey: z.string().max(512).optional(),
    baseUrl: z.string().max(2048).optional(),
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
    /** When set, only these AI layers are cleared (Serpent-u7hz). Omit = all. */
    fields: z
      .array(z.enum(['description', 'rating', 'tags']))
      .min(1)
      .optional(),
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
    jobIds: z.array(identifierSchema).min(1).max(10_000).optional(),
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
    type: z.literal('library.rename'),
    libraryId: identifierSchema,
    displayName: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('library.delete-from-disk'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('library.list'),
  }),
  z.strictObject({
    type: z.literal('library.change-sequence'),
    libraryId: identifierSchema,
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
  z.strictObject({
    type: z.literal('folder.clone'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.move'),
    libraryId: identifierSchema,
    folderIds: z.array(identifierSchema).min(1).max(10_000),
    targetParentFolderId: identifierSchema.nullable(),
    conflictStrategy: z.enum(['keep-both', 'skip']).default('keep-both'),
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
    showIgnored: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('folder.browse-entries'),
    libraryId: identifierSchema,
    parentFolderId: identifierSchema.nullable(),
    showIgnored: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('folder.list-trashed'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.restore-trashed'),
    libraryId: identifierSchema,
    tombstoneId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.trash'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('folder.delete-from-disk'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.remove'),
    libraryId: identifierSchema,
    folderId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('linked-folder.delete-subtree'),
    libraryId: identifierSchema,
    linkedFolderId: identifierSchema,
    relativePath: portableRelativePathSchema,
    deleteFromDisk: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.list'),
    libraryId: identifierSchema,
    folderId: optionalIdentifierSchema,
    recursive: z.boolean(),
    showIgnored: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.sequence.create'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(3).max(10_000),
    fps: z.number().min(1).max(240),
  }),
  z.strictObject({
    type: z.literal('asset.sequence.dissolve'),
    libraryId: identifierSchema,
    sequenceId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.sequence.dissolve-batch'),
    libraryId: identifierSchema,
    sequenceIds: z.array(identifierSchema).min(1).max(10_000).refine(
      (sequenceIds) => new Set(sequenceIds).size === sequenceIds.length,
      { message: 'sequenceIds must not contain duplicates.' },
    ),
  }),
  z.strictObject({
    type: z.literal('asset.sequence.set-fps'),
    libraryId: identifierSchema,
    sequenceId: identifierSchema,
    fps: z.number().min(1).max(240),
  }),
  z.strictObject({
    type: z.literal('asset.import.probe-sequences'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
    targetCollectionId: optionalIdentifierSchema,
    sourcePaths: z.array(selectedPathSchema).min(1).max(1_000),
  }),
  z.strictObject({
    type: z.literal('asset.import.prepare'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
    sourceKind: z.enum(['files', 'folder']),
    sourcePaths: z.array(selectedPathSchema).min(1),
    imageSequenceFps: z.number().int().min(1).max(240).optional(),
    /** When true, expand single selected frames to continuous sibling runs. */
    expandImageSequences: z.boolean().optional(),
    /** Explicitly disable automatic sequence creation for a normal import. */
    createImageSequence: z.boolean().optional(),
    automationPlan: automationImportPlanProofSchema.optional(),
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
    type: z.literal('ignore.list'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('ignore.gitignore.get'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('ignore.gitignore.set'),
    libraryId: identifierSchema,
    content: z.string().max(1_000_000),
  }),
  z.strictObject({
    type: z.literal('ignore.set'),
    libraryId: identifierSchema,
    locationKind: z.enum(['managed', 'linked']),
    linkedFolderId: optionalIdentifierSchema,
    relativePath: z.string().max(4096),
    pathKind: z.enum(['asset', 'folder', 'extension']),
    ignored: z.boolean(),
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
    type: z.literal('tag.delete-many'),
    libraryId: identifierSchema,
    tagIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('tag.merge'),
    libraryId: identifierSchema,
    sourceTagIds: z.array(identifierSchema).min(2),
    name: displayNameSchema,
  }),
  z.strictObject({
    type: z.literal('tag.cooccurrence'),
    libraryId: identifierSchema,
    minWeight: z.number().int().positive().optional(),
    maxNodes: z.number().int().positive().max(500).optional(),
    maxEdges: z.number().int().positive().max(2000).optional(),
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
    type: z.literal('collection.assets.memberships'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
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
    type: z.literal('asset.color-space.set'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    colorSpace: z.union([nonBlankString.max(120), z.null()]),
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
    author: assetAuthorSchema.optional(),
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
    scopeMode: z.boolean().optional(),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
    showIgnored: z.boolean().optional(),
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
    scopeMode: z.boolean().optional(),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.trash'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    automationPlan: automationFilePlanProofSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.content.replace'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    dataBase64: z.string().min(1).max(CONTENT_REPLACE_MAX_BASE64_LENGTH),
    expectedRevisionId: identifierSchema.optional(),
    automationPlan: automationFilePlanProofSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.content.stage'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    stagingToken: identifierSchema.optional(),
    dataBase64: z.string().min(1).max(CONTENT_REPLACE_STAGE_CHUNK_MAX_BASE64_LENGTH),
    complete: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('asset.content.replace-batch'),
    libraryId: identifierSchema,
    items: z.array(z.union([
      z.strictObject({
        assetId: identifierSchema,
        dataBase64: z.string().min(1).max(CONTENT_REPLACE_BATCH_INLINE_MAX_BASE64_LENGTH),
        expectedRevisionId: identifierSchema,
      }),
      z.strictObject({
        assetId: identifierSchema,
        stagingToken: identifierSchema,
        expectedRevisionId: identifierSchema,
      }),
    ])).min(1).max(CONTENT_REPLACE_BATCH_MAX_ITEMS).refine(
      (items) => new Set(items.map((item) => item.assetId)).size === items.length,
      { message: 'items must not contain duplicate assetIds.' },
    ).refine(
      (items) => items.reduce((total, item) => total + ('dataBase64' in item ? item.dataBase64.length : 0), 0)
        <= CONTENT_REPLACE_BATCH_INLINE_MAX_BASE64_LENGTH,
      { message: 'Inline batch content exceeds the IPC payload budget; use staging tokens.' },
    ),
    automationPlan: automationFilePlanProofSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.content.read'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    maxBytes: z.number().int().positive().max(CONTENT_REPLACE_MAX_BYTES),
  }),
  z.strictObject({
    type: z.literal('asset.restore'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    targetFolderId: identifierSchema.nullable().optional(),
    conflictStrategy: z.enum(['keep-both', 'replace', 'skip']).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.restore-preview'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    targetFolderId: identifierSchema.nullable().optional(),
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
    automationPlan: automationFilePlanProofSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.move-undo'),
    libraryId: identifierSchema,
    operationId: identifierSchema,
    conflictStrategy: z.enum(['error', 'keep-both', 'replace', 'skip']).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.trash-undo'),
    libraryId: identifierSchema,
    operationId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.copy'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(10_000).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
    targetFolderId: identifierSchema.nullable(),
    conflictStrategy: nameConflictDecisionSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.copy-undo'),
    libraryId: identifierSchema,
    operationId: identifierSchema,
    conflictStrategy: z.enum(['error', 'keep-both', 'replace', 'skip']).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.rename-file'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    newBaseName: assetFileBaseNameSchema,
    automationPlan: automationFilePlanProofSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('asset.rename-files'),
    libraryId: identifierSchema,
    items: z.array(z.strictObject({
      assetId: identifierSchema,
      newBaseName: assetFileBaseNameSchema,
    })).min(1).max(10_000).refine(
      (items) => new Set(items.map((item) => item.assetId)).size === items.length,
      { message: 'items must not contain duplicate assetIds.' },
    ),
    automationPlan: automationFilePlanProofSchema.optional(),
  }),
  // Automation-only recovery operation: restore only assets whose original
  // managed folder still exists and whose original destination is vacant.
  // It intentionally has no target-folder or overwrite option.
  z.strictObject({
    type: z.literal('asset.restore-if-original-vacant'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).max(10_000).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
    automationPlan: automationFilePlanProofSchema.optional(),
  }),
  // Main-only preflight used by the Automation Gateway before a file write.
  // It returns opaque state tokens rather than paths and has no side effects.
  z.strictObject({
    type: z.literal('automation.file-operation-plan'),
    libraryId: identifierSchema,
    operation: automationFileOperationSchema,
    assetIds: z.array(identifierSchema).min(1).max(10_000).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
    newBaseName: assetFileBaseNameSchema.optional(),
    renameItems: z.array(z.strictObject({
      assetId: identifierSchema,
      newBaseName: assetFileBaseNameSchema,
    })).min(1).max(10_000).optional(),
    targetFolderId: identifierSchema.nullable().optional(),
    conflictStrategy: nameConflictDecisionSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('automation.file-import-plan'),
    libraryId: identifierSchema,
    sourceKind: z.enum(['files', 'folder']),
    sourcePaths: z.array(selectedPathSchema).min(1).max(1_000),
    targetFolderId: optionalIdentifierSchema,
    imageSequenceFps: z.number().int().min(1).max(240).optional(),
    expandImageSequences: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.palette.aggregate-recent'),
    libraryId: identifierSchema,
    days: z.number().int().min(1).max(3_650).default(2),
    limit: z.number().int().min(1).max(24).default(12),
  }),
  z.strictObject({
    type: z.literal('asset.text.read'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    maxBytes: z.number().int().positive().max(2_097_152).optional(),
  }),
  z.strictObject({
    type: z.literal('asset.text.save'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    content: z.string().max(1_048_576),
    expectedRevisionId: identifierSchema.optional(),
    createRevision: z.boolean().optional(),
  }),
  // Slice A (Serpent-fu2i): companion-texture index for model assets. The
  // Worker returns relative paths + asset ids for the model's directory
  // (recursive); only the renderer 3D loader consumes it. Read-only, no
  // absolute paths cross this boundary.
  z.strictObject({
    type: z.literal('model.resolve-companions'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('asset.delete-permanent'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
  }),
  z.strictObject({
    type: z.literal('asset.delete-from-disk'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).refine(
      (assetIds) => new Set(assetIds).size === assetIds.length,
      { message: 'assetIds must not contain duplicates.' },
    ),
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
    type: z.literal('extension.save-from-file'),
    libraryId: identifierSchema,
    targetFolderId: optionalIdentifierSchema,
    sourcePageUrl: httpUrlSchema.optional(),
    mediaUrl: httpUrlSchema.optional(),
    stagedFilePath: selectedPathSchema,
    contentType: z.string().min(1).max(128),
    filename: z.string().min(1).max(255),
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
    apiFormat: aiApiFormatSchema,
    model: nonBlankString,
    apiKey: nonBlankString,
    baseUrl: z.string().max(2048).optional(),
    enabledFields: aiEnabledFieldsSchema,
    analysisSettings: aiAnalysisSettingsSchema,
    languages: aiLanguagesSchema,
    maxAnalysisImageEdgePx: aiAnalysisImageEdgeSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('ai.content.get'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.generate-thumbnail'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('model.convert-fbx'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.retry-artifact'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
    kind: z.enum(['thumbnail', 'webm_proxy', 'audio_proxy']),
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
    type: z.literal('plugin.jobs.enqueue'),
    libraryId: identifierSchema,
    ownerPluginId: z.string().min(1).max(255),
    ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerPluginInstanceId: identifierSchema,
    ownerScope: z.enum(['library', 'global']),
    ownerLibraryId: identifierSchema,
    pluginHandlerId: z.string().min(1).max(128),
    payload: z.record(z.string(), z.unknown()).default({}),
    recoveryStrategy: z.enum(['idempotent', 'checkpoint']).default('idempotent'),
    priority: z.number().int().min(-1000).max(1000).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.list'),
    libraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.claim-next'),
    libraryId: identifierSchema,
    ownerPluginId: z.string().min(1).max(255),
    ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerPluginInstanceId: identifierSchema,
    ownerScope: z.enum(['library', 'global']),
    ownerLibraryId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.complete'),
    libraryId: identifierSchema,
    jobId: z.string().uuid(),
    ownerPluginId: z.string().min(1).max(255),
    ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerPluginInstanceId: identifierSchema,
    ownerScope: z.enum(['library', 'global']),
    ownerLibraryId: identifierSchema,
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    errorCode: z.string().min(1).max(128).optional(),
    errorDetail: z.string().max(4_096).optional(),
    progress: z.number().min(0).max(1).optional(),
    completed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    phase: z.string().max(128).optional(),
    message: z.string().max(1_024).optional(),
    itemResults: z.array(z.strictObject({
      itemId: identifierSchema,
      assetId: identifierSchema.optional(),
      status: z.enum(['succeeded', 'failed', 'cancelled', 'skipped']),
      errorCode: z.string().min(1).max(128).optional(),
      errorDetail: z.string().max(4_096).optional(),
      retryInput: z.record(z.string(), z.unknown()).optional(),
    })).max(100_000).optional(),
    failedAssetIds: z.array(identifierSchema).max(100_000).optional(),
    retryInput: z.record(z.string(), z.unknown()).optional(),
    checkpoint: z.strictObject({
      version: z.string().min(1).max(64),
      cursor: z.string().max(4_096).optional(),
      data: z.record(z.string(), z.unknown()).default({}),
      savedAt: z.string().datetime(),
    }).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.cancel'),
    libraryId: identifierSchema,
    jobId: z.string().uuid(),
    ownerPluginId: z.string().min(1).max(255),
    ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerPluginInstanceId: identifierSchema,
    ownerScope: z.enum(['library', 'global']),
    ownerLibraryId: identifierSchema,
    reason: z.string().max(1_024).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.pause'),
    libraryId: identifierSchema,
    jobId: z.string().uuid(),
    ownerPluginId: z.string().min(1).max(255),
    ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerPluginInstanceId: identifierSchema,
    ownerScope: z.enum(['library', 'global']),
    ownerLibraryId: identifierSchema,
    capabilities: z.strictObject({
      handlerId: identifierSchema,
      resumable: z.boolean(),
      checkpointVersion: identifierSchema.optional(),
    }),
    checkpoint: z.strictObject({
      version: identifierSchema,
      cursor: z.string().max(4_096).optional(),
      data: z.record(z.string(), z.unknown()).default({}),
      savedAt: z.string().datetime(),
    }),
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.resume'),
    libraryId: identifierSchema,
    jobId: z.string().uuid(),
    ownerPluginId: z.string().min(1).max(255),
    ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerPluginInstanceId: identifierSchema,
    ownerScope: z.enum(['library', 'global']),
    ownerLibraryId: identifierSchema,
    capabilities: z.strictObject({
      handlerId: identifierSchema,
      resumable: z.boolean(),
      checkpointVersion: identifierSchema.optional(),
    }),
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.retry'),
    libraryId: identifierSchema,
    jobId: z.string().uuid(),
    ownerPluginId: z.string().min(1).max(255),
    ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerPluginInstanceId: identifierSchema,
    ownerScope: z.enum(['library', 'global']),
    ownerLibraryId: identifierSchema,
    retryInput: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.report-progress'),
    libraryId: identifierSchema,
    jobId: z.string().uuid(),
    ownerPluginId: z.string().min(1).max(255),
    ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ownerPluginInstanceId: identifierSchema,
    ownerScope: z.enum(['library', 'global']),
    ownerLibraryId: identifierSchema,
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    phase: z.string().max(128),
    message: z.string().max(1_024),
    progress: z.number().min(0).max(1).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin.jobs.pause-owners'),
    libraryId: identifierSchema,
    owners: z.array(z.strictObject({
      pluginId: z.string().min(1).max(255),
      packageHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    })).min(1).max(256),
    errorCode: z.string().min(1).max(128).optional(),
    errorDetail: z.string().max(4_096).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin.derived-fields.materialize'),
    libraryId: identifierSchema,
    pluginId: identifierSchema,
    packageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    fieldId: z.string().min(1).max(128),
    fieldType: z.enum(['string', 'number', 'boolean', 'date', 'json']),
    values: z.array(z.strictObject({
      assetId: identifierSchema,
      value: z.union([z.string().max(16_384), z.number().finite(), z.boolean(), z.null()]),
    })).max(256),
  }),
  z.strictObject({
    type: z.literal('plugin.derived-fields.query'),
    libraryId: identifierSchema,
    pluginId: identifierSchema,
    packageHash: z.string().regex(/^[a-f0-9]{64}$/u),
    fieldId: z.string().min(1).max(128),
    operator: z.enum(['equals', 'contains', 'gt', 'gte', 'lt', 'lte']),
    value: z.union([z.string().max(16_384), z.number().finite(), z.boolean(), z.null()]),
    limit: z.number().int().positive().max(256).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('media.get-asset-path'),
    libraryId: identifierSchema,
    assetId: identifierSchema,
  }),
  z.strictObject({
    type: z.literal('media.get-asset-paths'),
    libraryId: identifierSchema,
    assetIds: z
      .array(identifierSchema)
      .min(1)
      .max(10_000)
      .refine(
        (assetIds) => new Set(assetIds).size === assetIds.length,
        { message: 'assetIds must not contain duplicates.' },
      ),
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
    exrPlane: z.number().int().min(0).max(255).optional(),
    colorSpace: nonBlankString.max(120).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.configure'),
    apiFormat: aiApiFormatSchema,
    encryptedApiKeyBase64: nonBlankString,
    model: nonBlankString,
    baseUrl: z.string().max(2048).optional(),
    descriptionEnabled: z.boolean().optional(),
    tagEnabled: z.boolean().optional(),
    ratingEnabled: z.boolean().optional(),
    analysisSettings: aiAnalysisSettingsSchema.optional(),
    languages: aiLanguagesSchema.optional(),
    language: nonBlankString.optional(),
    autoAnalyzeEnabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('ai.test-connection'),
    apiFormat: aiApiFormatSchema,
    /** Ephemeral plaintext key on the private Main→Worker channel (same as asset.analyze). */
    apiKey: nonBlankString,
    model: nonBlankString,
    baseUrl: z.string().max(2048).optional(),
  }),
  z.strictObject({
    type: z.literal('ai.enqueue-analysis'),
    libraryId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1).optional(),
    folderId: identifierSchema.optional(),
    /** Manual analysis may resume jobs intentionally paused by the user. */
    resumePaused: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('ai.process-queue'),
    libraryId: identifierSchema,
    apiFormat: aiApiFormatSchema,
    model: nonBlankString,
    apiKey: nonBlankString,
    baseUrl: z.string().max(2048).optional(),
    enabledFields: aiEnabledFieldsSchema,
    analysisSettings: aiAnalysisSettingsSchema,
    languages: aiLanguagesSchema,
    concurrencyLimit: aiConcurrencyLimitSchema,
    maxAnalysisImageEdgePx: aiAnalysisImageEdgeSchema.optional(),
    requestTimeoutMs: z.number().int().min(15_000).max(600_000),
    maxAttempts: z.number().int().min(1).max(10),
    maxJobs: z.number().int().min(1).max(100).default(20),
  }),
  z.strictObject({
    /** Applies the persisted global cap to a live Worker without restarting it. */
    type: z.literal('ai.set-concurrency-limit'),
    concurrencyLimit: aiConcurrencyLimitSchema,
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
    fields: z
      .array(z.enum(['description', 'rating', 'tags']))
      .min(1)
      .optional(),
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
    jobIds: z.array(identifierSchema).min(1).max(10_000).optional(),
  }),
]);

export type WorkerCommand = z.infer<typeof workerCommandSchema>;
export type SuspectedDuplicateDecision = z.infer<typeof suspectedDuplicateDecisionSchema>;
export type NameConflictDecision = z.infer<typeof nameConflictDecisionSchema>;

export const workerRequestSchema = z.strictObject({
  requestId: identifierSchema,
  command: workerCommandSchema,
  /**
   * Automation reads share the Worker protocol but must not inherit desktop
   * side effects such as thumbnail scheduling. Only Main-owned transports can
   * construct this envelope; Renderer requests remain on their existing path.
   */
  dispatch: z.enum(['automation-readonly']).optional(),
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

export type ActiveContextParseResult =
  | { ok: true; context: ActiveContext }
  | { ok: false; code: 'malformed'; issuePaths: string[] };

/**
 * safeParse 包装：失败时只暴露 issue path（不含用户/payload 值），供 Main 结构化日志。
 */
export function tryParseActiveContext(input: unknown): ActiveContextParseResult {
  const parsed = activeContextSchema.safeParse(input);
  if (parsed.success) return { ok: true, context: parsed.data };
  return {
    ok: false,
    code: 'malformed',
    issuePaths: parsed.error.issues.map((issue) =>
      issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.'),
    ),
  };
}
