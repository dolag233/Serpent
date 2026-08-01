import { z } from 'zod';

import {
  desktopDiscoveryFilterFieldsSchema,
  desktopDiscoveryFilterPatchSchema,
  desktopViewerNavigateDirectionSchema,
} from './desktop-browse-discovery';

export const DESKTOP_CONTROL_PROTOCOL_VERSION = 1 as const;
export {
  applyDesktopDiscoveryFilterPatch,
  EMPTY_DESKTOP_DISCOVERY_FILTERS,
  EMPTY_DESKTOP_NUMERIC_RANGE,
  resolveDesktopViewerNeighbor,
  desktopDiscoveryFilterFieldsSchema,
  desktopDiscoveryFilterPatchSchema,
  desktopViewerNavigateDirectionSchema,
  type DesktopAvailabilityFilter,
  type DesktopDiscoveryFilterFields,
  type DesktopDiscoveryFilterPatch,
  type DesktopNumericRangeInput,
  type DesktopNumericRangeState,
  type DesktopTagFilterMatch,
  type DesktopTernaryFilter,
  type DesktopViewerNavigateDirection,
  type DesktopViewerNeighborResolution,
} from './desktop-browse-discovery';

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

export const desktopBrowseSortFieldSchema = z.enum([
  'name',
  'modified_at',
  'created_at',
  'byte_size',
  'long_edge',
  'duration',
  'rating',
  'color',
  'author',
]);
export type DesktopBrowseSortField = z.infer<typeof desktopBrowseSortFieldSchema>;
export const desktopRevealPositionSchema = z.enum(['nearest', 'center']);
export type DesktopRevealPosition = z.infer<typeof desktopRevealPositionSchema>;

export const desktopBrowseStateSchema = z.strictObject({
  libraryId: nonBlankString,
  browseTarget: z.enum([
    'all',
    'root',
    'folder',
    'trash',
    'tag',
    'collection',
    'smart-collection',
  ]),
  folderId: nonBlankString.nullable(),
  organizationId: nonBlankString.nullable(),
  showTrash: z.boolean(),
  includeSubfolders: z.boolean(),
  search: z.string().max(1024),
  colorFilter: z.string().max(255),
  excludeColorFilter: z.boolean(),
  ...desktopDiscoveryFilterFieldsSchema.shape,
  sortField: desktopBrowseSortFieldSchema,
  sortOrder: z.enum(['asc', 'desc']),
  viewMode: z.enum(['grid', 'masonry']),
  selectedAssetIds: z.array(nonBlankString).max(10_000),
  primaryAssetId: nonBlankString.nullable(),
  viewerAssetId: nonBlankString.nullable(),
});
export type DesktopBrowseState = z.infer<typeof desktopBrowseStateSchema>;

export const desktopBrowseActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('get-state'),
    requestId: nonBlankString,
    libraryId: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('open-folder'),
    requestId: nonBlankString,
    libraryId: nonBlankString,
    folderId: nonBlankString.nullable(),
  }),
  z.strictObject({
    type: z.literal('set-discovery'),
    requestId: nonBlankString,
    libraryId: nonBlankString,
    search: z.string().max(1024).nullable().optional(),
    colorFilter: z.string().max(255).nullable().optional(),
    excludeColorFilter: z.boolean().optional(),
    includeSubfolders: z.boolean().optional(),
    sortField: desktopBrowseSortFieldSchema.optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    ...desktopDiscoveryFilterPatchSchema.shape,
  }),
  z.strictObject({
    type: z.literal('reveal-asset'),
    requestId: nonBlankString,
    libraryId: nonBlankString,
    assetId: nonBlankString,
    position: desktopRevealPositionSchema,
  }),
  z.strictObject({
    type: z.literal('open-viewer'),
    requestId: nonBlankString,
    libraryId: nonBlankString,
    assetId: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('close-viewer'),
    requestId: nonBlankString,
    libraryId: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('navigate-viewer'),
    requestId: nonBlankString,
    libraryId: nonBlankString,
    direction: desktopViewerNavigateDirectionSchema,
  }),
]);
export type DesktopBrowseAction = z.infer<typeof desktopBrowseActionSchema>;

export const desktopBrowseResultSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('state'),
    requestId: nonBlankString,
    ok: z.literal(true),
    state: desktopBrowseStateSchema,
  }),
  z.strictObject({
    type: z.literal('folder-opened'),
    requestId: nonBlankString,
    ok: z.literal(true),
    state: desktopBrowseStateSchema,
  }),
  z.strictObject({
    type: z.literal('discovery-updated'),
    requestId: nonBlankString,
    ok: z.literal(true),
    state: desktopBrowseStateSchema,
  }),
  z.strictObject({
    type: z.literal('reveal-applied'),
    requestId: nonBlankString,
    ok: z.literal(true),
    assetId: nonBlankString,
    position: desktopRevealPositionSchema,
    status: z.enum(['visible', 'switched-folder', 'not-visible']),
    folderId: nonBlankString.nullable(),
    state: desktopBrowseStateSchema,
  }),
  z.strictObject({
    type: z.literal('viewer-updated'),
    requestId: nonBlankString,
    ok: z.literal(true),
    state: desktopBrowseStateSchema,
  }),
  z.strictObject({
    type: z.literal('failure'),
    requestId: nonBlankString,
    ok: z.literal(false),
    code: z.enum([
      'DESKTOP_BROWSE_LIBRARY_MISMATCH',
      'DESKTOP_BROWSE_FOLDER_NOT_FOUND',
      'DESKTOP_BROWSE_ASSET_NOT_FOUND',
      'DESKTOP_BROWSE_ASSET_UNAVAILABLE',
      'DESKTOP_BROWSE_ASSET_SCOPE_UNSUPPORTED',
      'DESKTOP_BROWSE_VIEWER_CLOSED',
      'DESKTOP_BROWSE_VIEWER_BOUNDARY',
      'DESKTOP_BROWSE_UNAVAILABLE',
      'DESKTOP_BROWSE_BLOCKED',
    ]),
    message: nonBlankString,
  }),
]);
export type DesktopBrowseResult = z.infer<typeof desktopBrowseResultSchema>;

export const desktopControlToolInputSchemas = {
  'serpent_desktop_focus': z.strictObject({}),
  'serpent_desktop_select_assets': desktopSelectionRequestSchema,
  'serpent_desktop_get_state': z.strictObject({}),
  'serpent_desktop_open_folder': z.strictObject({
    folderId: nonBlankString.nullable().default(null),
  }),
  'serpent_desktop_set_discovery': z.strictObject({
    search: z.string().max(1024).nullable().optional(),
    colorFilter: z.string().max(255).nullable().optional(),
    excludeColorFilter: z.boolean().optional(),
    includeSubfolders: z.boolean().optional(),
    sortField: desktopBrowseSortFieldSchema.optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    ...desktopDiscoveryFilterPatchSchema.shape,
  }),
  'serpent_desktop_reveal_asset': z.strictObject({
    assetId: nonBlankString,
    position: desktopRevealPositionSchema.default('nearest'),
  }),
  'serpent_desktop_open_viewer': z.strictObject({
    assetId: nonBlankString,
  }),
  'serpent_desktop_close_viewer': z.strictObject({}),
  'serpent_desktop_navigate_viewer': z.strictObject({
    direction: desktopViewerNavigateDirectionSchema,
  }),
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
  {
    name: 'serpent_desktop_get_state',
    description: 'Read the attached Serpent Desktop browse, selection, and viewer state.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_get_state.toJSONSchema(),
  },
  {
    name: 'serpent_desktop_open_folder',
    description: 'Open a managed folder in the attached Serpent Desktop browse view.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_open_folder.toJSONSchema(),
  },
  {
    name: 'serpent_desktop_set_discovery',
    description:
      'Set typed search, palette-color facet, discovery filters, and sort state in the attached Desktop.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_set_discovery.toJSONSchema(),
  },
  {
    name: 'serpent_desktop_reveal_asset',
    description: 'Reveal a stable asset ID in the attached Desktop using semantic positioning.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_reveal_asset.toJSONSchema(),
  },
  {
    name: 'serpent_desktop_open_viewer',
    description: 'Open the existing Desktop viewer for a stable asset ID.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_open_viewer.toJSONSchema(),
  },
  {
    name: 'serpent_desktop_close_viewer',
    description: 'Close the existing Desktop viewer in the attached instance.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_close_viewer.toJSONSchema(),
  },
  {
    name: 'serpent_desktop_navigate_viewer',
    description:
      'Move the existing Desktop viewer to the previous or next visible asset without simulating input.',
    inputSchema: desktopControlToolInputSchemas.serpent_desktop_navigate_viewer.toJSONSchema(),
  },
] as const;

export const DESKTOP_CONTROL_MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const DESKTOP_CONTROL_MAX_SELECTION_IDS = 10_000;

export type DesktopControlToolResult =
  | { focused: boolean }
  | DesktopSelectionResult
  | DesktopBrowseState;
