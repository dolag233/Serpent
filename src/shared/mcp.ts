import { z } from 'zod';

export const MCP_DEFAULT_PORT = 47_342;
export const MCP_MIN_PORT = 1_024;
export const MCP_MAX_PORT = 65_535;
export const MCP_ENDPOINT_PATH = '/mcp' as const;

/** Credential-level mode. It never depends on an MCP transport session. */
export const mcpAccessModeSchema = z.enum(['auto', 'full-access']);
export type McpAccessMode = z.infer<typeof mcpAccessModeSchema>;

export const mcpCredentialPermissionSchema = z.strictObject({
  credentialId: z.string().uuid(),
  mode: mcpAccessModeSchema,
});
export type McpCredentialPermission = z.infer<typeof mcpCredentialPermissionSchema>;

export const mcpServerPreferencesSchema = z.strictObject({
  enabled: z.boolean(),
  autoStart: z.boolean(),
  port: z.number().int().min(MCP_MIN_PORT).max(MCP_MAX_PORT),
});
export type McpServerPreferences = z.infer<typeof mcpServerPreferencesSchema>;

export const mcpRuntimeStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('stopped') }),
  z.strictObject({ status: z.literal('starting') }),
  z.strictObject({
    status: z.literal('running'),
    endpoint: z.string().url(),
    port: z.number().int().min(MCP_MIN_PORT).max(MCP_MAX_PORT),
    connectedClientCount: z.number().int().nonnegative(),
    activeSessionCount: z.number().int().nonnegative(),
    startedAt: z.string().datetime(),
  }),
  z.strictObject({ status: z.literal('stopping') }),
  z.strictObject({
    status: z.literal('error'),
    code: z.enum([
      'MCP_SERVER_PORT_UNAVAILABLE',
      'MCP_SERVER_START_FAILED',
      'MCP_SERVER_STOP_FAILED',
    ]),
    message: z.string().min(1).max(500),
  }),
]);
export type McpRuntimeState = z.infer<typeof mcpRuntimeStateSchema>;

export const mcpClientCredentialSummarySchema = z.strictObject({
  credentialId: z.string().uuid(),
  label: z.string().min(1).max(255),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type McpClientCredentialSummary = z.infer<typeof mcpClientCredentialSummarySchema>;

export const mcpSettingsSnapshotSchema = z.strictObject({
  preferences: mcpServerPreferencesSchema,
  runtime: mcpRuntimeStateSchema,
  credentials: z.array(mcpClientCredentialSummarySchema).max(256),
  credentialPermissions: z.array(mcpCredentialPermissionSchema).max(256),
});
export type McpSettingsSnapshot = z.infer<typeof mcpSettingsSnapshotSchema>;

export const mcpConfigFormatSchema = z.enum([
  'generic-json',
  'endpoint-and-token',
]);
export type McpConfigFormat = z.infer<typeof mcpConfigFormatSchema>;

export const mcpCreateClientConfigInputSchema = z.strictObject({
  format: mcpConfigFormatSchema,
  label: z.string().trim().min(1).max(255).optional(),
});
export type McpCreateClientConfigInput = z.infer<typeof mcpCreateClientConfigInputSchema>;

export const mcpSettingsRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('get') }),
  z.strictObject({ type: z.literal('set-auto-start'), enabled: z.boolean() }),
  z.strictObject({
    type: z.literal('set-access-mode'),
    credentialId: z.string().uuid(),
    mode: mcpAccessModeSchema,
  }),
  z.strictObject({
    type: z.literal('set-port'),
    port: z.number().int().min(MCP_MIN_PORT).max(MCP_MAX_PORT),
  }),
  z.strictObject({ type: z.literal('start') }),
  z.strictObject({ type: z.literal('stop') }),
  z.strictObject({ type: z.literal('enable'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('create-client-config'), input: mcpCreateClientConfigInputSchema }),
  z.strictObject({ type: z.literal('revoke-credential'), credentialId: z.string().uuid() }),
]);
export type McpSettingsRequest = z.infer<typeof mcpSettingsRequestSchema>;

export const mcpSettingsResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    snapshot: mcpSettingsSnapshotSchema,
    copied: z.boolean().optional(),
    credentialId: z.string().uuid().optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(500),
    snapshot: mcpSettingsSnapshotSchema.optional(),
  }),
]);
export type McpSettingsResponse = z.infer<typeof mcpSettingsResponseSchema>;

export interface SerpentMcpSettingsApi {
  request(input: McpSettingsRequest): Promise<McpSettingsResponse>;
  onChanged(listener: (snapshot: McpSettingsSnapshot) => void): () => void;
}
