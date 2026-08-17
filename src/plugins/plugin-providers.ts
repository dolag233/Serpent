import { z } from 'zod';

import { pluginIdSchema, pluginLocalIdSchema } from './plugin-manifest';

export const pluginProviderKindSchema = z.enum([
  'preview',
  'thumbnail',
  'metadata',
  'import',
  'export',
  'ai',
  'derived-field',
  'search',
]);
export type PluginProviderKind = z.infer<typeof pluginProviderKindSchema>;

export const pluginProviderFieldTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'date',
  'json',
]);
export type PluginProviderFieldType = z.infer<typeof pluginProviderFieldTypeSchema>;

export const PLUGIN_PROVIDER_MAX_MEDIA_BYTES = 256 * 1024;
export const PLUGIN_PROVIDER_MAX_METADATA_JSON_BYTES = 16 * 1024;
export const PLUGIN_PROVIDER_MAX_IMPORT_PLAN_JSON_BYTES = 8 * 1024;
export const PLUGIN_PROVIDER_MAX_EXPORT_BYTES = 256 * 1024;
export const PLUGIN_PROVIDER_MAX_AI_DESCRIPTION_CHARS = 4_096;
export const PLUGIN_PROVIDER_MAX_AI_TAGS = 32;
const maxMediaBase64Length = Math.ceil(PLUGIN_PROVIDER_MAX_MEDIA_BYTES / 3) * 4;
const maxExportBase64Length = Math.ceil(PLUGIN_PROVIDER_MAX_EXPORT_BYTES / 3) * 4;

const forbiddenMetadataKeyPattern = /(?:^|\.)(?:path|filePath|secret|password|token|apiKey)$/iu;
const pathLikeMetadataValuePattern = /^(?:[A-Za-z]:\\|\/|\\\\|file:\/\/)/u;

export const pluginProviderMetadataValueSchema = z.union([
  z.string().max(4_096).refine(
    (value) => !pathLikeMetadataValuePattern.test(value),
    'Metadata string values must not look like filesystem paths.',
  ),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type PluginProviderMetadataValue = z.infer<typeof pluginProviderMetadataValueSchema>;

export const pluginProviderMetadataSchema = z.record(
  z.string().min(1).max(128).regex(
    /^[A-Za-z][A-Za-z0-9._-]*$/u,
    'Metadata keys must start with a letter and contain only letters, numbers, dots, hyphens, and underscores.',
  ),
  pluginProviderMetadataValueSchema,
).superRefine((record, context) => {
  for (const key of Object.keys(record)) {
    if (forbiddenMetadataKeyPattern.test(key)) {
      context.addIssue({
        code: 'custom',
        message: 'Metadata keys must not expose paths or secrets.',
      });
      return;
    }
  }
  if (JSON.stringify(record).length > PLUGIN_PROVIDER_MAX_METADATA_JSON_BYTES) {
    context.addIssue({
      code: 'custom',
      message: `Metadata JSON must be at most ${PLUGIN_PROVIDER_MAX_METADATA_JSON_BYTES} bytes when serialized.`,
    });
  }
});
export type PluginProviderMetadata = z.infer<typeof pluginProviderMetadataSchema>;

export const pluginProviderImportAssetStubSchema = z.strictObject({
  displayName: z.string().min(1).max(1_024).optional(),
  extension: z.string().max(32).optional(),
  metadata: pluginProviderMetadataSchema.optional(),
});
export type PluginProviderImportAssetStub = z.infer<typeof pluginProviderImportAssetStubSchema>;

export const pluginProviderImportPlanSchema = z.strictObject({
  accepted: z.boolean(),
  note: z.string().max(1_024).optional(),
  asset: pluginProviderImportAssetStubSchema.optional(),
}).superRefine((plan, context) => {
  if (JSON.stringify(plan).length > PLUGIN_PROVIDER_MAX_IMPORT_PLAN_JSON_BYTES) {
    context.addIssue({
      code: 'custom',
      message: `Import plan JSON must be at most ${PLUGIN_PROVIDER_MAX_IMPORT_PLAN_JSON_BYTES} bytes when serialized.`,
    });
  }
});
export type PluginProviderImportPlan = z.infer<typeof pluginProviderImportPlanSchema>;

export const pluginProviderExportDescriptorSchema = z.strictObject({
  fileName: z.string().min(1).max(1_024).optional(),
  mimeType: z.string().min(3).max(128).regex(
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u,
  ).optional(),
  bytesBase64: z.string()
    .min(4)
    .max(maxExportBase64Length)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
    .refine((value) => {
      const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
      return Math.floor(value.length * 3 / 4) - padding <= PLUGIN_PROVIDER_MAX_EXPORT_BYTES;
    }, `Export bytes must be at most ${PLUGIN_PROVIDER_MAX_EXPORT_BYTES} bytes when decoded.`)
    .optional(),
  note: z.string().max(1_024).optional(),
});
export type PluginProviderExportDescriptor = z.infer<typeof pluginProviderExportDescriptorSchema>;

export const pluginProviderAiAnalysisSchema = z.strictObject({
  description: z.string().max(PLUGIN_PROVIDER_MAX_AI_DESCRIPTION_CHARS).optional(),
  tags: z.array(z.string().min(1).max(128)).max(PLUGIN_PROVIDER_MAX_AI_TAGS),
  rating: z.number().int().min(1).max(5).optional(),
});
export type PluginProviderAiAnalysis = z.infer<typeof pluginProviderAiAnalysisSchema>;

export const pluginProviderFieldIdSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z][A-Za-z0-9._-]*$/u,
  'Provider field identifiers must start with a letter and contain only letters, numbers, dots, hyphens, and underscores.',
);

const providerValueSchema = z.union([
  z.string().max(16_384),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const pluginProviderMediaSchema = z.strictObject({
  mimeType: z.string().min(3).max(128).regex(
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u,
  ),
  bytesBase64: z.string()
    .min(4)
    .max(maxMediaBase64Length)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
    .refine((value) => {
      const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
      return Math.floor(value.length * 3 / 4) - padding <= PLUGIN_PROVIDER_MAX_MEDIA_BYTES;
    }, `Provider media must be at most ${PLUGIN_PROVIDER_MAX_MEDIA_BYTES} bytes when decoded.`),
});
export type PluginProviderMedia = z.infer<typeof pluginProviderMediaSchema>;

export const pluginProviderAssetSchema = z.strictObject({
  assetId: z.string().min(1).max(255),
  name: z.string().max(1_024),
  extension: z.string().max(32),
  relativeFilePath: z.string().max(4_096),
  revisionId: z.string().min(1).max(255).optional(),
});
export type PluginProviderAsset = z.infer<typeof pluginProviderAssetSchema>;

export const pluginProviderInvokeSchema = z.strictObject({
  invokeId: z.string().uuid(),
  providerId: pluginLocalIdSchema,
  kind: pluginProviderKindSchema,
  fieldId: pluginProviderFieldIdSchema.optional(),
  fieldType: pluginProviderFieldTypeSchema.optional(),
  batch: z.array(pluginProviderAssetSchema).max(256),
  deadlineAt: z.number().int().positive(),
  maxResults: z.number().int().positive().max(256),
});
export type PluginProviderInvoke = z.infer<typeof pluginProviderInvokeSchema>;

export const pluginProviderResultValueSchema = z.union([
  z.strictObject({
    assetId: z.string().min(1).max(255),
    value: providerValueSchema,
  }),
  z.strictObject({
    assetId: z.string().min(1).max(255),
    media: pluginProviderMediaSchema,
  }),
  z.strictObject({
    assetId: z.string().min(1).max(255),
    metadata: pluginProviderMetadataSchema,
  }),
  z.strictObject({
    assetId: z.string().min(1).max(255),
    importPlan: pluginProviderImportPlanSchema,
  }),
  z.strictObject({
    assetId: z.string().min(1).max(255),
    exportDescriptor: pluginProviderExportDescriptorSchema,
  }),
  z.strictObject({
    assetId: z.string().min(1).max(255),
    analysis: pluginProviderAiAnalysisSchema,
  }),
]);
export type PluginProviderResultValue = z.infer<typeof pluginProviderResultValueSchema>;

export const pluginProviderBatchResultSchema = z.strictObject({
  invokeId: z.string().uuid(),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  values: z.array(pluginProviderResultValueSchema).max(256).default([]),
  errorCode: z.string().min(1).max(128).optional(),
  errorDetail: z.string().max(4_096).optional(),
});
export type PluginProviderBatchResult = z.infer<typeof pluginProviderBatchResultSchema>;

export const pluginProviderRegistrationSchema = z.strictObject({
  pluginInstanceId: z.string().uuid(),
  libraryId: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  packageHash: z.string().regex(/^[a-f0-9]{64}$/u),
  providerId: pluginLocalIdSchema,
  kind: pluginProviderKindSchema,
  extensions: z.array(z.string().min(1).max(32).regex(
    /^\.?[A-Za-z0-9][A-Za-z0-9+_-]*$/u,
  )).max(64).optional(),
  mimeTypes: z.array(z.string().min(3).max(128).regex(
    /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u,
  )).max(64).optional(),
  fieldId: pluginProviderFieldIdSchema.optional(),
  fieldType: pluginProviderFieldTypeSchema.optional(),
});
export type PluginProviderRegistration = z.infer<typeof pluginProviderRegistrationSchema>;

export interface PluginProviderRegistry {
  register(value: PluginProviderRegistration): void;
  list(): readonly PluginProviderRegistration[];
  revokePluginInstance(pluginInstanceId: string): number;
}

export function createPluginProviderRegistry(): PluginProviderRegistry {
  const registrations = new Map<string, PluginProviderRegistration>();
  return {
    register(value) {
      const parsed = pluginProviderRegistrationSchema.parse(value);
      const key = `${parsed.pluginInstanceId}:${parsed.providerId}`;
      if (registrations.has(key)) {
        throw new Error(`Plugin provider ${parsed.pluginId}.${parsed.providerId} is already registered.`);
      }
      registrations.set(key, parsed);
    },
    list() {
      return [...registrations.values()].sort((left, right) =>
        `${left.pluginId}.${left.providerId}`.localeCompare(`${right.pluginId}.${right.providerId}`));
    },
    revokePluginInstance(pluginInstanceId) {
      let count = 0;
      for (const [key, value] of registrations) {
        if (value.pluginInstanceId !== pluginInstanceId) continue;
        registrations.delete(key);
        count += 1;
      }
      return count;
    },
  };
}

export function namespacedDerivedFieldId(pluginId: string, fieldId: string): string {
  return `${pluginIdSchema.parse(pluginId)}.${pluginProviderFieldIdSchema.parse(fieldId)}`;
}

export function createPluginProviderInvokeQueue(options?: {
  maxBuffered?: number;
}): {
  push(value: PluginProviderInvoke): void;
  next(): Promise<PluginProviderInvoke | null>;
  close(): void;
} {
  const maxBuffered = options?.maxBuffered ?? 16;
  const buffered: PluginProviderInvoke[] = [];
  const waiters: Array<(value: PluginProviderInvoke | null) => void> = [];
  let closed = false;
  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter(value);
        return;
      }
      if (buffered.length >= maxBuffered) buffered.shift();
      buffered.push(value);
    },
    next() {
      if (closed) return Promise.resolve(null);
      const value = buffered.shift();
      if (value !== undefined) return Promise.resolve(value);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      if (closed) return;
      closed = true;
      buffered.length = 0;
      for (const resolve of waiters.splice(0)) resolve(null);
    },
  };
}
