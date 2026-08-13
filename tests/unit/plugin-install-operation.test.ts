import { describe, expect, it, vi } from 'vitest';

import { PluginInstallOperation } from '../../src/main/plugin-install-operation';

describe('PluginInstallOperation', () => {
  it('reports download progress and pauses until resumed', async () => {
    const events: Array<{ state: string; bytesDownloaded: number; phase: string }> = [];
    const operation = new PluginInstallOperation('install-1', (event) => {
      events.push({ state: event.state, bytesDownloaded: event.bytesDownloaded, phase: event.phase });
    });
    const options = operation.downloadOptions();
    options.onProgress?.({ bytesDownloaded: 12, totalBytes: 100 });
    operation.control('pause');
    let resumed = false;
    const waiting = operation.waitIfPaused().then(() => { resumed = true; });
    await Promise.resolve();
    expect(resumed).toBe(false);
    operation.control('resume');
    await waiting;
    expect(resumed).toBe(true);
    expect(events).toContainEqual({ state: 'paused', bytesDownloaded: 12, phase: 'downloading' });
    expect(events.at(-1)).toMatchObject({ state: 'running', bytesDownloaded: 12 });
  });

  it('aborts and wakes a paused download when stopped', async () => {
    const report = vi.fn();
    const operation = new PluginInstallOperation('install-2', report);
    operation.control('pause');
    const waiting = operation.waitIfPaused();
    operation.control('stop');
    await expect(waiting).rejects.toThrow('stopped');
    expect(operation.signal.aborted).toBe(true);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: 'install-2',
      state: 'stopped',
    }));
  });
});
