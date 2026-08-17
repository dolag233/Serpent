import { describe, expect, it, vi } from 'vitest';

import { PluginTrustedRuntimeSupervisor } from '../../src/main/plugin-trusted-runtime-supervisor';
import { PluginHostCommandError } from '../../src/shared/plugin-host-command-error';
import type { PluginTrustedChildMessage } from '../../src/shared/plugin-trusted-runtime-protocol';
import type { PluginJobRecord } from '../../src/plugins/plugin-jobs';

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

function createJob(jobId: string, ownerPluginId = 'com.example.trusted-jobs'): PluginJobRecord {
  return {
    jobId,
    libraryId: 'library-1', kind: 'plugin.background', status: 'running', progress: 0,
    attemptCount: 1, errorCode: null, errorDetail: null, ownerPluginId,
    ownerPackageHash: 'a'.repeat(64), pluginHandlerId: 'handler', payload: {}, recoveryStrategy: 'idempotent',
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
  } as PluginJobRecord;
}

async function activateTrustedInstance(
  supervisor: PluginTrustedRuntimeSupervisor,
  child: FakeRuntimeChild,
  instanceId: string,
): Promise<void> {
  const activation = supervisor.activate({
    instanceId,
    libraryId: 'library-1',
    libraryDirectory: '/tmp/library',
    pluginId: 'com.example.trusted',
    version: '1.0.0',
    packageHash: 'a'.repeat(64),
    packageDirectory: '/plugins/trusted',
    entryRelativePath: 'dist/main.js',
    permissions: ['job.manage'],
  });
  child.emit('message', { type: 'plugin-trusted.ready' } as never);
  await flush();
  child.emit('message', {
    type: 'plugin-trusted.activated',
    instanceId,
    pluginId: 'com.example.trusted',
    packageHash: 'a'.repeat(64),
  } as never);
  await activation;
}

describe('PluginTrustedRuntimeSupervisor', () => {
  it('forks one child per trusted instance and brokers host commands', async () => {
    const child = new FakeRuntimeChild();
    const commands: Array<{ commandId: string; targetLibraryId?: string }> = [];
    const deactivated: string[] = [];
    const crashed: string[] = [];
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async (commandId, _input, context) => {
        commands.push({ commandId, ...(context.targetLibraryId === undefined ? {} : { targetLibraryId: context.targetLibraryId }) });
        return { ok: true };
      },
      onInstanceDeactivated: (instanceId) => deactivated.push(instanceId),
      onInstanceCrashed: ({ instanceId }) => crashed.push(instanceId),
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
      targetLibraryId: 'library-2',
    };
    child.emit('message', hostCommand as never);
    await flush();
    expect(commands).toEqual([{ commandId: 'asset.search', targetLibraryId: 'library-2' }]);

    supervisor.deactivate('11111111-1111-4111-8111-111111111111', 'library-closed');
    child.emit('message', {
      type: 'plugin-trusted.deactivated',
      instanceId: '11111111-1111-4111-8111-111111111111',
      reason: 'library-closed',
    } as never);
    expect(child.killCount).toBe(1);
    expect(deactivated).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(crashed).toEqual([]);
  });

  it('returns a marked Gateway failure instead of hiding it as HOST_COMMAND_FAILED', async () => {
    const child = new FakeRuntimeChild();
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async () => {
        throw new PluginHostCommandError('CANCELLED', 'The request was cancelled.');
      },
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateTrustedInstance(supervisor, child, instanceId);
    const hostCommand: Extract<PluginTrustedChildMessage, { type: 'plugin-trusted.host-command' }> = {
      type: 'plugin-trusted.host-command',
      instanceId,
      requestId: '22222222-2222-4222-8222-222222222222',
      commandId: 'asset.content.replace-batch',
      input: { items: [] },
    };
    child.emit('message', hostCommand as never);
    await flush();
    expect(child.posted).toContainEqual({
      type: 'plugin-trusted.host-result',
      instanceId,
      requestId: hostCommand.requestId,
      ok: false,
      error: { code: 'CANCELLED', message: 'The request was cancelled.' },
    });
    supervisor.shutdown();
  });

  it('routes owned trusted job progress with an explicit target library', async () => {
    const child = new FakeRuntimeChild();
    const progress: unknown[] = [];
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      handleJobProgress: async (input) => { progress.push(input); },
    });
    const instanceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const activation = supervisor.activate({
      instanceId,
      libraryId: '__serpent_global_runtime__',
      instanceScope: 'global',
      libraryDirectory: '__serpent_global_runtime__',
      pluginId: 'com.example.trusted-jobs',
      version: '1.0.0',
      packageHash: 'f'.repeat(64),
      packageDirectory: '/plugins/trusted',
      entryRelativePath: 'dist/main.js',
      permissions: ['job.manage'],
    });
    child.emit('message', { type: 'plugin-trusted.ready' } as never);
    await flush();
    child.emit('message', {
      type: 'plugin-trusted.activated',
      instanceId,
      pluginId: 'com.example.trusted-jobs',
      packageHash: 'f'.repeat(64),
    } as never);
    await activation;
    const job = {
      jobId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      libraryId: 'library-2', kind: 'plugin.background', status: 'running', progress: 0,
      attemptCount: 1, errorCode: null, errorDetail: null, ownerPluginId: 'com.example.trusted-jobs',
      ownerPackageHash: 'f'.repeat(64), pluginHandlerId: 'tick', payload: {}, recoveryStrategy: 'idempotent',
      createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    } as PluginJobRecord;
    const completion = supervisor.invokeJob({ instanceId, job });
    child.emit('message', {
      type: 'plugin-trusted.job-progress',
      instanceId,
      jobId: job.jobId,
      targetLibraryId: 'library-2',
      progress: { completed: 1, total: 2, phase: 'read', message: 'half' },
    } as never);
    await flush();
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ targetLibraryId: 'library-2' });
    child.emit('message', {
      type: 'plugin-trusted.job-complete', instanceId, jobId: job.jobId, status: 'succeeded', progress: 1,
    } as never);
    await completion;
    supervisor.shutdown();
  });

  it('kills a trusted host and records HEARTBEAT_TIMEOUT when heartbeats stop', async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeRuntimeChild();
      const crashes: Array<{ pluginId: string; failureCode: string }> = [];
      const lifecycle: string[] = [];
      let now = 1_000;
      const supervisor = new PluginTrustedRuntimeSupervisor({
        modulePath: '/safe/plugin_trusted_host.js',
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
      expect(lifecycle).toEqual(['crash', 'cleanup']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies instance cleanup after activation failure', async () => {
    const child = new FakeRuntimeChild();
    const events: string[] = [];
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onCrash: ({ failureCode }) => events.push(`crash:${failureCode}`),
      onInstanceCrashed: ({ instanceId, failureCode }) => {
        events.push(`cleanup:${instanceId}:${failureCode}`);
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
      permissions: ['library.read'],
    });
    child.emit('message', { type: 'plugin-trusted.ready' } as never);
    await Promise.resolve();
    child.emit('message', {
      type: 'plugin-trusted.activation-failed',
      instanceId: '11111111-1111-4111-8111-111111111111',
      code: 'ACTIVATE_REJECTED',
      message: 'setup rejected',
    } as never);

    await expect(activation).rejects.toThrow('setup rejected');
    expect(events).toEqual([
      'crash:ACTIVATE_REJECTED',
      'cleanup:11111111-1111-4111-8111-111111111111:ACTIVATE_REJECTED',
    ]);
  });

  it('notifies instance cleanup after an unexpected host exit', async () => {
    const child = new FakeRuntimeChild();
    const events: string[] = [];
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onCrash: ({ failureCode }) => events.push(`crash:${failureCode}`),
      onInstanceCrashed: ({ failureCode }) => events.push(`cleanup:${failureCode}`),
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

    child.emit('exit');

    expect(events).toEqual([
      'crash:RUNTIME_PROCESS_EXITED',
      'cleanup:RUNTIME_PROCESS_EXITED',
    ]);
  });

  it('ignores unknown non-critical events and isolates a critical event per child', async () => {
    const first = new FakeRuntimeChild();
    const second = new FakeRuntimeChild();
    const children = [first, second];
    const crashes: string[] = [];
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => children.shift() ?? new FakeRuntimeChild(),
      executeHostCommand: async () => ({}),
      onInstanceCrashed: ({ instanceId, failureCode }) => crashes.push(`${instanceId}:${failureCode}`),
    });
    const activate = async (child: FakeRuntimeChild, instanceId: string, pluginId: string) => {
      const activation = supervisor.activate({
        instanceId,
        libraryId: 'library-1',
        libraryDirectory: '/tmp/library',
        pluginId,
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
        instanceId,
        pluginId,
        packageHash: 'a'.repeat(64),
      } as never);
      await activation;
    };
    await activate(first, '11111111-1111-4111-8111-111111111111', 'com.example.one');
    await activate(second, '22222222-2222-4222-8222-222222222222', 'com.example.two');

    first.emit('message', {
      type: 'plugin-trusted.event',
      instanceId: '11111111-1111-4111-8111-111111111111',
      eventType: 'future.progress',
      critical: false,
      payload: {},
    } as never);
    expect(crashes).toEqual([]);
    expect(first.killCount).toBe(0);

    first.emit('message', {
      type: 'plugin-trusted.control.future',
      instanceId: '11111111-1111-4111-8111-111111111111',
    } as never);
    expect(crashes).toEqual(['11111111-1111-4111-8111-111111111111:RUNTIME_PROTOCOL_ERROR']);
    expect(first.killCount).toBe(1);
    expect(second.killCount).toBe(0);
    expect(supervisor.listActiveInstanceIds()).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  it('settles pending jobs when a trusted runtime exits and ignores its late completion', async () => {
    const child = new FakeRuntimeChild();
    const crashes: string[] = [];
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onInstanceCrashed: ({ failureCode }) => crashes.push(failureCode),
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateTrustedInstance(supervisor, child, instanceId);

    const job = createJob('66666666-6666-4666-8666-666666666666');
    const completion = supervisor.invokeJob({ instanceId, job });
    child.emit('exit');

    await expect(completion).resolves.toMatchObject({
      complete: {
        jobId: job.jobId,
        status: 'failed',
        errorCode: 'PLUGIN_JOB_RUNTIME_PROCESS_EXITED',
      },
    });
    child.emit('message', {
      type: 'plugin-trusted.job-complete',
      instanceId,
      jobId: job.jobId,
      status: 'succeeded',
    } as never);
    expect(crashes).toEqual(['RUNTIME_PROCESS_EXITED']);
  });

  it('cancels pending jobs as soon as a trusted instance is deactivated', async () => {
    const child = new FakeRuntimeChild();
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateTrustedInstance(supervisor, child, instanceId);

    const job = createJob('77777777-7777-4777-8777-777777777777');
    const completion = supervisor.invokeJob({ instanceId, job });
    supervisor.deactivate(instanceId, 'library-closed');

    await expect(completion).resolves.toMatchObject({
      complete: {
        jobId: job.jobId,
        status: 'cancelled',
        errorCode: 'PLUGIN_JOB_INSTANCE_DEACTIVATED',
      },
    });
    child.emit('message', {
      type: 'plugin-trusted.deactivated',
      instanceId,
      reason: 'library-closed',
    } as never);
    child.emit('message', {
      type: 'plugin-trusted.job-complete',
      instanceId,
      jobId: job.jobId,
      status: 'succeeded',
    } as never);
  });

  it('fails pending jobs when a trusted runtime protocol fault isolates their instance', async () => {
    const child = new FakeRuntimeChild();
    const crashes: string[] = [];
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onInstanceCrashed: ({ failureCode }) => crashes.push(failureCode),
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateTrustedInstance(supervisor, child, instanceId);

    const job = createJob('88888888-8888-4888-8888-888888888888');
    const completion = supervisor.invokeJob({ instanceId, job });
    child.emit('message', {
      type: 'plugin-trusted.control.future',
      instanceId,
    } as never);

    await expect(completion).resolves.toMatchObject({
      complete: {
        jobId: job.jobId,
        status: 'failed',
        errorCode: 'PLUGIN_JOB_RUNTIME_PROTOCOL_ERROR',
      },
    });
    expect(crashes).toEqual(['RUNTIME_PROTOCOL_ERROR']);
    child.emit('message', {
      type: 'plugin-trusted.job-complete',
      instanceId,
      jobId: job.jobId,
      status: 'succeeded',
    } as never);
    expect(crashes).toEqual(['RUNTIME_PROTOCOL_ERROR']);
  });

  it('settles the source instance when a trusted fault carries a stale instance id', async () => {
    const child = new FakeRuntimeChild();
    const supervisor = new PluginTrustedRuntimeSupervisor({
      modulePath: '/safe/plugin_trusted_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateTrustedInstance(supervisor, child, instanceId);

    const job = createJob('99999999-9999-4999-8999-999999999999');
    const completion = supervisor.invokeJob({ instanceId, job });
    child.emit('message', {
      type: 'plugin-trusted.control.future',
      instanceId: '22222222-2222-4222-8222-222222222222',
    } as never);

    await expect(completion).resolves.toMatchObject({
      complete: {
        jobId: job.jobId,
        status: 'failed',
        errorCode: 'PLUGIN_JOB_RUNTIME_PROTOCOL_ERROR',
      },
    });
  });
});
