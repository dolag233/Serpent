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
    const deactivated: string[] = [];
    const crashed: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async (commandId, input) => {
        commands.push({ commandId, input });
        return { ok: true, commandId };
      },
      onInstanceDeactivated: (instanceId) => deactivated.push(instanceId),
      onInstanceCrashed: ({ instanceId }) => crashed.push(instanceId),
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
      entryJavaScript: 'async function setup() {}',
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

    supervisor.deactivate('11111111-1111-4111-8111-111111111111', 'library-closed');
    expect(deactivated).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(crashed).toEqual([]);
    supervisor.shutdown();
    expect(child.killCount).toBe(1);
  });

  it('kills the host and records HEARTBEAT_TIMEOUT when heartbeats stop', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeRuntimeChild();
      const crashes: Array<{ pluginId: string; failureCode: string }> = [];
      const lifecycle: string[] = [];
      let now = 1_000;
      const supervisor = new PluginRuntimeSupervisor({
        modulePath: '/safe/plugin_standard_host.js',
        fork: () => child,
        executeHostCommand: async () => ({}),
        onCrash: (crash) => {
          lifecycle.push('crash');
          crashes.push({ pluginId: crash.pluginId, failureCode: crash.failureCode });
        },
        onInstanceCrashed: () => lifecycle.push('cleanup'),
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
      entryJavaScript: 'async function setup() {}',
        installScope: 'library',
        permissions: ['library.read'],
      });

      now = 1_200;
      await vi.advanceTimersByTimeAsync(60);
      expect(child.killCount).toBe(1);
      expect(crashes).toEqual([{ pluginId: 'com.example.demo', failureCode: 'HEARTBEAT_TIMEOUT' }]);
      expect(lifecycle).toEqual(['crash', 'cleanup']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies instance cleanup after activation failure', async () => {
    const child = new FakeRuntimeChild();
    const events: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onCrash: ({ failureCode }) => events.push(`crash:${failureCode}`),
      onInstanceCrashed: ({ instanceId, failureCode }) => {
        events.push(`cleanup:${instanceId}:${failureCode}`);
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
      entryJavaScript: 'async function setup() {}',
      permissions: ['library.read'],
    });

    child.emit('message', {
      type: 'plugin-runtime.activation-failed',
      instanceId: '11111111-1111-4111-8111-111111111111',
      code: 'ACTIVATE_REJECTED',
      message: 'setup rejected',
    } as never);

    expect(events).toEqual([
      'crash:ACTIVATE_REJECTED',
      'cleanup:11111111-1111-4111-8111-111111111111:ACTIVATE_REJECTED',
    ]);
    supervisor.shutdown();
  });

  it('notifies instance cleanup after an unexpected host exit', async () => {
    const child = new FakeRuntimeChild();
    const events: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onCrash: ({ failureCode }) => events.push(`crash:${failureCode}`),
      onInstanceCrashed: ({ failureCode }) => events.push(`cleanup:${failureCode}`),
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
      entryJavaScript: 'async function setup() {}',
      permissions: ['library.read'],
    });

    child.emit('exit', 1 as never);

    expect(events).toEqual([
      'crash:RUNTIME_PROCESS_EXITED',
      'cleanup:RUNTIME_PROCESS_EXITED',
    ]);
  });
});
