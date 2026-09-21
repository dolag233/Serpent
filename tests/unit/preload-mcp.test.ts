import { ipcRenderer } from 'electron';
import { expect, test, vi } from 'vitest';

import { mcp } from '../../src/preload/bridge/mcp';
import {
  MCP_SETTINGS_EVENT_CHANNEL,
  MCP_SETTINGS_REQUEST_CHANNEL,
} from '../../src/shared/protocol/channels';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

test('mcp.request uses the owned settings channel', async () => {
  vi.mocked(ipcRenderer.invoke).mockResolvedValue({
    ok: false,
    code: 'disabled',
    message: 'MCP is off.',
  });
  await expect(mcp.request({ type: 'get' })).resolves.toEqual({
    ok: false,
    code: 'disabled',
    message: 'MCP is off.',
  });
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(MCP_SETTINGS_REQUEST_CHANNEL, { type: 'get' });
});

test('mcp.onChanged subscribes to the settings event channel', () => {
  const unsubscribe = mcp.onChanged(() => undefined);
  expect(ipcRenderer.on).toHaveBeenCalledWith(MCP_SETTINGS_EVENT_CHANNEL, expect.any(Function));
  unsubscribe();
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
    MCP_SETTINGS_EVENT_CHANNEL,
    expect.any(Function),
  );
});
