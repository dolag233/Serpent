import { z } from 'zod';

export const nativeDragReadinessEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    libraryId: z.string().min(1),
    assetIds: z.array(z.string().min(1)),
  }).strict(),
  z.object({
    type: z.literal('clear'),
    libraryId: z.string().min(1),
  }).strict(),
]);

export type NativeDragReadinessEvent = z.infer<typeof nativeDragReadinessEventSchema>;

export function parseNativeDragReadinessEvent(input: unknown): NativeDragReadinessEvent {
  return nativeDragReadinessEventSchema.parse(input);
}
