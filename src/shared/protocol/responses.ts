import { z } from 'zod';

import { publicErrorSchema } from './errors';
import {
  WORKER_READY_MESSAGE_TYPE,
  WORKER_SHUTDOWN_ACK_MESSAGE_TYPE,
  WORKER_SHUTDOWN_MESSAGE_TYPE,
} from './channels';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

export const workerReadyMessageSchema = z.strictObject({
  type: z.literal(WORKER_READY_MESSAGE_TYPE),
});

export type WorkerReadyMessage = z.infer<typeof workerReadyMessageSchema>;

export function parseWorkerReadyMessage(input: unknown): WorkerReadyMessage {
  return workerReadyMessageSchema.parse(input);
}

export const workerControlMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(WORKER_SHUTDOWN_MESSAGE_TYPE) }),
  z.strictObject({ type: z.literal(WORKER_SHUTDOWN_ACK_MESSAGE_TYPE) }),
]);

export type WorkerControlMessage = z.infer<typeof workerControlMessageSchema>;

export function parseWorkerControlMessage(input: unknown): WorkerControlMessage {
  return workerControlMessageSchema.parse(input);
}

export const internalLibrarySummarySchema = z.strictObject({
  libraryId: nonBlankString,
  displayName: nonBlankString,
  libraryPath: nonBlankString,
});

export type InternalLibrarySummary = z.infer<typeof internalLibrarySummarySchema>;

export const rendererLibrarySummarySchema = z.strictObject({
  libraryId: nonBlankString,
  displayName: nonBlankString,
  displayPath: nonBlankString,
});

export type RendererLibrarySummary = z.infer<typeof rendererLibrarySummarySchema>;

const workerSuccessResultSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.list'),
    libraries: z.array(internalLibrarySummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.opened'),
    library: internalLibrarySummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.closed'),
    libraryId: nonBlankString,
  }),
]);

export const workerResultSchema = z.union([
  workerSuccessResultSchema,
  z.strictObject({
    ok: z.literal(false),
    error: publicErrorSchema,
  }),
]);

export type WorkerResult = z.infer<typeof workerResultSchema>;

export const workerResponseSchema = z.strictObject({
  requestId: nonBlankString,
  result: workerResultSchema,
});

export type WorkerResponse = z.infer<typeof workerResponseSchema>;

export function parseWorkerResponse(input: unknown): WorkerResponse {
  return workerResponseSchema.parse(input);
}

const rendererSuccessResultSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.list'),
    libraries: z.array(rendererLibrarySummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.opened'),
    library: rendererLibrarySummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.closed'),
    libraryId: nonBlankString,
  }),
]);

export const rendererResultSchema = z.union([
  rendererSuccessResultSchema,
  z.strictObject({
    ok: z.literal(false),
    error: publicErrorSchema,
  }),
]);

export type RendererResult = z.infer<typeof rendererResultSchema>;

export function parseRendererResult(input: unknown): RendererResult {
  return rendererResultSchema.parse(input);
}

export const rendererLifecycleEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('library.opening'),
    operation: z.enum(['create', 'open']),
  }),
  z.strictObject({
    type: z.literal('library.opened'),
    library: rendererLibrarySummarySchema,
  }),
  z.strictObject({
    type: z.literal('library.open-failed'),
    operation: z.enum(['create', 'open']),
    error: publicErrorSchema,
  }),
  z.strictObject({
    type: z.literal('library.closed'),
    libraryId: nonBlankString,
  }),
]);

export type RendererLifecycleEvent = z.infer<typeof rendererLifecycleEventSchema>;

export function parseRendererLifecycleEvent(input: unknown): RendererLifecycleEvent {
  return rendererLifecycleEventSchema.parse(input);
}
