import { ipcRenderer } from 'electron';
import { expect, test, vi } from 'vitest';

import { plugins } from '../../src/preload/bridge/plugins';
import {
  PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL,
  PLUGIN_MANAGER_CHANNEL,
} from '../../src/shared/protocol/channels';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

test('plugins.request maps an invalid Main payload to operation-failed', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(ipcRenderer.invoke).mockResolvedValue({ not: 'a-plugin-response' });
  await expect(plugins.request({ type: 'plugin-manager.list' })).resolves.toEqual({
    ok: false,
    code: 'operation-failed',
  });
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(PLUGIN_MANAGER_CHANNEL, {
    type: 'plugin-manager.list',
  });
  expect(error).toHaveBeenCalledWith(
    'plugin-manager.response-invalid',
    expect.anything(),
    { not: 'a-plugin-response' },
  );
  error.mockRestore();
});

test('plugins.listPluginContributions keeps the owned request type', async () => {
  vi.mocked(ipcRenderer.invoke).mockResolvedValue({ ok: false, code: 'library-not-open' });
  await expect(plugins.listPluginContributions({})).resolves.toEqual({
    ok: false,
    code: 'library-not-open',
  });
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(PLUGIN_MANAGER_CHANNEL, {
    type: 'plugin-manager.list-contributions',
  });
});

test('plugins.onContributionsChanged subscribes to the owned channel', () => {
  const subscribe = plugins.onContributionsChanged;
  if (subscribe === undefined) {
    throw new Error('onContributionsChanged is part of the frozen preload plugins API.');
  }
  const unsubscribe = subscribe(() => undefined);
  expect(ipcRenderer.on).toHaveBeenCalledWith(
    PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL,
    expect.any(Function),
  );
  unsubscribe();
  expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
    PLUGIN_CONTRIBUTIONS_CHANGED_CHANNEL,
    expect.any(Function),
  );
});
