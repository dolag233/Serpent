import { describe, expect, it, vi } from 'vitest';

import {
  SyncAutoScheduler,
  type SyncAutoSchedulerOptions,
  type SyncBindingLike,
} from '../../src/main/sync-auto-scheduler';

interface PostedCommand {
  type: string;
  libraryId?: string;
}

class FakeWorkerClient {
  readonly posts: PostedCommand[] = [];
  readonly listeners = new Set<(event: { libraryId: string }) => void>();
  /** type → 响应;未配置时返回 ok。 */
  responses = new Map<string, { ok: boolean; type?: string; changed?: boolean; error?: { code: string } }>();

  onAssetsChanged(listener: (event: { libraryId: string }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(command: PostedCommand): Promise<{ ok: boolean; type?: string; changed?: boolean; error?: { code: string } }> {
    this.posts.push(command);
    return this.responses.get(command.type) ?? { ok: true, type: 'sync.completed', changed: false };
  }
}

function makeOptions(overrides: Partial<SyncAutoSchedulerOptions> = {}): {
  options: SyncAutoSchedulerOptions;
  client: FakeWorkerClient;
} {
  const client = new FakeWorkerClient();
  const bindings: Record<string, SyncBindingLike> = {
    'lib-enabled': { serverId: 'server-1', directoryName: '目录', enabled: true },
    'lib-disabled': { serverId: 'server-1', directoryName: '目录', enabled: false },
  };
  let savedBindings = { ...bindings };
  const options: SyncAutoSchedulerOptions = {
    workerClient: client as never,
    deviceId: () => 'device-a',
    readBindings: () => ({ ...savedBindings }),
    writeBindings: (next) => {
      savedBindings = { ...next };
    },
    resolveCredentials: (serverId) => (serverId === 'server-1'
      ? { baseUrl: 'https://dav/', username: 'u', password: 'p', allowInsecureTls: false }
      : null),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as never,
    ...overrides,
  };
  return { options, client };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

describe('SyncAutoScheduler (Serpent-bfsb 后续)', () => {
  it('auto-syncs only enabled bindings after a local asset change (debounced)', async () => {
    const { options, client } = makeOptions({ localChangeDebounceMs: 5 });
    const scheduler = new SyncAutoScheduler(options);
    scheduler.start();
    for (const listener of [...client.listeners]) listener({ libraryId: 'lib-enabled' });
    for (const listener of [...client.listeners]) listener({ libraryId: 'lib-disabled' });
    await settle();
    scheduler.stop();

    const runs = client.posts.filter((post) => post.type === 'sync.run');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.libraryId).toBe('lib-enabled');
  });

  it('polls remote manifest changes and syncs when changed', async () => {
    const { options, client } = makeOptions({ pollIntervalMs: 5 });
    client.responses.set('sync.poll-remote', { ok: true, type: 'sync.poll-remote.result', changed: true });
    const scheduler = new SyncAutoScheduler(options);
    scheduler.start();
    await settle();
    scheduler.stop();

    const runs = client.posts.filter((post) => post.type === 'sync.run');
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.map((run) => run.libraryId)).toContain('lib-enabled');
    // 未开启自动同步的库不轮询也不同步。
    expect(runs.map((run) => run.libraryId)).not.toContain('lib-disabled');
  });

  it('skips auto-sync when the worker reports SYNC_IN_PROGRESS', async () => {
    const { options, client } = makeOptions({ localChangeDebounceMs: 5 });
    client.responses.set('sync.run', { ok: false, error: { code: 'SYNC_IN_PROGRESS' } });
    const scheduler = new SyncAutoScheduler(options);
    scheduler.start();
    for (const listener of [...client.listeners]) listener({ libraryId: 'lib-enabled' });
    await settle();
    scheduler.stop();

    const runs = client.posts.filter((post) => post.type === 'sync.run');
    expect(runs).toHaveLength(1);
  });

  it('does not sync when the binding is missing or the server is unknown', async () => {
    const { options, client } = makeOptions({ localChangeDebounceMs: 5 });
    const scheduler = new SyncAutoScheduler(options);
    scheduler.start();
    for (const listener of [...client.listeners]) listener({ libraryId: 'lib-unknown' });
    await settle();
    scheduler.stop();

    expect(client.posts.filter((post) => post.type === 'sync.run')).toHaveLength(0);
  });

  it('polls remote changes immediately on start, without waiting for the first interval', async () => {
    const { options, client } = makeOptions();
    const scheduler = new SyncAutoScheduler(options);
    scheduler.start();
    // 不做任何计时推进：start() 里的首次 poll 应立即发出。
    await settle();
    scheduler.stop();

    const polls = client.posts.filter((post) => post.type === 'sync.poll-remote');
    expect(polls.length).toBeGreaterThanOrEqual(1);
    expect(polls.map((poll) => poll.libraryId)).toContain('lib-enabled');
  });

  it('syncNow triggers an immediate sync.run for an enabled binding (binding-save)', async () => {
    const { options, client } = makeOptions();
    const scheduler = new SyncAutoScheduler(options);
    scheduler.start();
    scheduler.syncNow('lib-enabled');
    await settle();
    scheduler.stop();

    const runs = client.posts.filter((post) => post.type === 'sync.run');
    expect(runs.map((run) => run.libraryId)).toContain('lib-enabled');
  });

  it('syncNow skips disabled or unknown bindings', async () => {
    const { options, client } = makeOptions();
    const scheduler = new SyncAutoScheduler(options);
    scheduler.start();
    scheduler.syncNow('lib-disabled');
    scheduler.syncNow('lib-unknown');
    await settle();
    scheduler.stop();

    expect(client.posts.filter((post) => post.type === 'sync.run')).toHaveLength(0);
  });

  it('polls at the 5-second default interval (user decision 2026-08-18)', async () => {
    vi.useFakeTimers();
    try {
      const { options, client } = makeOptions();
      const scheduler = new SyncAutoScheduler(options);
      scheduler.start();
      const pollsBefore = client.posts.filter((post) => post.type === 'sync.poll-remote').length;
      // 4 秒内不出现第二个轮询（首个为 start 立即轮询）。
      await vi.advanceTimersByTimeAsync(4_000);
      expect(client.posts.filter((post) => post.type === 'sync.poll-remote').length).toBe(pollsBefore);
      // 满 5 秒后出现第二个轮询。
      await vi.advanceTimersByTimeAsync(1_000);
      expect(client.posts.filter((post) => post.type === 'sync.poll-remote').length).toBe(pollsBefore + 1);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
