import { describe, expect, it } from 'vitest';

import { runPluginGuestActivate } from '../../src/scripting/plugin-guest-realm';
import { PluginRuntimeSupervisor } from '../../src/main/plugin-runtime-supervisor';

type Listener = (...args: never[]) => void;

class FakeRuntimeChild {
  readonly posted: unknown[] = [];
  killCount = 0;
  readonly pid = 42;
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

async function activateGuest(entryJavaScript: string, sandboxLimits?: {
  cpuTimeoutMs?: number;
  memoryLimitBytes?: number;
  maxOutputBytes?: number;
  maxPendingHostCalls?: number;
}) {
  return runPluginGuestActivate({
    entryJavaScript,
    executeAutomationCommand: async () => ({ items: [], total: 0, offset: 0, limit: 1, hasMore: false }),
    waitUntilDeactivate: async () => undefined,
    sandboxLimits,
  });
}

describe('standard plugin Host isolation (Serpent-upsn.3)', () => {
  it('does not expose process, require, env, filesystem, or network to activate()', async () => {
    const result = await activateGuest(`
      async function activate() {
        console.log(JSON.stringify({
          process: typeof process,
          require: typeof require,
          environment: typeof process === 'undefined' ? 'unavailable' : typeof process.env,
          filesystem: typeof require === 'undefined' ? 'unavailable' : typeof require('node:fs'),
          network: typeof fetch,
        }));
      }
      async function deactivate() {}
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const raw = result.output[0] ?? '{}';
    const once = JSON.parse(raw) as unknown;
    const probe = typeof once === 'string' ? JSON.parse(once) as Record<string, string> : once as Record<string, string>;
    expect(probe).toEqual({
      process: 'undefined',
      require: 'undefined',
      environment: 'unavailable',
      filesystem: 'unavailable',
      network: 'undefined',
    });
  });

  it('rejects dynamic import and Node module escapes during activate()', async () => {
    const dynamicImport = await activateGuest(`
      async function activate() {
        await import('node:fs');
      }
    `);
    expect(dynamicImport).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED' });

    const evalImport = await activateGuest(`
      async function activate() {
        eval("import('node:fs')");
      }
    `);
    expect(evalImport).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED' });
  });

  it('terminates infinite loops, memory floods, and output floods during activate()', async () => {
    const loop = await activateGuest(`
      async function activate() {
        while (true) {}
      }
    `, { cpuTimeoutMs: 20 });
    expect(loop).toMatchObject({ ok: false, code: 'CPU_TIMEOUT' });

    const memory = await activateGuest(`
      async function activate() {
        const values = [];
        while (true) values.push('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      }
    `, { memoryLimitBytes: 256 * 1024, cpuTimeoutMs: 500 });
    expect(memory).toMatchObject({ ok: false, code: 'MEMORY_LIMIT' });

    const output = await activateGuest(`
      async function activate(serpent) {
        console.log('x'.repeat(100));
      }
    `, { maxOutputBytes: 32 });
    expect(output).toMatchObject({ ok: false, code: 'OUTPUT_LIMIT' });
  });

  it('returns from supervisor.activate without waiting for guest activate completion', async () => {
    const child = new FakeRuntimeChild();
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      heartbeatTimeoutMs: 60_000,
      heartbeatCheckIntervalMs: 60_000,
    });

    const ready = supervisor.ensureHostRunning();
    child.emit('message', { type: 'plugin-runtime.ready' } as never);
    await ready;

    const started = Date.now();
    await supervisor.activate({
      instanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-1',
      libraryDirectory: '/tmp/library',
      pluginId: 'com.example.slow',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      entryJavaScript: 'async function activate() { await new Promise(() => {}); }',
      permissions: ['library.read'],
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(child.posted).toContainEqual(expect.objectContaining({
      type: 'plugin-runtime.activate',
      pluginId: 'com.example.slow',
    }));
    supervisor.shutdown();
  });
});
