import { z } from 'zod';

const requestIdSchema = z.string().min(1).max(128);
const contributionIdSchema = z.string().min(1).max(255);
const instanceIdSchema = z.string().min(1).max(255);
const commandIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u);
const storageKeySchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$/u);

const pluginUiCommandContextSchema = z.strictObject({
  assetIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
  folderIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
  collectionIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
});

function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value);
  return entries.length <= 256
    && entries.every(([key, item]) => key.length <= 128 && isJsonValue(item, depth + 1));
}

export const pluginUiStorageValueSchema = z.unknown().refine((value) => {
  if (!isJsonValue(value)) return false;
  const serialized = JSON.stringify(value);
  return serialized !== undefined && new TextEncoder().encode(serialized).length <= 64 * 1024;
}, 'Plugin UI storage values must be bounded JSON data.');

/**
 * Host-managed plugin view contract (Serpent-ex46.7).
 *
 * A plugin view is a sandboxed iframe contribution that the Host mounts into
 * one of several surfaces. The Host owns the lifecycle: it announces
 * mount/unmount/resize/state via host→plugin messages, and the plugin
 * confirms readiness with `plugin-ui.ready`. Light/dark changes travel over
 * the existing theme-changed message without reloading the document.
 */
export const PLUGIN_UI_VIEW_TYPES = [
  'sidebar',
  'inspector',
  'workspace',
  'viewer-overlay',
  'settings-page',
  'settings-detail',
] as const;
export type PluginUiViewType = (typeof PLUGIN_UI_VIEW_TYPES)[number];

export const PLUGIN_UI_VIEW_SCOPES = ['global', 'library'] as const;
export type PluginUiViewScope = (typeof PLUGIN_UI_VIEW_SCOPES)[number];

export const pluginUiViewTypeSchema = z.enum(PLUGIN_UI_VIEW_TYPES);
export const pluginUiViewScopeSchema = z.enum(PLUGIN_UI_VIEW_SCOPES);

/** Arbitrary bounded JSON carried by view state (selection, filters, …). */
export const pluginUiViewStateSchema = z.unknown().refine((value) => {
  if (!isJsonValue(value)) return false;
  const serialized = JSON.stringify(value);
  return serialized !== undefined && new TextEncoder().encode(serialized).length <= 16 * 1024;
}, 'Plugin view state must be bounded JSON data.');

export const pluginUiIframeMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('plugin-ui.ready'),
    contributionId: contributionIdSchema,
    instanceId: instanceIdSchema,
    /** Optional contract check: the Host verifies the frame is the expected view. */
    viewType: pluginUiViewTypeSchema.optional(),
    scope: pluginUiViewScopeSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-ui.invoke-command'),
    requestId: requestIdSchema,
    commandId: commandIdSchema,
    context: pluginUiCommandContextSchema.default({}),
  }),
  z.strictObject({
    type: z.literal('plugin-ui.storage.get'),
    requestId: requestIdSchema,
    key: storageKeySchema,
  }),
  z.strictObject({
    type: z.literal('plugin-ui.storage.set'),
    requestId: requestIdSchema,
    key: storageKeySchema,
    value: pluginUiStorageValueSchema,
  }),
]);
export type PluginUiIframeMessage = z.infer<typeof pluginUiIframeMessageSchema>;

const pluginUiThemeTokenNameSchema = z.string().regex(
  /^--(?:ui-[a-z0-9-]+|serpent-plugin-(?:ref|token)-[a-z][a-z0-9.-]*)$/u,
);
const pluginUiThemeTokensSchema = z.record(
  pluginUiThemeTokenNameSchema,
  z.string().max(128),
).refine((tokens) => Object.keys(tokens).length <= 128);

export const pluginUiHostMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('plugin-ui.theme-changed'),
    contributionId: contributionIdSchema,
    instanceId: instanceIdSchema,
    theme: z.enum(['light', 'dark']),
    contrast: z.enum(['normal', 'high']),
    revision: z.number().int().nonnegative(),
    tokens: pluginUiThemeTokensSchema,
  }),
  /** The Host has mounted this view into a surface; the plugin should render. */
  z.strictObject({
    type: z.literal('plugin-ui.view-mounted'),
    contributionId: contributionIdSchema,
    instanceId: instanceIdSchema,
    viewType: pluginUiViewTypeSchema,
    scope: pluginUiViewScopeSchema,
    libraryId: z.string().min(1).max(255).optional(),
    state: pluginUiViewStateSchema.optional(),
  }),
  /** Host-side view context changed (e.g. active library); no reload needed. */
  z.strictObject({
    type: z.literal('plugin-ui.view-state-changed'),
    contributionId: contributionIdSchema,
    instanceId: instanceIdSchema,
    state: pluginUiViewStateSchema,
  }),
  /** The Host resized the view (debounced); the plugin may relayout. */
  z.strictObject({
    type: z.literal('plugin-ui.view-resized'),
    contributionId: contributionIdSchema,
    instanceId: instanceIdSchema,
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  }),
  /** The Host unmounted the view (surface closed, scope changed, app quit). */
  z.strictObject({
    type: z.literal('plugin-ui.view-unmounted'),
    contributionId: contributionIdSchema,
    instanceId: instanceIdSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-ui.command-result'),
    requestId: requestIdSchema,
    ok: z.boolean(),
    errorCode: z.string().min(1).max(128).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-ui.storage.result'),
    requestId: requestIdSchema,
    ok: z.boolean(),
    value: pluginUiStorageValueSchema.optional(),
    errorCode: z.string().min(1).max(128).optional(),
  }),
]);
export type PluginUiHostMessage = z.infer<typeof pluginUiHostMessageSchema>;

export function parsePluginUiIframeMessage(input: unknown): PluginUiIframeMessage {
  return pluginUiIframeMessageSchema.parse(input);
}

export function parsePluginUiHostMessage(input: unknown): PluginUiHostMessage {
  return pluginUiHostMessageSchema.parse(input);
}

/**
 * Sandboxed iframes without allow-same-origin normally report an opaque
 * `null` origin. Chromium custom-scheme documents (serpent-plugin://) may
 * instead report the scheme+host origin even inside allow-scripts sandboxes.
 * Source identity remains mandatory either way.
 */
export function isTrustedPluginUiMessage(input: {
  origin: string;
  source: unknown;
  expectedOrigin: string;
  expectedSource: unknown;
  /** Optional `serpent-plugin://<pluginId>` origin accepted from plugin UI frames. */
  expectedPluginOrigin?: string;
}): boolean {
  if (input.source !== input.expectedSource) return false;
  if (input.origin === input.expectedOrigin) return true;
  if (input.expectedPluginOrigin !== undefined && input.origin === input.expectedPluginOrigin) {
    return true;
  }
  return false;
}
