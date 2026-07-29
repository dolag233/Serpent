import { z } from 'zod';

const pluginIdSchema = z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/u);
const versionSchema = z.string().min(1).max(128);
const libraryIdSchema = z.string().min(1).max(255);
const packageHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeSchema = z.enum(['user', 'library']);
const runtimeModeSchema = z.enum(['standard', 'trusted']);
const trustSchema = z.enum(['trusted', 'denied', 'untrusted']);

const githubRepositorySchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.split('/').filter(Boolean).length === 2;
}, 'Expected an HTTPS GitHub owner/repository URL.');

const scopedRequestFields = {
  scope: scopeSchema,
  libraryId: libraryIdSchema.optional(),
};

/**
 * Renderer-safe provenance. Local locations intentionally have no path field;
 * the Main process remains the only process which ever sees one.
 */
export const pluginManagerSourceSummarySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local-directory') }),
  z.strictObject({ kind: z.literal('local-package') }),
  z.strictObject({
    kind: z.literal('github'),
    repository: githubRepositorySchema,
    ref: z.string().min(1).max(255),
    commitSha: z.string().regex(/^[a-f0-9]{40,64}$/u),
  }),
]);
export type PluginManagerSourceSummary = z.infer<typeof pluginManagerSourceSummarySchema>;

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
    if (value.selection === 'disabled' && value.packageHash !== undefined) {
      context.addIssue({ code: 'custom', path: ['packageHash'], message: 'A disabled selection cannot include a package hash.' });
    }
  }),
  z.strictObject({ type: z.literal('plugin-manager.safe-mode'), enabled: z.boolean() }),
  z.strictObject({
    type: z.literal('plugin-manager.rollback'),
    libraryId: libraryIdSchema,
    pluginId: pluginIdSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-manager.uninstall'),
    ...scopedRequestFields,
    pluginId: pluginIdSchema,
    version: versionSchema,
  }),
]);
export type PluginManagerRequest = z.infer<typeof pluginManagerRequestSchema>;

export const pluginManagerPackageSummarySchema = z.strictObject({
  pluginId: pluginIdSchema,
  version: versionSchema,
  name: z.string().min(1).max(255),
  description: z.string().max(2_000),
  packageHash: packageHashSchema,
  runtimeMode: runtimeModeSchema,
  permissions: z.array(z.string().min(1).max(128)).max(64),
  source: pluginManagerSourceSummarySchema,
  scope: scopeSchema,
  status: z.enum(['valid', 'invalid']),
  trust: trustSchema,
  errorCode: z.string().min(1).max(128).optional(),
});
export type PluginManagerPackageSummary = z.infer<typeof pluginManagerPackageSummarySchema>;

export const pluginManagerResolutionCandidateSchema = z.strictObject({
  scope: scopeSchema,
  version: versionSchema,
  packageHash: packageHashSchema,
  runtimeMode: runtimeModeSchema,
  permissions: z.array(z.string().min(1).max(128)).max(64),
  source: pluginManagerSourceSummarySchema,
  trust: trustSchema,
});
export type PluginManagerResolutionCandidate = z.infer<typeof pluginManagerResolutionCandidateSchema>;

export const pluginManagerResolutionSummarySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not-installed'), pluginId: pluginIdSchema }),
  z.strictObject({
    status: z.literal('disabled'),
    pluginId: pluginIdSchema,
    reason: z.enum(['safe-mode', 'user-disabled']),
  }),
  z.strictObject({
    status: z.literal('conflict'),
    pluginId: pluginIdSchema,
    candidates: z.array(pluginManagerResolutionCandidateSchema).min(2).max(2),
  }),
  z.strictObject({
    status: z.literal('resolved'),
    pluginId: pluginIdSchema,
    version: versionSchema,
    packageHash: packageHashSchema,
    selection: z.enum(['use-global', 'use-library']),
  }),
  z.strictObject({
    status: z.literal('awaiting-trust'),
    pluginId: pluginIdSchema,
    version: versionSchema,
    packageHash: packageHashSchema,
    selection: z.literal('use-library'),
    reason: z.enum(['untrusted', 'denied']),
  }),
  z.strictObject({
    status: z.literal('requires-confirmation'),
    pluginId: pluginIdSchema,
    reason: z.enum(['selected-package-unavailable', 'permissions-increased', 'runtime-mode-changed', 'source-changed']),
    current: pluginManagerResolutionCandidateSchema,
    candidate: pluginManagerResolutionCandidateSchema.optional(),
  }),
]);
export type PluginManagerResolutionSummary = z.infer<typeof pluginManagerResolutionSummarySchema>;

export const pluginManagerResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    packages: z.array(pluginManagerPackageSummarySchema).max(20_000),
    resolutions: z.array(pluginManagerResolutionSummarySchema).max(20_000),
    safeMode: z.boolean(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['invalid-request', 'library-not-open', 'selection-cancelled', 'operation-failed']),
  }),
]);
export type PluginManagerResponse = z.infer<typeof pluginManagerResponseSchema>;

export function parsePluginManagerResponse(input: unknown): PluginManagerResponse {
  return pluginManagerResponseSchema.parse(input);
}

/** Narrow preload API; it intentionally has no filesystem or Electron access. */
export interface SerpentPluginManagerApi {
  request(input: PluginManagerRequest): Promise<PluginManagerResponse>;
}
