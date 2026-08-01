import { describe, expect, it, vi } from 'vitest';

import { PluginRuntimeSupervisor } from '../../src/main/plugin-runtime-supervisor';
import type { PluginRuntimeChildMessage } from '../../src/shared/plugin-runtime-utility-protocol';

type Listener = (...args: never[]) => void;

class FakeRuntimeChild {
  readonly posted: unknown[] = [];
  killCount = 0;
  readonly pid = 99;
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

describe('PluginRuntimeSupervisor', () => {
  it('forks once, activates an instance, and brokers host commands', async () => {
    const child = new FakeRuntimeChild();
    const commands: Array<{ commandId: string; input: unknown }> = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async (commandId, input) => {
        commands.push({ commandId, input });
        return { ok: true, commandId };
      },
    });

    const ready = supervisor.ensureHostRunning();
    child.emit('message', { type: 'plugin-runtime.ready' } as never);
    await ready;

    await supervisor.activate({
      instanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-1',
      libraryDirectory: '/tmp/library',
      pluginId: 'com.example.demo',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      entryJavaScript: 'async function activate() {}',
      permissions: ['library.read', 'asset.read'],
      installScope: 'library',
    });

    expect(child.posted).toContainEqual(expect.objectContaining({
      type: 'plugin-runtime.activate',
      instanceId: '11111111-1111-4111-8111-111111111111',
      pluginId: 'com.example.demo',
    }));

    const hostCommand: Extract<PluginRuntimeChildMessage, { type: 'plugin-runtime.host-command' }> = {
      type: 'plugin-runtime.host-command',
      instanceId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
      commandId: 'asset.search',
      input: { query: null },
    };
    child.emit('message', hostCommand as never);
    await flush();
    expect(commands).toEqual([{ commandId: 'asset.search', input: { query: null } }]);
    expect(child.posted).toContainEqual({
      type: 'plugin-runtime.host-result',
      instanceId: hostCommand.instanceId,
      requestId: hostCommand.requestId,
      ok: true,
      result: { ok: true, commandId: 'asset.search' },
    });

    supervisor.shutdown();
    expect(child.killCount).toBe(1);
  });

  it('kills the host and records HEARTBEAT_TIMEOUT when heartbeats stop', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeRuntimeChild();
      const crashes: Array<{ pluginId: string; failureCode: string }> = [];
      let now = 1_000;
      const supervisor = new PluginRuntimeSupervisor({
        modulePath: '/safe/plugin_standard_host.js',
        fork: () => child,
        executeHostCommand: async () => ({}),
        onCrash: (crash) => {
          crashes.push({ pluginId: crash.pluginId, failureCode: crash.failureCode });
        },
        heartbeatTimeoutMs: 100,
        heartbeatCheckIntervalMs: 50,
        now: () => now,
      });

      const ready = supervisor.ensureHostRunning();
      child.emit('message', { type: 'plugin-runtime.ready' } as never);
      await ready;
      await supervisor.activate({
        instanceId: '11111111-1111-4111-8111-111111111111',
        libraryId: 'library-1',
        libraryDirectory: '/tmp/library',
        pluginId: 'com.example.demo',
        version: '1.0.0',
        packageHash: 'a'.repeat(64),
        entryJavaScript: 'async function activate() {}',
        installScope: 'library',
        permissions: ['library.read'],
      });

      now = 1_200;
      await vi.advanceTimersByTimeAsync(60);
      expect(child.killCount).toBe(1);
      expect(crashes).toEqual([{ pluginId: 'com.example.demo', failureCode: 'HEARTBEAT_TIMEOUT' }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
