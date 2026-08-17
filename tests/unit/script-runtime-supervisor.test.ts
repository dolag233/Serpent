import { describe, expect, it } from 'vitest';

import { ScriptRuntimeSupervisor } from '../../src/main/script-runtime-supervisor';
import { AutomationScriptHostCommandError } from '../../src/shared/automation-host-command-error';
import type { ScriptRuntimeChildMessage } from '../../src/shared/script-runtime-utility-protocol';

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

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('ScriptRuntimeSupervisor', () => {
  it('converts a synchronous UtilityProcess spawn failure into a runtime result', async () => {
    const supervisor = new ScriptRuntimeSupervisor({
      modulePath: '/safe/script-runtime-utility.js',
      fork: () => {
        throw new Error('spawn failed');
      },
    });

    await expect(supervisor.run({
      executionId: 'execution-spawn-failure',
      source: 'return 1;',
      host: { execute: async () => undefined },
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'RUNTIME_PROCESS_EXITED',
        message: 'The isolated script runtime could not start.',
      },
    });
  });

  it('waits for the isolated child, brokers a declared command, then terminates that one child', async () => {
    const child = new FakeRuntimeChild();
    const supervisor = new ScriptRuntimeSupervisor({
      modulePath: '/safe/script-runtime-utility.js',
      fork: () => child,
    });
    const execution = supervisor.run({
      executionId: 'execution-a',
      source: 'return 1;',
      host: { execute: async (commandId, input) => ({ commandId, input, ok: true }) },
    });

    child.emit('message', { type: 'script-runtime.ready' } as never);
    expect(child.posted).toContainEqual({ type: 'script-runtime.run', executionId: 'execution-a', source: 'return 1;' });
    const hostCommand: Extract<ScriptRuntimeChildMessage, { type: 'script-runtime.host-command' }> = {
      type: 'script-runtime.host-command',
      executionId: 'execution-a',
      requestId: 'ad4d0ff9-6d9d-4c5f-9167-206a42eb3e25',
      commandId: 'asset.search',
      input: { query: 'Ser' },
    };
    child.emit('message', hostCommand as never);
    await flush();
    expect(child.posted).toContainEqual({
      type: 'script-runtime.host-result',
      executionId: 'execution-a',
      requestId: hostCommand.requestId,
      ok: true,
      result: { commandId: 'asset.search', input: { query: 'Ser' }, ok: true },
    });
    child.emit('message', {
      type: 'script-runtime.completed',
      executionId: 'execution-a',
      value: 42,
      output: [],
      transpiledJavaScript: 'return 42;',
    } as never);

    await expect(execution).resolves.toEqual({
      ok: true,
      value: 42,
      output: [],
      transpiledJavaScript: 'return 42;',
    });
    expect(child.killCount).toBe(1);
  });

  it('kills an unresponsive child on cancellation and ignores late child messages', async () => {
    const child = new FakeRuntimeChild();
    const controller = new AbortController();
    const supervisor = new ScriptRuntimeSupervisor({ modulePath: '/safe/script-runtime-utility.js', fork: () => child });
    const execution = supervisor.run({
      executionId: 'execution-b',
      source: 'return await serpent.assets.search({ query: "wait" });',
      signal: controller.signal,
      host: { execute: async () => ({ items: [] }) },
    });
    child.emit('message', { type: 'script-runtime.ready' } as never);
    controller.abort();
    child.emit('message', {
      type: 'script-runtime.completed',
      executionId: 'execution-b',
      value: 'late',
      output: [],
      transpiledJavaScript: '',
    } as never);

    await expect(execution).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(child.posted).toContainEqual({ type: 'script-runtime.abort', executionId: 'execution-b' });
    expect(child.killCount).toBe(1);
  });

  it('forwards a marked Gateway failure through the host-result envelope', async () => {
    const child = new FakeRuntimeChild();
    const supervisor = new ScriptRuntimeSupervisor({
      modulePath: '/safe/script-runtime-utility.js',
      fork: () => child,
    });
    const execution = supervisor.run({
      executionId: 'execution-host-failure',
      source: 'return await serpent.assets.search({ query: null });',
      host: {
        execute: async () => {
          throw new AutomationScriptHostCommandError({
            code: 'AUTOMATION_CAPABILITY_DENIED',
            message: 'The automation execution has not been granted the required capability.',
          });
        },
      },
    });
    child.emit('message', { type: 'script-runtime.ready' } as never);
    child.emit('message', {
      type: 'script-runtime.host-command',
      executionId: 'execution-host-failure',
      requestId: 'ad4d0ff9-6d9d-4c5f-9167-206a42eb3e25',
      commandId: 'asset.search',
      input: { query: null },
    } as never);
    await flush();
    expect(child.posted).toContainEqual({
      type: 'script-runtime.host-result',
      executionId: 'execution-host-failure',
      requestId: 'ad4d0ff9-6d9d-4c5f-9167-206a42eb3e25',
      ok: false,
      error: {
        code: 'AUTOMATION_CAPABILITY_DENIED',
        message: 'The automation execution has not been granted the required capability.',
      },
    });
    child.emit('message', {
      type: 'script-runtime.completed',
      executionId: 'execution-host-failure',
      value: null,
      output: [],
      transpiledJavaScript: '',
    } as never);
    await expect(execution).resolves.toMatchObject({ ok: true });
  });
});
