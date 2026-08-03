import { describe, expect, it, vi } from 'vitest';

import { PluginRuntimeSupervisor } from '../../src/main/plugin-runtime-supervisor';
import { PluginHostCommandError } from '../../src/shared/plugin-host-command-error';
import type { PluginRuntimeChildMessage } from '../../src/shared/plugin-runtime-utility-protocol';
import type { PluginJobRecord } from '../../src/plugins/plugin-jobs';

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

function createJob(jobId: string, ownerPluginId = 'com.example.demo'): PluginJobRecord {
  return {
    jobId,
    libraryId: 'library-1', kind: 'plugin.background', status: 'running', progress: 0,
    attemptCount: 1, errorCode: null, errorDetail: null, ownerPluginId,
    ownerPackageHash: 'a'.repeat(64), pluginHandlerId: 'handler', payload: {}, recoveryStrategy: 'idempotent',
    createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
  } as PluginJobRecord;
}

async function activateStandardInstance(
  supervisor: PluginRuntimeSupervisor,
  child: FakeRuntimeChild,
  instanceId: string,
): Promise<void> {
  const ready = supervisor.ensureHostRunning();
  child.emit('message', { type: 'plugin-runtime.ready' } as never);
  await ready;
  const activation = supervisor.activate({
    instanceId,
    libraryId: 'library-1',
    libraryDirectory: '/tmp/library',
    pluginId: 'com.example.demo',
    version: '1.0.0',
    packageHash: 'a'.repeat(64),
    entryJavaScript: 'async function setup() {}',
    permissions: ['job.manage'],
  });
  await activation;
  child.emit('message', {
    type: 'plugin-runtime.activated',
    instanceId,
    pluginId: 'com.example.demo',
    packageHash: 'a'.repeat(64),
  } as never);
}

describe('PluginRuntimeSupervisor', () => {
  it('forks once, activates an instance, and brokers host commands', async () => {
    const child = new FakeRuntimeChild();
    const commands: Array<{ commandId: string; input: unknown; targetLibraryId?: string }> = [];
    const deactivated: string[] = [];
    const crashed: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async (commandId, input, context) => {
        commands.push({ commandId, input, ...(context.targetLibraryId === undefined ? {} : { targetLibraryId: context.targetLibraryId }) });
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
      targetLibraryId: 'library-2',
    };
    child.emit('message', hostCommand as never);
    await flush();
    expect(commands).toEqual([{ commandId: 'asset.search', input: { query: null }, targetLibraryId: 'library-2' }]);
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

  it('returns a marked Gateway failure instead of hiding it as HOST_COMMAND_FAILED', async () => {
    const child = new FakeRuntimeChild();
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => {
        throw new PluginHostCommandError(
          'AUTOMATION_CAPABILITY_DENIED',
          'The automation execution has not been granted the required capability.',
        );
      },
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateStandardInstance(supervisor, child, instanceId);
    const hostCommand: Extract<PluginRuntimeChildMessage, { type: 'plugin-runtime.host-command' }> = {
      type: 'plugin-runtime.host-command',
      instanceId,
      requestId: '22222222-2222-4222-8222-222222222222',
      commandId: 'asset.content.replace-batch',
      input: { items: [] },
    };
    child.emit('message', hostCommand as never);
    await flush();
    expect(child.posted).toContainEqual({
      type: 'plugin-runtime.host-result',
      instanceId,
      requestId: hostCommand.requestId,
      ok: false,
      error: {
        code: 'AUTOMATION_CAPABILITY_DENIED',
        message: 'The automation execution has not been granted the required capability.',
      },
    });
    supervisor.shutdown();
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

  it('ignores unknown non-critical events without affecting the shared Host', async () => {
    const child = new FakeRuntimeChild();
    const crashes: string[] = [];
    const logs: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onInstanceCrashed: ({ instanceId }) => crashes.push(instanceId),
      logger: {
        info: (scope) => logs.push(scope),
        error: () => undefined,
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
      type: 'plugin-runtime.event',
      instanceId: '11111111-1111-4111-8111-111111111111',
      eventType: 'future.progress',
      critical: false,
      payload: {},
    } as never);
    expect(child.killCount).toBe(0);
    expect(crashes).toEqual([]);
    expect(supervisor.listActiveInstanceIds()).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(logs).toContain('plugin.runtime.ignored-event');
    supervisor.shutdown();
  });

  it('isolates a critical event to one instance while preserving other instances', async () => {
    const child = new FakeRuntimeChild();
    const crashes: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onInstanceCrashed: ({ instanceId, failureCode }) => crashes.push(`${instanceId}:${failureCode}`),
    });
    const ready = supervisor.ensureHostRunning();
    child.emit('message', { type: 'plugin-runtime.ready' } as never);
    await ready;
    for (const [instanceId, pluginId] of [
      ['11111111-1111-4111-8111-111111111111', 'com.example.one'],
      ['22222222-2222-4222-8222-222222222222', 'com.example.two'],
    ] as const) {
      await supervisor.activate({
        instanceId,
        libraryId: 'library-1',
        libraryDirectory: '/tmp/library',
        pluginId,
        version: '1.0.0',
        packageHash: 'a'.repeat(64),
        entryJavaScript: 'async function setup() {}',
        permissions: ['library.read'],
      });
    }
    child.emit('message', {
      type: 'plugin-runtime.event',
      instanceId: '11111111-1111-4111-8111-111111111111',
      eventType: 'future.policy',
      critical: true,
      payload: null,
    } as never);
    expect(crashes).toEqual(['11111111-1111-4111-8111-111111111111:RUNTIME_PROTOCOL_ERROR']);
    expect(supervisor.listActiveInstanceIds()).toEqual(['22222222-2222-4222-8222-222222222222']);
    expect(child.killCount).toBe(0);
    supervisor.shutdown();
  });

  it('routes owned job progress and accepts the matching completion', async () => {
    const child = new FakeRuntimeChild();
    const progress: unknown[] = [];
    const crashes: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      handleJobProgress: async (input) => { progress.push(input); },
      onInstanceCrashed: ({ instanceId }) => crashes.push(instanceId),
    });
    const ready = supervisor.ensureHostRunning();
    child.emit('message', { type: 'plugin-runtime.ready' } as never);
    await ready;
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await supervisor.activate({
      instanceId,
      libraryId: 'library-1',
      libraryDirectory: '/tmp/library',
      pluginId: 'com.example.demo',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      entryJavaScript: 'async function setup() {}',
      permissions: ['job.manage'],
    });
    child.emit('message', { type: 'plugin-runtime.activated', instanceId, pluginId: 'com.example.demo', packageHash: 'a'.repeat(64) } as never);
    const job = {
      jobId: '33333333-3333-4333-8333-333333333333',
      libraryId: 'library-1', kind: 'plugin.background', status: 'running', progress: 0,
      attemptCount: 1, errorCode: null, errorDetail: null, ownerPluginId: 'com.example.demo',
      ownerPackageHash: 'a'.repeat(64), pluginHandlerId: 'upscale', payload: {}, recoveryStrategy: 'idempotent',
      createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    } as PluginJobRecord;
    const completion = supervisor.invokeJob({ instanceId, job });
    child.emit('message', {
      type: 'plugin-runtime.job-progress', instanceId, jobId: job.jobId,
      progress: { completed: 1, total: 2, phase: 'read', message: 'half' },
      targetLibraryId: 'library-2',
    } as never);
    await flush();
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ targetLibraryId: 'library-2' });
    child.emit('message', {
      type: 'plugin-runtime.job-complete', instanceId, jobId: job.jobId,
      status: 'succeeded', progress: 1,
    } as never);
    await completion;
    expect(crashes).toEqual([]);
    supervisor.shutdown();
  });

  it('settles pending jobs when the standard runtime exits and ignores its late completion', async () => {
    const child = new FakeRuntimeChild();
    const crashes: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onInstanceCrashed: ({ failureCode }) => crashes.push(failureCode),
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateStandardInstance(supervisor, child, instanceId);

    const job = createJob('33333333-3333-4333-8333-333333333333');
    const completion = supervisor.invokeJob({ instanceId, job });
    child.emit('exit', 1 as never);

    await expect(completion).resolves.toMatchObject({
      complete: {
        jobId: job.jobId,
        status: 'failed',
        errorCode: 'PLUGIN_JOB_RUNTIME_PROCESS_EXITED',
      },
    });
    child.emit('message', {
      type: 'plugin-runtime.job-complete',
      instanceId,
      jobId: job.jobId,
      status: 'succeeded',
    } as never);
    expect(crashes).toEqual(['RUNTIME_PROCESS_EXITED']);
  });

  it('does not consume a new instance completion after an old instance is settled', async () => {
    const firstChild = new FakeRuntimeChild();
    const secondChild = new FakeRuntimeChild();
    let activeChild = firstChild;
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => activeChild,
      executeHostCommand: async () => ({}),
    });
    const firstInstanceId = '11111111-1111-4111-8111-111111111111';
    const secondInstanceId = '22222222-2222-4222-8222-222222222222';
    await activateStandardInstance(supervisor, firstChild, firstInstanceId);

    const job = createJob('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const firstCompletion = supervisor.invokeJob({ instanceId: firstInstanceId, job });
    firstChild.emit('exit', 1 as never);
    await expect(firstCompletion).resolves.toMatchObject({
      complete: { errorCode: 'PLUGIN_JOB_RUNTIME_PROCESS_EXITED' },
    });

    activeChild = secondChild;
    await activateStandardInstance(supervisor, secondChild, secondInstanceId);
    const secondCompletion = supervisor.invokeJob({ instanceId: secondInstanceId, job });
    firstChild.emit('message', {
      type: 'plugin-runtime.job-complete',
      instanceId: firstInstanceId,
      jobId: job.jobId,
      status: 'succeeded',
    } as never);
    await flush();
    secondChild.emit('message', {
      type: 'plugin-runtime.job-complete',
      instanceId: secondInstanceId,
      jobId: job.jobId,
      status: 'succeeded',
    } as never);
    await expect(secondCompletion).resolves.toMatchObject({
      complete: { jobId: job.jobId, status: 'succeeded' },
    });
  });

  it('cancels pending jobs as soon as a standard instance is deactivated', async () => {
    const child = new FakeRuntimeChild();
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateStandardInstance(supervisor, child, instanceId);

    const job = createJob('44444444-4444-4444-8444-444444444444');
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
      type: 'plugin-runtime.deactivated',
      instanceId,
      reason: 'library-closed',
    } as never);
    child.emit('message', {
      type: 'plugin-runtime.job-complete',
      instanceId,
      jobId: job.jobId,
      status: 'succeeded',
    } as never);
    supervisor.shutdown();
  });

  it('fails pending jobs when a standard runtime protocol fault isolates their instance', async () => {
    const child = new FakeRuntimeChild();
    const crashes: string[] = [];
    const supervisor = new PluginRuntimeSupervisor({
      modulePath: '/safe/plugin_standard_host.js',
      fork: () => child,
      executeHostCommand: async () => ({}),
      onInstanceCrashed: ({ failureCode }) => crashes.push(failureCode),
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    await activateStandardInstance(supervisor, child, instanceId);

    const job = createJob('55555555-5555-4555-8555-555555555555');
    const completion = supervisor.invokeJob({ instanceId, job });
    child.emit('message', {
      type: 'plugin-runtime.event',
      instanceId,
      eventType: 'future.policy',
      critical: true,
      payload: null,
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
      type: 'plugin-runtime.job-complete',
      instanceId,
      jobId: job.jobId,
      status: 'succeeded',
    } as never);
    expect(crashes).toEqual(['RUNTIME_PROTOCOL_ERROR']);
  });
});
