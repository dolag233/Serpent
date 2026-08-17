import { z } from 'zod';

export const pluginInstallOperationIdSchema = z.string().min(1).max(128);

export const pluginInstallProgressSchema = z.strictObject({
  operationId: pluginInstallOperationIdSchema,
  phase: z.enum(['resolving', 'downloading', 'installing']),
  state: z.enum(['running', 'paused', 'completed', 'failed', 'stopped']),
  bytesDownloaded: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().optional(),
  message: z.string().min(1).max(2_000).optional(),
});

export type PluginInstallProgress = z.infer<typeof pluginInstallProgressSchema>;

export const pluginInstallControlActionSchema = z.enum(['pause', 'resume', 'stop']);
export type PluginInstallControlAction = z.infer<typeof pluginInstallControlActionSchema>;
