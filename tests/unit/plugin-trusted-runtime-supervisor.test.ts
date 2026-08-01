import { describe, expect, it, vi } from 'vitest';

import { PluginTrustedRuntimeSupervisor } from '../../src/main/plugin-trusted-runtime-supervisor';
import type { PluginTrustedChildMessage } from '../../src/shared/plugin-trusted-runtime-protocol';

type Listener = (...args: never[]) => void;

class FakeRuntimeChild {
  readonly posted: unknown[] = [];
  killCount = 0;
  readonly pid = 77;
  #listeners = new Map<string, Set<Listener>>();

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  kill(): boolean {
    this.killCount += 1;
    return true;
  }

  on(event: string, listener: Listener): this {
    const listeners = this.#listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapped: Listener = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, listener: Listener): this {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: never[]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args);
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('PluginTrustedRuntimeSupervisor', () => {
  it('forks one child per trusted instance and brokers host commands', async () => {
    const child = new FakeRuntimeChild();
    const commands: Array<{ commandId: string }> = [];
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async (commandId) => {
        commands.push({ commandId });
        return { ok: true };
      },
    });

    const activation = supervisor.activate({
      instanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-1',
      libraryDirectory: '/tmp/library',
      pluginId: 'com.example.trusted',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      packageDirectory: '/plugins/trusted',
      entryRelativePath: 'dist/main.js',
      installScope: 'library',
      permissions: ['library.read', 'asset.read'],
    });
    child.emit('message', { type: 'plugin-trusted.ready' } as never);
    await flush();
    child.emit('message', {
      type: 'plugin-trusted.activated',
      instanceId: '11111111-1111-4111-8111-111111111111',
      pluginId: 'com.example.trusted',
      packageHash: 'a'.repeat(64),
    } as never);
    await activation;

    expect(child.posted).toContainEqual(expect.objectContaining({
      type: 'plugin-trusted.activate',
      packageDirectory: '/plugins/trusted',
      entryRelativePath: 'dist/main.js',
    }));

    const hostCommand: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.host-command' }> = {
      type: 'plugin-trusted.host-command',
      instanceId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
      commandId: 'asset.search',
      input: { query: null },
    };
    child.emit('message', hostCommand as never);
    await flush();
    expect(commands).toEqual([{ commandId: 'asset.search' }]);

    supervisor.deactivate('11111111-1111-4111-8111-111111111111', 'library-closed');
    expect(child.killCount).toBe(1);
  });

  it('kills a trusted host and records HEARTBEAT_TIMEOUT when heartbeats stop', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeRuntimeChild();
      const crashes: Array<{ pluginId: string; failureCode: string }> = [];
      let now = 1_000;
      const supervisor = new PluginTrustedRuntimeSupervisor({
        modulePath: '/safe/plugin_trusted_host.js',
        fork: () => child,
        executeHostCommand: async () => ({}),
        onCrash: (crash) => {
          crashes.push({ pluginId: crash.pluginId, failureCode: crash.failureCode });
        },
        heartbeatTimeoutMs: 100,
        heartbeatCheckIntervalMs: 50,
        now: () => now,
      });

      const activation = supervisor.activate({
        instanceId: '11111111-1111-4111-8111-111111111111',
        libraryId: 'library-1',
        libraryDirectory: '/tmp/library',
        pluginId: 'com.example.trusted',
        version: '1.0.0',
        packageHash: 'a'.repeat(64),
        packageDirectory: '/plugins/trusted',
        entryRelativePath: 'dist/main.js',
        installScope: 'library',
        permissions: ['library.read'],
      });
      child.emit('message', { type: 'plugin-trusted.ready' } as never);
      await Promise.resolve();
      child.emit('message', {
        type: 'plugin-trusted.activated',
        instanceId: '11111111-1111-4111-8111-111111111111',
        pluginId: 'com.example.trusted',
        packageHash: 'a'.repeat(64),
      } as never);
      await activation;

      now = 1_200;
      await vi.advanceTimersByTimeAsync(60);
      expect(child.killCount).toBe(1);
      expect(crashes).toEqual([{ pluginId: 'com.example.trusted', failureCode: 'HEARTBEAT_TIMEOUT' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
