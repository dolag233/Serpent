/**
 * 自动同步调度器（Serpent-bfsb 后续）。
 *
 * 用户决定（2026-08-17）：
 * - 打开同步资源库后自动绑定并开启自动同步；
 * - 本地导入/修改/管理资产 → 自动同步到服务器；
 * - 云端有改动 → 本地自动同步（固定间隔轮询，不提供频率设置）；
 * - 传输数据无墙钟超时；仅测试连接（probe）有超时与自动重试。
 *
 * 触发源：
 * 1. 资产变更事件（worker 广播 asset.changed）→ debounce 后自动 sync.run；
 * 2. 固定间隔轮询 sync.poll-remote（只读远端 manifest 对比本地缓存，
 *    不做本地全量 hash），有变化则自动 sync.run；
 * 3. 绑定保存（binding-save）→ 立即触发一次同步。
 *
 * 只对 enabled 的绑定生效；与手动同步经 worker 端 beginSyncSession
 * 内存互斥（SYNC_IN_PROGRESS）。失败只记日志，不打扰用户。
 */

import type { AppLogger } from './app-logger';
import type { LibraryWorkerClient } from './worker-client';

export interface SyncBindingLike {
  serverId: string;
  directoryName?: string;
  subPath?: string;
  lastSyncedAt?: string;
  enabled?: boolean;
}

/** 自动同步触发原因（日志与互斥语义）。 */
export type SyncReason = 'local-change' | 'remote-change' | 'binding-save';

export interface SyncAutoSchedulerOptions {
  workerClient: LibraryWorkerClient;
  deviceId(): string;
  readBindings(): Record<string, SyncBindingLike>;
  writeBindings(bindings: Record<string, SyncBindingLike>): void;
  resolveCredentials(serverId: string): {
    baseUrl: string;
    username?: string;
    password?: string;
    allowInsecureTls: boolean;
  } | null;
  logger: AppLogger;
  /** 云端变化轮询间隔（用户决定：不提供 UI 频率设置，内置固定值）。 */
  pollIntervalMs?: number;
  /** 资产变更 debounce（批量导入/删除只触发一次）。 */
  localChangeDebounceMs?: number;
}

/** 绑定读取的兼容旧 subPath 字段。 */
function effectiveDirectoryName(binding: SyncBindingLike): string | undefined {
  return binding.directoryName ?? binding.subPath;
}

export class SyncAutoScheduler {
  readonly #options: SyncAutoSchedulerOptions;
  readonly #pollIntervalMs: number;
  readonly #localChangeDebounceMs: number;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 进行中的自动同步（libraryId → promise），避免同一库叠加。 */
  #running = new Map<string, Promise<void>>();
  #unsubscribeAssetsChanged: (() => void) | undefined;

  constructor(options: SyncAutoSchedulerOptions) {
    this.#options = options;
    // 用户决定（2026-08-18）：轮询间隔 5 秒（原 5 分钟太长，保存后
    // 长时间无反馈，用户感知不到自动同步）。
    this.#pollIntervalMs = options.pollIntervalMs ?? 5_000;
    this.#localChangeDebounceMs = options.localChangeDebounceMs ?? 10_000;
  }

  start(): void {
    if (this.#pollTimer !== undefined) return;
    this.#unsubscribeAssetsChanged = this.#options.workerClient.onAssetsChanged((event) => {
      this.#scheduleLocalSync(event.libraryId);
    });
    // 固定间隔轮询云端变化（用户决定：不需要设置轮询频率）。
    this.#pollTimer = setInterval(() => {
      void this.#pollRemoteChanges();
    }, this.#pollIntervalMs);
    this.#pollTimer.unref?.();
    // 启动立即查一次云端，避免重启后首个周期（5s）内对已存在的远端
    // 变化毫无感知。
    void this.#pollRemoteChanges();
  }

  /**
   * 立即触发一次同步（如绑定保存后）。与手动同步经 worker 端
   * beginSyncSession 互斥；绑定未启用或同步进行中则静默跳过。
   */
  syncNow(libraryId: string, reason: SyncReason = 'binding-save'): void {
    void this.#autoSync(libraryId, reason);
  }

  stop(): void {
    if (this.#pollTimer !== undefined) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = undefined;
    }
    this.#unsubscribeAssetsChanged?.();
    this.#unsubscribeAssetsChanged = undefined;
    for (const timer of this.#debounceTimers.values()) clearTimeout(timer);
    this.#debounceTimers.clear();
  }

  #scheduleLocalSync(libraryId: string): void {
    const existing = this.#debounceTimers.get(libraryId);
    if (existing !== undefined) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.#debounceTimers.delete(libraryId);
      void this.#autoSync(libraryId, 'local-change');
    }, this.#localChangeDebounceMs);
    this.#debounceTimers.set(libraryId, timer);
  }

  async #pollRemoteChanges(): Promise<void> {
    const bindings = this.#options.readBindings();
    for (const [libraryId, binding] of Object.entries(bindings)) {
      if (!binding.enabled) continue;
      const credentials = this.#options.resolveCredentials(binding.serverId);
      if (!credentials) continue;
      const directoryName = effectiveDirectoryName(binding);
      try {
        const result = await this.#options.workerClient.request({
          type: 'sync.poll-remote',
          libraryId,
          deviceId: this.#options.deviceId(),
          baseUrl: credentials.baseUrl,
          username: credentials.username,
          password: credentials.password,
          allowInsecureTls: credentials.allowInsecureTls,
          ...(directoryName === undefined ? {} : { directoryName }),
        });
        if (result.ok && result.type === 'sync.poll-remote.result' && result.changed) {
          await this.#autoSync(libraryId, 'remote-change');
        }
      } catch (error) {
        this.#options.logger.error('sync-auto.poll', error, { libraryId });
      }
    }
  }

  async #autoSync(libraryId: string, reason: SyncReason): Promise<void> {
    if (this.#running.has(libraryId)) return;
    const binding = this.#options.readBindings()[libraryId];
    if (!binding?.enabled) return;
    const credentials = this.#options.resolveCredentials(binding.serverId);
    if (!credentials) return;
    const directoryName = effectiveDirectoryName(binding);

    const run = (async () => {
      try {
        const result = await this.#options.workerClient.request({
          type: 'sync.run',
          libraryId,
          deviceId: this.#options.deviceId(),
          baseUrl: credentials.baseUrl,
          username: credentials.username,
          password: credentials.password,
          allowInsecureTls: credentials.allowInsecureTls,
          ...(directoryName === undefined ? {} : { directoryName }),
        });
        if (result.ok) {
          const bindings = this.#options.readBindings();
          const current = bindings[libraryId];
          if (current) {
            bindings[libraryId] = {
              ...current,
              serverId: current.serverId,
              directoryName: effectiveDirectoryName(current),
              lastSyncedAt: new Date().toISOString(),
            };
            this.#options.writeBindings(bindings);
          }
          this.#options.logger.info('sync-auto.completed', '自动同步完成。', {
            libraryId,
            reason,
            uploads: result.type === 'sync.completed' ? result.report.uploads : undefined,
            downloads: result.type === 'sync.completed' ? result.report.downloads : undefined,
            conflicts: result.type === 'sync.completed' ? result.report.conflicts : undefined,
          });
        } else {
          // 手动同步进行中（SYNC_IN_PROGRESS）或连接失败：静默跳过，下次再试。
          this.#options.logger.info('sync-auto.skipped', '自动同步未执行。', {
            libraryId,
            reason,
            code: result.error.code,
          });
        }
      } catch (error) {
        this.#options.logger.error('sync-auto.run', error, { libraryId, reason });
      }
    })();
    this.#running.set(libraryId, run);
    try {
      await run;
    } finally {
      this.#running.delete(libraryId);
    }
  }
}
