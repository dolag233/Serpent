import { ipcRenderer } from 'electron';

import {
  mcpSettingsResponseSchema,
  mcpSettingsSnapshotSchema,
  type McpSettingsRequest,
  type McpSettingsSnapshot,
  type SerpentMcpSettingsApi,
} from '../../shared/mcp';
import {
  MCP_SETTINGS_EVENT_CHANNEL,
  MCP_SETTINGS_REQUEST_CHANNEL,
} from '../../shared/protocol/channels';

export const mcp: SerpentMcpSettingsApi = Object.freeze({
  async request(input: McpSettingsRequest) {
    return mcpSettingsResponseSchema.parse(
      await ipcRenderer.invoke(MCP_SETTINGS_REQUEST_CHANNEL, input),
    );
  },
  onChanged(listener: (snapshot: McpSettingsSnapshot) => void) {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = mcpSettingsSnapshotSchema.safeParse(input);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(MCP_SETTINGS_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(MCP_SETTINGS_EVENT_CHANNEL, handler);
  },
});
