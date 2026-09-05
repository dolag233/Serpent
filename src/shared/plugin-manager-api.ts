import { z } from 'zod';

import { pluginUiStorageValueSchema } from './plugin-ui-protocol';
import type { PluginUiDialogRequestPayload } from './plugin-ui-dialog-bridge';
import {
  assetSummarySchema,
  filterClauseSchema,
  searchQuerySchema,
  searchScopeSchema,
  sortDefinitionSchema,
} from './asset-types';
import { pluginProviderMediaSchema, pluginProviderMetadataSchema, pluginProviderAiAnalysisSchema, pluginProviderExportDescriptorSchema, pluginProviderImportPlanSchema } from '../plugins/plugin-providers';
import { pluginThemePackageSchema } from '../plugins/plugin-themes';
import { pluginRuntimeModeSchema } from '../plugins/plugin-runtime-mode';
import { pluginInvocationContextSchema } from '../plugins/plugin-context';
import { pluginUiDescriptorSchema } from './plugin-ui-descriptor';
import {
  pluginContextExpressionSchema,
  pluginSettingTypeSchema,
  pluginSettingValueSchema,
} from '../plugins/plugin-manifest';
import { isGitHubPluginInstallUrl } from '../shared/plugin-github-url';
import {
  pluginInstallControlActionSchema,
  pluginInstallOperationIdSchema,
  type PluginInstallProgress,
} from './plugin-install-progress';

const pluginIdSchema = z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/u);
const versionSchema = z.string().min(1).max(128);
const libraryIdSchema = z.string().min(1).max(255);
const packageHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeSchema = z.enum(['user', 'library']);
const runtimeModeSchema = pluginRuntimeModeSchema;
const trustSchema = z.enum(['trusted', 'denied', 'untrusted']);
const pluginLocalIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u);

const githubRepositorySchema = z.url().refine((value) => isGitHubPluginInstallUrl(value), 'Expected an HTTPS GitHub owner/repository or Release URL.');

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

const pluginHostMenuTargetSchema = z.enum([
  'menus.asset',
  'menus.folder',
  'menus.collection',
  'menus.workspace',
]);
export type PluginHostMenuTarget = z.infer<typeof pluginHostMenuTargetSchema>;

const pluginHostContributionTargetSchema = z.enum([
  'commands',
  'menus.asset',
  'menus.folder',
  'menus.collection',
  'menus.workspace',
  'toolbar',
  'inspector.sections',
  'viewer.actions',
  'settings.sections',
  'sidebar.entries',
  'workspace.views',
  'inspector.views',
  'viewer.overlays',
  'settings.pages',
  'dialogs',
  'shortcuts',
  'ui.descriptor',
]);
export type PluginHostContributionTarget = z.infer<typeof pluginHostContributionTargetSchema>;

export const pluginManagerRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('plugin-manager.list'), libraryId: libraryIdSchema.optional() }),
  z.strictObject({
    type: z.literal('plugin-manager.list-contributions'),
    libraryId: libraryIdSchema.optional(),
    target: pluginHostContributionTargetSchema.optional(),
  }),
  z.strictObject({ type: z.literal('plugin-manager.list-mcp-exposure') }),
  z.strictObject({
    type: z.literal('plugin-manager.set-mcp-exposure'),
    pluginId: pluginIdSchema,
    commandId: pluginLocalIdSchema,
    enabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.run-command'),
    libraryId: libraryIdSchema,
    contributionId: z.string().min(1).max(255).optional(),
    pluginId: pluginIdSchema.optional(),
    commandId: pluginLocalIdSchema.optional(),
    assetIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
    folderIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
    collectionIds: z.array(z.string().min(1).max(255)).max(10_000).optional(),
    invocation: pluginInvocationContextSchema.optional(),
  }).superRefine((value, context) => {
    const hasContributionId = value.contributionId !== undefined;
    const hasCommandPair = value.pluginId !== undefined && value.commandId !== undefined;
    if (hasContributionId === hasCommandPair) {
      context.addIssue({
        code: 'custom',
        message: 'Run-command requests need either contributionId or pluginId plus commandId.',
      });
    }
  }),
  z.strictObject({
    type: z.literal('plugin-manager.search-providers'),
    libraryId: libraryIdSchema,
    query: searchQuerySchema,
    filters: z.array(filterClauseSchema).max(16).optional(),
    scope: searchScopeSchema.optional(),
    sort: sortDefinitionSchema.optional(),
    scopeMode: z.boolean().optional(),
    limit: z.number().int().positive().max(256).optional(),
    offset: z.number().int().nonnegative().optional(),
    deadlineMs: z.number().int().positive().max(5_000).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.preview-provider'),
    libraryId: libraryIdSchema,
    assetId: z.string().min(1).max(255),
    deadlineMs: z.number().int().positive().max(5_000).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.thumbnail-provider'),
    libraryId: libraryIdSchema,
    assetId: z.string().min(1).max(255),
    deadlineMs: z.number().int().positive().max(5_000).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.metadata-provider'),
    libraryId: libraryIdSchema,
    assetId: z.string().min(1).max(255),
    deadlineMs: z.number().int().positive().max(5_000).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.import-provider'),
    libraryId: libraryIdSchema,
    fileName: z.string().min(1).max(1_024),
    extension: z.string().max(32).optional(),
    mimeType: z.string().min(3).max(128).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    deadlineMs: z.number().int().positive().max(5_000).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.export-provider'),
    libraryId: libraryIdSchema,
    assetId: z.string().min(1).max(255),
    deadlineMs: z.number().int().positive().max(5_000).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.ai-provider'),
    libraryId: libraryIdSchema,
    assetId: z.string().min(1).max(255),
    deadlineMs: z.number().int().positive().max(5_000).optional(),
  }),
  z.strictObject({ type: z.literal('plugin-manager.install-local'), ...scopedRequestFields }),
  z.strictObject({
    type: z.literal('plugin-manager.install-github'),
    ...scopedRequestFields,
    repository: z.string().min(1).max(512).refine((value) => isGitHubPluginInstallUrl(value), 'Expected a GitHub owner/repository or URL.'),
    operationId: pluginInstallOperationIdSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.install-control'),
    operationId: pluginInstallOperationIdSchema,
    action: pluginInstallControlActionSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-manager.update-github'),
    ...scopedRequestFields,
    pluginId: pluginIdSchema,
    packageHash: packageHashSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-manager.set-auto-update'),
    pluginId: pluginIdSchema,
    sourceFingerprint: z.string().min(1).max(1_024),
    enabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.set-global-auto-update'),
    enabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.reveal-package'),
    ...scopedRequestFields,
    pluginId: pluginIdSchema,
    version: versionSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-manager.reload'),
    libraryId: libraryIdSchema.optional(),
  }),
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
    propagateUserScoped: z.boolean().optional(),
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
    type: z.literal('plugin-manager.clear-quarantine'),
    libraryId: libraryIdSchema,
    pluginId: pluginIdSchema,
    packageHash: packageHashSchema.optional(),
  }),
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
  z.strictObject({
    type: z.literal('plugin-manager.get-plugin-settings'),
    pluginId: pluginIdSchema,
    scope: scopeSchema,
    libraryId: libraryIdSchema.optional(),
  }).superRefine((value, context) => {
    if (value.scope === 'library' && value.libraryId === undefined) {
      context.addIssue({ code: 'custom', path: ['libraryId'], message: 'Library-scoped settings need a libraryId.' });
    }
    if (value.scope === 'user' && value.libraryId !== undefined) {
      context.addIssue({ code: 'custom', path: ['libraryId'], message: 'User-scoped settings cannot include a libraryId.' });
    }
  }),
  z.strictObject({
    type: z.literal('plugin-manager.set-plugin-setting'),
    pluginId: pluginIdSchema,
    scope: scopeSchema,
    settingId: pluginLocalIdSchema,
    value: pluginSettingValueSchema,
    libraryId: libraryIdSchema.optional(),
  }).superRefine((value, context) => {
    if (value.scope === 'library' && value.libraryId === undefined) {
      context.addIssue({ code: 'custom', path: ['libraryId'], message: 'Library-scoped settings need a libraryId.' });
    }
    if (value.scope === 'user' && value.libraryId !== undefined) {
      context.addIssue({ code: 'custom', path: ['libraryId'], message: 'User-scoped settings cannot include a libraryId.' });
    }
  }),
  z.strictObject({
    type: z.literal('plugin-manager.ui-storage-get'),
    libraryId: libraryIdSchema,
    pluginId: pluginIdSchema,
    pluginInstanceId: z.string().min(1).max(255),
    key: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$/u),
  }),
  z.strictObject({
    type: z.literal('plugin-manager.ui-storage-set'),
    libraryId: libraryIdSchema,
    pluginId: pluginIdSchema,
    pluginInstanceId: z.string().min(1).max(255),
    key: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$/u),
    value: pluginUiStorageValueSchema,
  }),
]);
export type PluginManagerRequest = z.infer<typeof pluginManagerRequestSchema>;

export const pluginManagerMenuContributionSchema = z.strictObject({
  kind: z.literal('menu'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  commandId: pluginLocalIdSchema.optional(),
  title: z.string().min(1).max(160),
  group: z.string().min(1).max(64).optional(),
  parentId: z.string().min(1).max(255).optional(),
  before: z.string().min(1).max(255).optional(),
  after: z.string().min(1).max(255).optional(),
  first: z.boolean().optional(),
  last: z.boolean().optional(),
  when: pluginContextExpressionSchema.optional(),
  enablement: pluginContextExpressionSchema.optional(),
  checked: pluginContextExpressionSchema.optional(),
  shortcut: z.string().min(1).max(64).optional(),
  target: pluginHostMenuTargetSchema,
});
export type PluginManagerMenuContribution = z.infer<typeof pluginManagerMenuContributionSchema>;

export const pluginManagerCommandContributionSchema = z.strictObject({
  kind: z.literal('command'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  commandId: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  when: pluginContextExpressionSchema.optional(),
  enablement: pluginContextExpressionSchema.optional(),
  checked: pluginContextExpressionSchema.optional(),
  mcpExported: z.literal(true).optional(),
  target: z.literal('commands'),
});
export type PluginManagerCommandContribution = z.infer<typeof pluginManagerCommandContributionSchema>;

/**
 * Zod 4 discriminatedUnion forbids duplicate discriminator literals. All iframe
 * surfaces share kind "view" and are distinguished by `target` inside one object.
 */
export const pluginManagerViewContributionSchema = z.strictObject({
  kind: z.literal('view'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  title: z.string().min(1).max(160),
  entryPath: z.string().min(1).max(1_024).optional(),
  url: z.url().optional(),
  themePackage: pluginThemePackageSchema.optional(),
  target: z.enum([
    'sidebar.entries',
    'workspace.views',
    'inspector.views',
    'viewer.overlays',
    'settings.pages',
  ]),
});
export type PluginManagerViewContribution = z.infer<typeof pluginManagerViewContributionSchema>;

export const pluginManagerDialogContributionSchema = z.strictObject({
  kind: z.literal('dialog'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  title: z.string().min(1).max(160),
  entryPath: z.string().min(1).max(1_024),
  url: z.url().optional(),
  themePackage: pluginThemePackageSchema.optional(),
  target: z.literal('dialogs'),
  width: z.number().int().min(280).max(1_200).optional(),
  height: z.number().int().min(200).max(1_200).optional(),
});
export type PluginManagerDialogContribution = z.infer<typeof pluginManagerDialogContributionSchema>;

export type PluginManagerSidebarViewContribution = Extract<
  PluginManagerViewContribution,
  { target: 'sidebar.entries' }
>;
export type PluginManagerWorkspaceViewContribution = Extract<
  PluginManagerViewContribution,
  { target: 'workspace.views' }
>;
export type PluginManagerInspectorViewContribution = Extract<
  PluginManagerViewContribution,
  { target: 'inspector.views' }
>;
export type PluginManagerViewerOverlayContribution = Extract<
  PluginManagerViewContribution,
  { target: 'viewer.overlays' }
>;
export type PluginManagerSettingsPageContribution = Extract<
  PluginManagerViewContribution,
  { target: 'settings.pages' }
>;

/** @deprecated Prefer {@link pluginManagerViewContributionSchema}; kept for call-site imports. */
export const pluginManagerSidebarViewContributionSchema = pluginManagerViewContributionSchema;
/** @deprecated Prefer {@link pluginManagerViewContributionSchema} */
export const pluginManagerWorkspaceViewContributionSchema = pluginManagerViewContributionSchema;
/** @deprecated Prefer {@link pluginManagerViewContributionSchema} */
export const pluginManagerInspectorViewContributionSchema = pluginManagerViewContributionSchema;
/** @deprecated Prefer {@link pluginManagerViewContributionSchema} */
export const pluginManagerViewerOverlayContributionSchema = pluginManagerViewContributionSchema;
/** @deprecated Prefer {@link pluginManagerViewContributionSchema} */
export const pluginManagerSettingsPageContributionSchema = pluginManagerViewContributionSchema;

export const pluginManagerSettingsContributionSchema = z.strictObject({
  kind: z.literal('settings-section'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  settingId: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  type: pluginSettingTypeSchema,
  description: z.string().min(1).max(2_000).optional(),
  options: z.array(z.strictObject({
    value: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
  })).max(64).optional(),
  default: pluginSettingValueSchema.optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  target: z.literal('settings.sections'),
});
export type PluginManagerSettingsContribution = z.infer<typeof pluginManagerSettingsContributionSchema>;

export const pluginManagerUiDescriptorContributionSchema = z.strictObject({
  kind: z.literal('ui-descriptor'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  descriptor: pluginUiDescriptorSchema,
  target: z.literal('ui.descriptor'),
});
export type PluginManagerUiDescriptorContribution = z.infer<typeof pluginManagerUiDescriptorContributionSchema>;

export const pluginManagerToolbarContributionSchema = z.strictObject({
  kind: z.literal('toolbar'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  commandId: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  when: pluginContextExpressionSchema.optional(),
  enablement: pluginContextExpressionSchema.optional(),
  checked: pluginContextExpressionSchema.optional(),
  target: z.literal('toolbar'),
});
export type PluginManagerToolbarContribution = z.infer<typeof pluginManagerToolbarContributionSchema>;

export const pluginManagerInspectorSectionContributionSchema = z.strictObject({
  kind: z.literal('inspector-section'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  commandId: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  commandTitle: z.string().min(1).max(160),
  when: pluginContextExpressionSchema.optional(),
  enablement: pluginContextExpressionSchema.optional(),
  checked: pluginContextExpressionSchema.optional(),
  target: z.literal('inspector.sections'),
});
export type PluginManagerInspectorSectionContribution = z.infer<typeof pluginManagerInspectorSectionContributionSchema>;

export const pluginManagerViewerActionContributionSchema = z.strictObject({
  kind: z.literal('viewer-action'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  commandId: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  when: pluginContextExpressionSchema.optional(),
  enablement: pluginContextExpressionSchema.optional(),
  checked: pluginContextExpressionSchema.optional(),
  target: z.literal('viewer.actions'),
});
export type PluginManagerViewerActionContribution = z.infer<typeof pluginManagerViewerActionContributionSchema>;

export const pluginManagerShortcutContributionSchema = z.strictObject({
  kind: z.literal('shortcut'),
  id: z.string().min(1).max(255),
  pluginId: pluginIdSchema,
  pluginInstanceId: z.string().min(1).max(255),
  commandId: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  accelerator: z.string().min(1).max(64),
  when: pluginContextExpressionSchema.optional(),
  enablement: pluginContextExpressionSchema.optional(),
  checked: pluginContextExpressionSchema.optional(),
  target: z.literal('shortcuts'),
});
export type PluginManagerShortcutContribution = z.infer<typeof pluginManagerShortcutContributionSchema>;

export const pluginManagerContributionSchema = z.discriminatedUnion('kind', [
  pluginManagerCommandContributionSchema,
  pluginManagerMenuContributionSchema,
  pluginManagerToolbarContributionSchema,
  pluginManagerInspectorSectionContributionSchema,
  pluginManagerViewerActionContributionSchema,
  pluginManagerShortcutContributionSchema,
  pluginManagerSettingsContributionSchema,
  pluginManagerUiDescriptorContributionSchema,
  pluginManagerViewContributionSchema,
  pluginManagerDialogContributionSchema,
]);
export type PluginManagerContribution = z.infer<typeof pluginManagerContributionSchema>;

export const pluginManagerMcpExposureEntrySchema = z.strictObject({
  pluginId: pluginIdSchema,
  commandId: pluginLocalIdSchema,
});
export type PluginManagerMcpExposureEntry = z.infer<typeof pluginManagerMcpExposureEntrySchema>;

export const pluginManagerPluginSettingDiagnosticSchema = z.strictObject({
  settingId: pluginLocalIdSchema,
  layer: z.enum(['user-default', 'library', 'device-override']),
  code: z.enum(['invalid-type', 'out-of-range', 'invalid-option']),
  message: z.string().min(1).max(2_000),
});
export type PluginManagerPluginSettingDiagnostic = z.infer<typeof pluginManagerPluginSettingDiagnosticSchema>;

/** @deprecated Use {@link PluginManagerMenuContribution} */
export type PluginManagerMenuContributionLegacy = PluginManagerMenuContribution;

export const pluginManagerPluginSettingSectionSchema = z.strictObject({
  id: pluginLocalIdSchema,
  title: z.string().min(1).max(160),
  type: pluginSettingTypeSchema,
  description: z.string().min(1).max(2_000).optional(),
  options: z.array(z.strictObject({
    value: z.string().min(1).max(128),
    label: z.string().min(1).max(160),
  })).max(64).optional(),
  default: pluginSettingValueSchema,
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  value: pluginSettingValueSchema,
});
export type PluginManagerPluginSettingSection = z.infer<typeof pluginManagerPluginSettingSectionSchema>;

export const pluginManagerMediaProviderResultSchema = z.strictObject({
  status: z.enum(['provided', 'native-fallback']),
  assetId: z.string().min(1).max(255),
  kind: z.enum(['preview', 'thumbnail']),
  providerId: pluginLocalIdSchema.optional(),
  media: pluginProviderMediaSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
});
export type PluginManagerMediaProviderResult = z.infer<typeof pluginManagerMediaProviderResultSchema>;

export const pluginManagerMetadataProviderResultSchema = z.strictObject({
  status: z.enum(['provided', 'native-fallback']),
  assetId: z.string().min(1).max(255),
  providerId: pluginLocalIdSchema.optional(),
  metadata: pluginProviderMetadataSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
});
export type PluginManagerMetadataProviderResult = z.infer<typeof pluginManagerMetadataProviderResultSchema>;

export const pluginManagerImportProviderResultSchema = z.strictObject({
  status: z.enum(['provided', 'native-fallback']),
  providerId: pluginLocalIdSchema.optional(),
  importPlan: pluginProviderImportPlanSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
});
export type PluginManagerImportProviderResult = z.infer<typeof pluginManagerImportProviderResultSchema>;

export const pluginManagerExportProviderResultSchema = z.strictObject({
  status: z.enum(['provided', 'native-fallback']),
  assetId: z.string().min(1).max(255),
  providerId: pluginLocalIdSchema.optional(),
  exportDescriptor: pluginProviderExportDescriptorSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
});
export type PluginManagerExportProviderResult = z.infer<typeof pluginManagerExportProviderResultSchema>;

export const pluginManagerAiProviderResultSchema = z.strictObject({
  status: z.enum(['provided', 'native-fallback']),
  assetId: z.string().min(1).max(255),
  providerId: pluginLocalIdSchema.optional(),
  analysis: pluginProviderAiAnalysisSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
});
export type PluginManagerAiProviderResult = z.infer<typeof pluginManagerAiProviderResultSchema>;

export const pluginManagerPackageSummarySchema = z.strictObject({
  pluginId: pluginIdSchema,
  version: versionSchema,
  name: z.string().min(1).max(255),
  description: z.string().max(2_000),
  packageHash: packageHashSchema,
  runtimeMode: runtimeModeSchema,
  permissions: z.array(z.string().min(1).max(128)).max(64),
  source: pluginManagerSourceSummarySchema,
  sourceFingerprint: z.string().min(1).max(1_024),
  scope: scopeSchema,
  status: z.enum(['valid', 'invalid']),
  trust: trustSchema,
  errorCode: z.string().min(1).max(128).optional(),
  /** Host-rendered settings.sections or sandboxed settings.pages may be available. */
  hasSettingsUi: z.boolean().default(false),
  availableUpdate: z.strictObject({
    version: versionSchema,
    tag: z.string().min(1).max(255),
    assetName: z.string().min(1).max(512),
  }).optional(),
  autoUpdate: z.boolean().optional(),
  updatePolicy: z.enum(['follow-latest', 'pinned']).optional(),
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

/**
 * Zod 4 discriminatedUnion forbids duplicate discriminator literals, so the
 * three disabled reasons share one object shape. Quarantine still carries the
 * package identity fields; other disable reasons leave them unset.
 */
const pluginManagerDisabledResolutionSchema = z.strictObject({
  status: z.literal('disabled'),
  pluginId: pluginIdSchema,
  reason: z.enum(['safe-mode', 'user-disabled', 'quarantined']),
  version: versionSchema.optional(),
  packageHash: packageHashSchema.optional(),
}).superRefine((value, context) => {
  const quarantined = value.reason === 'quarantined';
  if (quarantined && (value.version === undefined || value.packageHash === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'A quarantined plugin resolution requires version and packageHash.',
    });
  }
  if (!quarantined && (value.version !== undefined || value.packageHash !== undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'Only quarantined plugin resolutions may include version and packageHash.',
    });
  }
});

export const pluginManagerResolutionSummarySchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not-installed'), pluginId: pluginIdSchema }),
  pluginManagerDisabledResolutionSchema,
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

const pluginManagerErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  code: z.enum(['invalid-request', 'library-not-open', 'selection-cancelled', 'operation-failed']),
  /** Stable installer / host failure code when available (e.g. PLUGIN_SOURCE_SYMLINK_FORBIDDEN). */
  failureCode: z.string().min(1).max(128).optional(),
  /** Short explanation safe for Renderer display. Must not include absolute filesystem paths. */
  message: z.string().min(1).max(2_000).optional(),
});
export type PluginManagerErrorResponse = z.infer<typeof pluginManagerErrorResponseSchema>;

export const pluginManagerResponseSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    packages: z.array(pluginManagerPackageSummarySchema).max(20_000),
    resolutions: z.array(pluginManagerResolutionSummarySchema).max(20_000),
    safeMode: z.boolean(),
    autoUpdateAll: z.boolean().optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    contributions: z.array(pluginManagerContributionSchema).max(20_000),
  }),
  z.strictObject({
    ok: z.literal(true),
    mcpExposure: z.array(pluginManagerMcpExposureEntrySchema).max(4_096),
  }),
  z.strictObject({
    ok: z.literal(true),
    sections: z.array(pluginManagerPluginSettingSectionSchema).max(128),
    diagnostics: z.array(pluginManagerPluginSettingDiagnosticSchema).max(128),
  }),
  z.strictObject({
    ok: z.literal(true),
    saved: z.literal(true),
  }),
  z.strictObject({
    ok: z.literal(true),
    control: z.literal('accepted'),
  }),
  z.strictObject({
    ok: z.literal(true),
    value: pluginUiStorageValueSchema.nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    executed: z.literal(true),
  }),
  z.strictObject({
    ok: z.literal(true),
    search: z.strictObject({
      items: z.array(assetSummarySchema).max(256),
      total: z.number().int().nonnegative(),
      offset: z.number().int().nonnegative(),
      snippets: z.array(z.strictObject({
        assetId: z.string().min(1).max(255),
        text: z.string().min(1).max(4_096),
      })).optional(),
      degradedProviders: z.array(pluginLocalIdSchema).max(128),
    }),
  }),
  z.strictObject({
    ok: z.literal(true),
    media: pluginManagerMediaProviderResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    metadata: pluginManagerMetadataProviderResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    import: pluginManagerImportProviderResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    export: pluginManagerExportProviderResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    ai: pluginManagerAiProviderResultSchema,
  }),
  pluginManagerErrorResponseSchema,
]);
export type PluginManagerResponse = z.infer<typeof pluginManagerResponseSchema>;

export function parsePluginManagerResponse(input: unknown): PluginManagerResponse {
  return pluginManagerResponseSchema.parse(input);
}

/** Narrow preload API; it intentionally has no filesystem or Electron access. */
export interface SerpentPluginManagerApi {
  request(input: PluginManagerRequest): Promise<PluginManagerResponse>;
  /** Main → Renderer request to host a plugin modal dialog (Serpent-a3de58). */
  onPluginUiDialogRequest?(listener: (request: PluginUiDialogRequestPayload) => void): () => void;
  resolvePluginUiDialog?(input: { requestId: string; result: unknown | null }): void;
  onInstallProgress?(listener: (event: PluginInstallProgress) => void): () => void;
  listPluginContributions(input: {
    libraryId?: string;
    target?: PluginHostContributionTarget;
  }): Promise<Extract<PluginManagerResponse, { contributions: unknown }> | PluginManagerErrorResponse>;
  runPluginCommand(input: Extract<PluginManagerRequest, { type: 'plugin-manager.run-command' }>): Promise<
    Extract<PluginManagerResponse, { executed: true }> | PluginManagerErrorResponse
  >;
  searchProviders(input: Extract<PluginManagerRequest, { type: 'plugin-manager.search-providers' }>): Promise<
    Extract<PluginManagerResponse, { search: unknown }> | PluginManagerErrorResponse
  >;
  previewProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.preview-provider' }>): Promise<
    Extract<PluginManagerResponse, { media: unknown }> | PluginManagerErrorResponse
  >;
  thumbnailProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.thumbnail-provider' }>): Promise<
    Extract<PluginManagerResponse, { media: unknown }> | PluginManagerErrorResponse
  >;
  metadataProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.metadata-provider' }>): Promise<
    Extract<PluginManagerResponse, { metadata: unknown }> | PluginManagerErrorResponse
  >;
  importProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.import-provider' }>): Promise<
    Extract<PluginManagerResponse, { import: unknown }> | PluginManagerErrorResponse
  >;
  exportProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.export-provider' }>): Promise<
    Extract<PluginManagerResponse, { export: unknown }> | PluginManagerErrorResponse
  >;
  aiProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.ai-provider' }>): Promise<
    Extract<PluginManagerResponse, { ai: unknown }> | PluginManagerErrorResponse
  >;
  /** Subscribe to Main contribution registry changes (enable/disable/install/refresh). */
  onContributionsChanged?(listener: (event: {
    libraryId: string | null;
    requestType: string;
  }) => void): () => void;
}
