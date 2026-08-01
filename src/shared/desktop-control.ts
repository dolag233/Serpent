import { z } from 'zod';

export const DESKTOP_CONTROL_PROTOCOL_VERSION = 1 as const;

const nonBlankString = z.string().min(1).max(255).refine(
  (value) => value.trim().length > 0,
  { message: 'Value must not be blank.' },
);

export const desktopSelectionModeSchema = z.enum(['replace', 'add', 'remove']);
export type DesktopSelectionMode = z.infer<typeof desktopSelectionModeSchema>;

export const desktopSelectionRequestSchema = z.strictObject({
  assetIds: z.array(nonBlankString).max(10_000),
  mode: desktopSelectionModeSchema.default('replace'),
});
export type DesktopSelectionRequest = z.infer<typeof desktopSelectionRequestSchema>;

export const desktopSelectionResultSchema = z.strictObject({
  libraryId: nonBlankString,
  mode: desktopSelectionModeSchema,
  selectedAssetIds: z.array(nonBlankString).max(10_000),
  primaryAssetId: nonBlankString.nullable(),
  ignoredAssetIds: z.array(nonBlankString).max(10_000),
});
export type DesktopSelectionResult = z.infer<typeof desktopSelectionResultSchema>;

export const desktopControlHelloSchema = z.strictObject({
  type: z.literal('hello'),
  protocolVersion: z.literal(DESKTOP_CONTROL_PROTOCOL_VERSION),
  nonce: nonBlankString,
  clientName: nonBlankString.max(128),
  requestWriteAccess: z.boolean(),
});

export const desktopControlMcpRequestSchema = z.strictObject({
  type: z.literal('mcp.request'),
  requestId: nonBlankString,
  method: z.enum(['tools/list', 'tools/call']),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const desktopControlCloseSchema = z.strictObject({
  type: z.literal('close'),
});

export const desktopControlRequestSchema = z.discriminatedUnion('type', [
  desktopControlHelloSchema,
  desktopControlMcpRequestSchema,
  desktopControlCloseSchema,
]);
export type DesktopControlRequest = z.infer<typeof desktopControlRequestSchema>;

export const desktopControlHelloResponseSchema = z.strictObject({
  type: z.literal('hello.result'),
  ok: z.literal(true),
  protocolVersion: z.literal(DESKTOP_CONTROL_PROTOCOL_VERSION),
  sessionId: nonBlankString,
  libraryId: nonBlankString,
  displayName: nonBlankString,
  writeAccessGranted: z.boolean(),
});
export type DesktopControlHelloResponse = z.infer<typeof desktopControlHelloResponseSchema>;

export const desktopControlMcpResponseSchema = z.strictObject({
  type: z.literal('mcp.response'),
  requestId: nonBlankString,
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.strictObject({
    code: nonBlankString,
    message: nonBlankString,
  }).optional(),
});
export type DesktopControlMcpResponse = z.infer<typeof desktopControlMcpResponseSchema>;

export const desktopControlErrorResponseSchema = z.strictObject({
  type: z.literal('error'),
  code: nonBlankString,
  message: nonBlankString,
});

export const desktopControlResponseSchema = z.discriminatedUnion('type', [
  desktopControlHelloResponseSchema,
  desktopControlMcpResponseSchema,
  desktopControlErrorResponseSchema,
]);
export type DesktopControlResponse = z.infer<typeof desktopControlResponseSchema>;

export const desktopControlSelectionEventSchema = z.strictObject({
  libraryId: nonBlankString,
  assetIds: z.array(nonBlankString).max(10_000),
  mode: desktopSelectionModeSchema,
});
export type DesktopControlSelectionEvent = z.infer<typeof desktopControlSelectionEventSchema>;

export const desktopControlToolInputSchemas = {
  'serpent_desktop_focus': z.strictObject({}),
  'serpent_desktop_select_assets': desktopSelectionRequestSchema,
} as const;

export type DesktopControlToolName = keyof typeof desktopControlToolInputSchemas;

export const desktopControlToolDefinitions = [
  {
    name: 'serpent_desktop_focus',
    description: 'Bring the attached Serpent Desktop window to the foreground.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_focus.toJSONSchema(),
  },
  {
    name: 'serpent_desktop_select_assets',
    description: 'Set the selected asset IDs in the attached Serpent Desktop grid.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_select_assets.toJSONSchema(),
  },
] as const;

export const DESKTOP_CONTROL_MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const DESKTOP_CONTROL_MAX_SELECTION_IDS = 10_000;

export type DesktopControlToolResult =
  | { focused: boolean }
  | DesktopSelectionResult;
