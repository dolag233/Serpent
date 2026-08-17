import { z } from 'zod';

import type { HistoryRecipe } from './operation-history';

/**
 * A recipe pair is the durable contract between a forward mutation and its
 * inverse.  The service owns the actual handlers; this module owns the
 * registry and the integrity rules so a new command cannot silently claim to
 * be reversible without both directions being registered.
 */
export interface OperationHistoryRecipeDescriptor {
  readonly forwardKind: string;
  readonly inverseKind: string;
  readonly version: number;
}

const descriptorSchema = z.strictObject({
  forwardKind: z.string().min(1).max(120),
  inverseKind: z.string().min(1).max(120),
  version: z.number().int().positive(),
});

const descriptors: readonly OperationHistoryRecipeDescriptor[] = [
  { forwardKind: 'history-barrier', inverseKind: 'history-barrier', version: 1 },
  { forwardKind: 'managed-asset-move', inverseKind: 'managed-asset-move-undo', version: 1 },
  { forwardKind: 'managed-asset-copy', inverseKind: 'managed-asset-copy-undo', version: 1 },
  { forwardKind: 'asset-trash', inverseKind: 'asset-trash-undo', version: 1 },
  { forwardKind: 'asset-restore', inverseKind: 'asset-trash', version: 1 },
  { forwardKind: 'asset-rename', inverseKind: 'asset-rename', version: 1 },
  { forwardKind: 'asset-metadata-snapshot', inverseKind: 'asset-metadata-snapshot', version: 1 },
  { forwardKind: 'asset-metadata-batch-snapshot', inverseKind: 'asset-metadata-batch-snapshot', version: 1 },
  { forwardKind: 'tag-relations-add', inverseKind: 'tag-relations-remove', version: 1 },
  { forwardKind: 'tag-relations-remove', inverseKind: 'tag-relations-add', version: 1 },
  { forwardKind: 'collection-assets-add', inverseKind: 'collection-assets-remove', version: 1 },
  { forwardKind: 'collection-assets-remove', inverseKind: 'collection-assets-add', version: 1 },
  { forwardKind: 'collection-snapshot', inverseKind: 'collection-snapshot', version: 1 },
  { forwardKind: 'smart-collection-snapshot', inverseKind: 'smart-collection-snapshot', version: 1 },
  { forwardKind: 'managed-folder-snapshot', inverseKind: 'managed-folder-snapshot', version: 1 },
  { forwardKind: 'managed-folder-rename', inverseKind: 'managed-folder-rename', version: 1 },
  { forwardKind: 'managed-folder-move', inverseKind: 'managed-folder-move', version: 1 },
  { forwardKind: 'managed-folder-trash', inverseKind: 'managed-folder-restore', version: 1 },
  { forwardKind: 'managed-folder-restore', inverseKind: 'managed-folder-trash', version: 1 },
  { forwardKind: 'tag-snapshot', inverseKind: 'tag-snapshot', version: 1 },
];

export const operationHistoryRecipeRegistry = descriptors;

for (const descriptor of descriptors) descriptorSchema.parse(descriptor);

const identifierSchema = z.string().min(1).max(4096);
const conflictStrategySchema = z.enum(['keep-both', 'replace', 'skip']);
const relationSchema = z.strictObject({ assetId: identifierSchema, tagId: identifierSchema });
const metadataSnapshotSchema = z.strictObject({
  assetId: identifierSchema,
  description: z.string().nullable(),
  rating: z.number().int().min(0).max(5),
  favorite: z.boolean(),
  palette: z.string().nullable(),
  sourcePageUrl: z.string().nullable(),
  author: z.string().nullable(),
  entityVersion: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
});
const managedFolderSnapshotSchema = z.strictObject({
  folderId: identifierSchema,
  parentFolderId: identifierSchema.nullable(),
  name: z.string().min(1).max(255),
  relativePath: z.string().max(4096),
  pathIdentity: z.string().max(4096),
});
const collectionSnapshotSchema = z.strictObject({
  collectionId: identifierSchema,
  libraryId: identifierSchema,
  parentId: identifierSchema.nullable(),
  name: z.string().min(1).max(255),
  description: z.string().nullable(),
  coverAssetId: identifierSchema.nullable(),
  position: z.number().int().nonnegative(),
});
const collectionMembershipSnapshotSchema = z.strictObject({
  collectionId: identifierSchema,
  assetId: identifierSchema,
  position: z.number().int().nonnegative(),
});
const smartCollectionSnapshotSchema = z.strictObject({
  collectionId: identifierSchema,
  libraryId: identifierSchema,
  name: z.string().min(1).max(255),
  queryDefinitionJson: z.string().max(65_536),
  position: z.number().int().nonnegative(),
});
const tagSnapshotSchema = z.strictObject({
  tagId: identifierSchema,
  libraryId: identifierSchema,
  name: z.string().min(1).max(255),
  humanRelations: z.array(relationSchema),
});
const renameItemSchema = z.strictObject({
  assetId: identifierSchema,
  expectedBaseName: z.string().min(1).max(255).optional(),
  newBaseName: z.string().min(1).max(255),
});

const recipePayloadSchemas: ReadonlyMap<string, z.ZodType> = new Map<string, z.ZodType>([
  ['history-barrier', z.strictObject({ reason: z.string().min(1).max(255) })],
  ['managed-asset-move', z.strictObject({
    assetIds: z.array(identifierSchema).min(1),
    targetFolderId: identifierSchema.nullable(),
    conflictStrategy: conflictStrategySchema.optional(),
  })],
  ['managed-asset-move-undo', z.strictObject({ operationId: identifierSchema })],
  ['managed-asset-copy', z.strictObject({
    assetIds: z.array(identifierSchema).min(1),
    outputAssetIds: z.array(z.strictObject({
      sourceAssetId: identifierSchema,
      newAssetId: identifierSchema,
    })).min(1).optional(),
    targetFolderId: identifierSchema.nullable(),
    conflictStrategy: conflictStrategySchema.optional(),
  })],
  ['managed-asset-copy-undo', z.strictObject({ operationId: identifierSchema })],
  ['asset-trash', z.strictObject({ assetIds: z.array(identifierSchema).min(1) })],
  ['asset-trash-undo', z.strictObject({ operationId: identifierSchema })],
  ['asset-restore', z.strictObject({
    assetIds: z.array(identifierSchema).min(1),
    targetFolderId: identifierSchema.nullable().optional(),
    conflictStrategy: conflictStrategySchema.optional(),
  })],
  ['asset-rename', z.union([
    z.strictObject({
      assetId: identifierSchema,
      expectedBaseName: z.string().min(1).max(255).optional(),
      newBaseName: z.string().min(1).max(255),
    }),
    z.strictObject({ items: z.array(renameItemSchema).min(1) }),
  ])],
  ['asset-metadata-snapshot', z.strictObject({
    assetId: identifierSchema,
    expected: metadataSnapshotSchema,
    restore: metadataSnapshotSchema,
  })],
  ['asset-metadata-batch-snapshot', z.strictObject({
    expected: z.array(metadataSnapshotSchema).min(1),
    restore: z.array(metadataSnapshotSchema).min(1),
  })],
  ['tag-relations-add', z.strictObject({
    relations: z.array(relationSchema).min(1),
    expectedPresent: z.boolean().optional(),
  })],
  ['tag-relations-remove', z.strictObject({
    relations: z.array(relationSchema).min(1),
    expectedPresent: z.boolean().optional(),
  })],
  ['collection-assets-add', z.strictObject({
    collectionId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    expectedPresent: z.boolean().optional(),
  })],
  ['collection-assets-remove', z.strictObject({
    collectionId: identifierSchema,
    assetIds: z.array(identifierSchema).min(1),
    expectedPresent: z.boolean().optional(),
  })],
  ['collection-snapshot', z.strictObject({
    expected: z.array(collectionSnapshotSchema),
    restore: z.array(collectionSnapshotSchema),
    expectedMemberships: z.array(collectionMembershipSnapshotSchema),
    restoreMemberships: z.array(collectionMembershipSnapshotSchema),
  })],
  ['smart-collection-snapshot', z.strictObject({
    expected: z.array(smartCollectionSnapshotSchema),
    restore: z.array(smartCollectionSnapshotSchema),
  })],
  ['managed-folder-snapshot', z.strictObject({
    expected: z.array(managedFolderSnapshotSchema),
    restore: z.array(managedFolderSnapshotSchema),
  })],
  ['managed-folder-rename', z.strictObject({
    folderId: identifierSchema,
    expectedName: z.string().min(1).max(255).optional(),
    newName: z.string().min(1).max(255),
  })],
  ['managed-folder-move', z.strictObject({
    moves: z.array(z.strictObject({
      folderId: identifierSchema,
      expectedName: z.string().min(1).max(255).optional(),
      expectedParentFolderId: identifierSchema.nullable().optional(),
      targetParentFolderId: identifierSchema.nullable(),
      targetName: z.string().min(1).max(255),
    })).min(1),
  })],
  ['managed-folder-trash', z.strictObject({ folderId: identifierSchema })],
  ['managed-folder-restore', z.strictObject({ tombstoneId: identifierSchema })],
  ['tag-snapshot', z.strictObject({
    expected: z.array(tagSnapshotSchema),
    restore: z.array(tagSnapshotSchema),
  })],
] as Array<[string, z.ZodType]>);

export function historyRecipeDescriptor(kind: string): OperationHistoryRecipeDescriptor | undefined {
  return operationHistoryRecipeRegistry.find((descriptor) =>
    descriptor.forwardKind === kind || descriptor.inverseKind === kind,
  );
}

export function assertRegisteredHistoryRecipe(recipe: HistoryRecipe): void {
  const registered = operationHistoryRecipeRegistry.some((descriptor) =>
    (descriptor.forwardKind === recipe.kind || descriptor.inverseKind === recipe.kind)
    && descriptor.version === recipe.version,
  );
  if (!registered) {
    throw new Error(`History recipe ${recipe.kind}@${recipe.version} is not registered.`);
  }
  const payloadSchema = recipePayloadSchemas.get(recipe.kind);
  if (!payloadSchema) {
    throw new Error(`History recipe ${recipe.kind}@${recipe.version} has no payload schema.`);
  }
  payloadSchema.parse(recipe.payload);
}

export function assertRegisteredHistoryRecipePair(
  forward: HistoryRecipe,
  inverse: HistoryRecipe,
): void {
  assertRegisteredHistoryRecipe(forward);
  assertRegisteredHistoryRecipe(inverse);
  const isPair = operationHistoryRecipeRegistry.some((descriptor) =>
    descriptor.version === forward.version
    && descriptor.version === inverse.version
    && ((descriptor.forwardKind === forward.kind && descriptor.inverseKind === inverse.kind)
      || (descriptor.forwardKind === inverse.kind && descriptor.inverseKind === forward.kind)),
  );
  if (!isPair) {
    throw new Error(
      `History recipe pair ${forward.kind}@${forward.version} -> ${inverse.kind}@${inverse.version} is not registered.`,
    );
  }
}

/** Used by tests and startup diagnostics to ensure every registered kind has a service handler. */
export function registeredHistoryRecipeKinds(): readonly string[] {
  return [...new Set(operationHistoryRecipeRegistry.flatMap((descriptor) => [descriptor.forwardKind, descriptor.inverseKind]))].sort();
}
