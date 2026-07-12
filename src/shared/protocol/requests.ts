import { z } from 'zod';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

const displayNameSchema = nonBlankString.max(255);
const identifierSchema = nonBlankString.max(255);
const selectedPathSchema = nonBlankString;

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
]);

export type WorkerCommand = z.infer<typeof workerCommandSchema>;

export const workerRequestSchema = z.strictObject({
  requestId: identifierSchema,
  command: workerCommandSchema,
});

export type WorkerRequest = z.infer<typeof workerRequestSchema>;

export function parseWorkerRequest(input: unknown): WorkerRequest {
  return workerRequestSchema.parse(input);
}
