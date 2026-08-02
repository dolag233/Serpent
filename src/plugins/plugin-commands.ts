import { z } from 'zod';

import { pluginLocalIdSchema } from './plugin-manifest';

export const PLUGIN_COMMAND_DEFAULT_TIMEOUT_MS = 5_000;
const NUL = String.fromCharCode(0);

/** Library ids are opaque identifiers, never filesystem paths. */
export const pluginTargetLibraryIdSchema = z.string()
  .min(1)
  .max(255)
  .refine((value) => value.trim() === value, 'Library id must not have surrounding whitespace.')
  .refine((value) => value !== '.' && value !== '..', 'Library id must not be a path segment.')
  .refine((value) => !value.includes(NUL) && !/[\\/]/u.test(value), 'Library id must not contain path separators.');
export type PluginTargetLibraryId = z.infer<typeof pluginTargetLibraryIdSchema>;

export const pluginCommandContextSchema = z.strictObject({
  targetLibraryId: pluginTargetLibraryIdSchema,
  assetIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
  folderIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
  collectionIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
});
export type PluginCommandContext = z.infer<typeof pluginCommandContextSchema>;

/**
 * Command context is a snapshot. Freeze both the target and all collection
 * fields so a handler cannot observe a different target after an await.
 */
export function freezePluginCommandContext(context: PluginCommandContext): PluginCommandContext {
  for (const key of ['assetIds', 'folderIds', 'collectionIds'] as const) {
    const values = context[key];
    if (values !== undefined) Object.freeze(values);
  }
  return Object.freeze(context);
}

export const pluginCommandInvokeSchema = z.strictObject({
  invokeId: z.string().uuid(),
  commandId: pluginLocalIdSchema,
  context: pluginCommandContextSchema,
});
export type PluginCommandInvoke = z.infer<typeof pluginCommandInvokeSchema>;

export const pluginCommandCompleteSchema = z.strictObject({
  invokeId: z.string().uuid(),
  status: z.enum(['succeeded', 'failed']),
  errorCode: z.string().min(1).max(128).optional(),
  errorDetail: z.string().max(4_096).optional(),
});
export type PluginCommandComplete = z.infer<typeof pluginCommandCompleteSchema>;

/**
 * Bounded Host → guest command invokes. Waiters receive null when an instance
 * is deactivated so the guest command loop can terminate cleanly.
 */
export function createPluginCommandInvokeQueue(options?: {
  maxBuffered?: number;
}): {
  push(invoke: PluginCommandInvoke): void;
  next(): Promise<PluginCommandInvoke | null>;
  close(): void;
} {
  const maxBuffered = options?.maxBuffered ?? 16;
  const buffered: PluginCommandInvoke[] = [];
  const waiters: Array<(value: PluginCommandInvoke | null) => void> = [];
  let closed = false;

  return {
    push(invoke): void {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter(invoke);
        return;
      }
      if (buffered.length >= maxBuffered) buffered.shift();
      buffered.push(invoke);
    },
    next(): Promise<PluginCommandInvoke | null> {
      if (closed) return Promise.resolve(null);
      const invoke = buffered.shift();
      if (invoke !== undefined) return Promise.resolve(invoke);
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      buffered.length = 0;
      while (waiters.length > 0) waiters.shift()?.(null);
    },
  };
}
