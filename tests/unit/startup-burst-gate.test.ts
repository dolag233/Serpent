import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STARTUP_BURST_MAX_WAIT_MS,
  StartupBurstGateRegistry,
} from '../../src/worker/startup-burst-gate';

afterEach(() => {
  vi.useRealTimers();
});

describe('StartupBurstGateRegistry', () => {
  it('keeps libraries and generations isolated', async () => {
    const registry = new StartupBurstGateRegistry();
    const alpha = registry.open('alpha', 1);
    const beta = registry.open('beta', 1);
    const alphaWait = registry.waitForDrain(alpha);
    const betaWait = registry.waitForDrain(beta);

    registry.finishOpenResponse(alpha);
    registry.finishCommand({
      libraryId: 'alpha',
      generation: 1,
      commandType: 'asset.search',
      servedSuccessfully: true,
    });
    await expect(alphaWait).resolves.toBeUndefined();
    let betaSettled = false;
    void betaWait.then(() => { betaSettled = true; });
    await Promise.resolve();
    expect(betaSettled).toBe(false);

    registry.finishOpenResponse(beta);
    registry.finishCommand({
      libraryId: 'beta',
      generation: 1,
      commandType: 'folder.browse-entries',
      servedSuccessfully: true,
    });
    await expect(betaWait).resolves.toBeUndefined();
  });

  it('does not let an old generation release a newer gate', async () => {
    const registry = new StartupBurstGateRegistry();
    const oldToken = registry.open('library', 1);
    registry.finishOpenResponse(oldToken);
    registry.cancel('library', 'closed');
    const newToken = registry.open('library', 2);
    registry.beginCommand('library', 1);
    const wait = registry.waitForDrain(newToken);

    registry.finishCommand({
      libraryId: 'library',
      generation: 1,
      commandType: 'asset.search',
      servedSuccessfully: true,
    });
    registry.finishOpenResponse(newToken);
    let settled = false;
    void wait.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    registry.beginCommand('library', 2);
    registry.finishCommand({
      libraryId: 'library',
      generation: 2,
      commandType: 'asset.search',
      servedSuccessfully: true,
    });
    await expect(wait).resolves.toBeUndefined();
  });

  it('cancels waiters without affecting another library', async () => {
    const registry = new StartupBurstGateRegistry();
    const alpha = registry.open('alpha', 1);
    const beta = registry.open('beta', 1);
    const alphaWait = registry.waitForDrain(alpha);
    const betaWait = registry.waitForDrain(beta);

    registry.cancel('alpha', 'library closed');
    await expect(alphaWait).rejects.toThrow('library closed');

    registry.finishOpenResponse(beta);
    registry.finishCommand({
      libraryId: 'beta',
      generation: 1,
      commandType: 'asset.search',
      servedSuccessfully: true,
    });
    await expect(betaWait).resolves.toBeUndefined();
  });

  it('releases every waiter at the hard cap and leaves the gate in normal mode', async () => {
    vi.useFakeTimers();
    const registry = new StartupBurstGateRegistry();
    const token = registry.open('library', 1);
    const first = registry.waitForDrain(token);
    const second = registry.waitForDrain(token);

    vi.advanceTimersByTime(STARTUP_BURST_MAX_WAIT_MS);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(registry.isBrowseServed('library')).toBe(true);
  });

  it('requires a successful browse response and waits for the library command count', async () => {
    const registry = new StartupBurstGateRegistry();
    const token = registry.open('library', 1);
    registry.beginCommand('library', 1);
    const wait = registry.waitForDrain(token);
    registry.finishOpenResponse(token);
    registry.finishCommand({
      libraryId: 'library',
      generation: 1,
      commandType: 'asset.search',
      servedSuccessfully: false,
    });
    let settled = false;
    void wait.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    registry.beginCommand('library', 1);
    registry.finishCommand({
      libraryId: 'library',
      generation: 1,
      commandType: 'asset.search',
      servedSuccessfully: true,
    });
    await expect(wait).resolves.toBeUndefined();
  });
});
