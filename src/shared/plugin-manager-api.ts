import { z } from 'zod';

const pluginIdSchema = z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/u);
const versionSchema = z.string().min(1).max(128);
const libraryIdSchema = z.string().min(1).max(255);
const packageHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const githubRepositorySchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.split('/').filter(Boolean).length === 2;
}, 'Expected an HTTPS GitHub owner/repository URL.');
const scopeSchema = z.enum(['user', 'library']);

const scopedRequestFields = {
  scope: scopeSchema,
  libraryId: libraryIdSchema.optional(),
};

export const pluginManagerRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('plugin-manager.list'), libraryId: libraryIdSchema.optional() }),
  z.strictObject({ type: z.literal('plugin-manager.install-local'), ...scopedRequestFields }),
  z.strictObject({ type: z.literal('plugin-manager.install-github'), ...scopedRequestFields, repository: githubRepositorySchema }),
  z.strictObject({
    type: z.literal('plugin-manager.trust'),
    ...scopedRequestFields,
    pluginId: pluginIdSchema,
    packageHash: packageHashSchema,
    decision: z.enum(['trusted', 'denied']),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.resolve'),
    libraryId: libraryIdSchema,
    pluginId: pluginIdSchema,
    selection: z.enum(['use-global', 'use-library', 'disabled']),
    packageHash: packageHashSchema.optional(),
  }).superRefine((value, context) => {
    if (value.selection !== 'disabled' && value.packageHash === undefined) {
      context.addIssue({ code: 'custom', path: ['packageHash'], message: 'An enabled selection needs an exact package hash.' });
    }
  }),
  z.strictObject({ type: z.literal('plugin-manager.safe-mode'), enabled: z.boolean() }),
  z.strictObject({
    type: z.literal('plugin-manager.uninstall'),
    ...scopedRequestFields,
    pluginId: pluginIdSchema,
    version: versionSchema,
  }),
]);
export type PluginManagerRequest = z.infer<typeof pluginManagerRequestSchema>;

export type PluginManagerPackageSummary = {
  pluginId: string;
  version: string;
  name: string;
  description: string;
  runtimeMode: 'standard' | 'trusted';
  permissions: string[];
  sourceFingerprint: string;
  scope: 'user' | 'library';
  status: 'valid' | 'invalid';
  trust: 'trusted' | 'denied' | 'untrusted';
  errorCode?: string;
};

export type PluginManagerResolutionSummary =
  | { status: 'not-installed' | 'disabled' | 'conflict' }
  | {
    status: 'resolved' | 'awaiting-trust' | 'requires-confirmation';
    pluginId: string;
    version: string;
    selection?: 'use-global' | 'use-library';
    reason?: string;
  };

export type PluginManagerResponse =
  | {
    ok: true;
    packages: PluginManagerPackageSummary[];
    resolutions: PluginManagerResolutionSummary[];
    safeMode: boolean;
  }
  | { ok: false; code: 'invalid-request' | 'library-not-open' | 'selection-cancelled' | 'operation-failed' };
