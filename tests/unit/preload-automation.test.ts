import { ipcRenderer } from 'electron';
import { expect, test, vi } from 'vitest';

import { automation } from '../../src/preload/bridge/automation';
import {
  AUTOMATION_SCRIPT_COMMAND_CHANNEL,
  AUTOMATION_SCRIPT_OPEN_CHANNEL,
} from '../../src/shared/protocol/channels';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

test('automation.open uses the owned file-open channel', async () => {
  vi.mocked(ipcRenderer.invoke).mockResolvedValue({ ok: false, code: 'cancelled' });
  await expect(automation.open()).resolves.toEqual({ ok: false, code: 'cancelled' });
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(AUTOMATION_SCRIPT_OPEN_CHANNEL);
});

test('automation.command rejects a malformed Main payload', async () => {
  vi.mocked(ipcRenderer.invoke).mockResolvedValue(null);
  await expect(
    automation.command({
      executionId: 'exec-1',
      commandId: 'ui.notify',
      input: {},
    }),
  ).rejects.toThrow('Main returned an invalid automation command result.');
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(
    AUTOMATION_SCRIPT_COMMAND_CHANNEL,
    {
      executionId: 'exec-1',
      commandId: 'ui.notify',
      input: {},
    },
  );
});
