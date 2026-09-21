import { ipcRenderer } from 'electron';

import { pluginInstallProgressSchema, type PluginInstallProgress } from '../../shared/plugin-install-progress';
import {
  parsePluginManagerResponse,
  type PluginHostContributionTarget,
  type PluginManagerRequest,
  type PluginManagerResponse,
  type SerpentPluginManagerApi,
} from '../../shared/plugin-manager-api';
import {
  PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL,
  PLUGIN_INSTALL_PROGRESS_CHANNEL,
  PLUGIN_MANAGER_CHANNEL,
} from '../../shared/protocol/channels';
import {
  PLUGIN_UI_DIALOG_PATCH_CHANNEL,
  PLUGIN_UI_DIALOG_REQUEST_CHANNEL,
  PLUGIN_UI_DIALOG_RESULT_CHANNEL,
  PLUGIN_UI_WIDGET_EVENT_CHANNEL,
  pluginUiDialogPatchPayloadSchema,
  pluginUiDialogRequestPayloadSchema,
  pluginUiDialogResultPayloadSchema,
  pluginUiWidgetEventPayloadSchema,
  type PluginUiDialogPatchPayload,
  type PluginUiDialogRequestPayload,
  type PluginUiWidgetEventPayload,
} from '../../shared/plugin-ui-dialog-bridge';

export const plugins: SerpentPluginManagerApi = Object.freeze({
  async request(input: PluginManagerRequest): Promise<PluginManagerResponse> {
    const raw = await ipcRenderer.invoke(PLUGIN_MANAGER_CHANNEL, input);
    try {
      return parsePluginManagerResponse(raw);
    } catch (error) {
      console.error('plugin-manager.response-invalid', error, raw);
      return { ok: false, code: 'operation-failed' };
    }
  },
  onInstallProgress(listener: (event: PluginInstallProgress) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const parsed = pluginInstallProgressSchema.safeParse(payload);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(PLUGIN_INSTALL_PROGRESS_CHANNEL, handler);
    return () => ipcRenderer.removeListener(PLUGIN_INSTALL_PROGRESS_CHANNEL, handler);
  },
  onPluginUiDialogRequest(listener: (input: PluginUiDialogRequestPayload) => void) {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = pluginUiDialogRequestPayloadSchema.safeParse(input);
      if (!parsed.success) return;
      listener(parsed.data);
    };
    ipcRenderer.on(PLUGIN_UI_DIALOG_REQUEST_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(PLUGIN_UI_DIALOG_REQUEST_CHANNEL, handler);
    };
  },
  onPluginUiDialogPatch(listener: (input: PluginUiDialogPatchPayload) => void) {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = pluginUiDialogPatchPayloadSchema.safeParse(input);
      if (!parsed.success) return;
      listener(parsed.data);
    };
    ipcRenderer.on(PLUGIN_UI_DIALOG_PATCH_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(PLUGIN_UI_DIALOG_PATCH_CHANNEL, handler);
    };
  },
  resolvePluginUiDialog(input: { requestId: string; result: unknown | null }): void {
    const parsed = pluginUiDialogResultPayloadSchema.safeParse(input);
    if (!parsed.success) return;
    ipcRenderer.send(PLUGIN_UI_DIALOG_RESULT_CHANNEL, parsed.data);
  },
  sendPluginUiWidgetEvent(input: PluginUiWidgetEventPayload): void {
    const parsed = pluginUiWidgetEventPayloadSchema.safeParse(input);
    if (!parsed.success) return;
    ipcRenderer.send(PLUGIN_UI_WIDGET_EVENT_CHANNEL, parsed.data);
  },
  async listPluginContributions(input: {
    libraryId?: string;
    target?: PluginHostContributionTarget;
  }) {
    const response = await this.request({
      type: 'plugin-manager.list-contributions',
      ...(input.libraryId === undefined ? {} : { libraryId: input.libraryId }),
      ...(input.target === undefined ? {} : { target: input.target }),
    });
    return 'contributions' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['listPluginContributions']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  async runPluginCommand(input: Extract<PluginManagerRequest, { type: 'plugin-manager.run-command' }>) {
    const response = await this.request(input);
    return 'executed' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['runPluginCommand']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  async searchProviders(input: Extract<PluginManagerRequest, { type: 'plugin-manager.search-providers' }>) {
    const response = await this.request(input);
    return 'search' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['searchProviders']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  async previewProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.preview-provider' }>) {
    const response = await this.request(input);
    return 'media' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['previewProvider']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  async thumbnailProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.thumbnail-provider' }>) {
    const response = await this.request(input);
    return 'media' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['thumbnailProvider']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  async metadataProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.metadata-provider' }>) {
    const response = await this.request(input);
    return 'metadata' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['metadataProvider']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  async importProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.import-provider' }>) {
    const response = await this.request(input);
    return 'import' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['importProvider']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  async exportProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.export-provider' }>) {
    const response = await this.request(input);
    return 'export' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['exportProvider']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  async aiProvider(input: Extract<PluginManagerRequest, { type: 'plugin-manager.ai-provider' }>) {
    const response = await this.request(input);
    return 'ai' in response || response.ok === false
      ? response as Awaited<ReturnType<SerpentPluginManagerApi['aiProvider']>>
      : { ok: false as const, code: 'operation-failed' as const };
  },
  onContributionsChanged(listener: (event: {
    libraryId: string | null;
    requestType: string;
  }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) return;
      const record = payload as { libraryId?: unknown; requestType?: unknown };
      listener({
        libraryId: typeof record.libraryId === 'string' ? record.libraryId : null,
        requestType: typeof record.requestType === 'string' ? record.requestType : 'unknown',
      });
    };
    ipcRenderer.on(PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL, handler);
    };
  },
});
