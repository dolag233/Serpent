import { z } from 'zod';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

const displayNameSchema = nonBlankString.max(255);
const identifierSchema = nonBlankString.max(255);
const selectedPathSchema = nonBlankString;
const optionalIdentifierSchema = identifierSchema.optional();

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
