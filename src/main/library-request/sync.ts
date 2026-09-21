import { randomUUID } from "node:crypto";

import { normalizeWebDAVBaseUrl } from "../../shared/sync-paths";
import type { RendererRequest } from "../../shared/protocol/requests";
import type { RendererResult } from "../../shared/protocol/responses";
import { createPublicError } from "../../shared/protocol/errors";

export type SyncServerRecord = {
  id: string;
  baseUrl: string;
  username?: string;
  /** safeStorage 加密后的密码（base64）。 */
  passwordEncrypted?: string;
  allowInsecureTls: boolean;
};

export type SyncBindingRecord = {
  serverId: string;
  /** 同步文件夹名称（远端目录名，默认库名）。 */
  directoryName?: string;
  /** 旧格式字段：subPath 曾是同步文件夹名（Serpent-xffq 早期）；读取时兼容。 */
  subPath?: string;
  /** 上次成功同步时间（ISO 字符串）。 */
  lastSyncedAt?: string;
  /** 自动同步开关（用户决定：在资源库设置里开启/关闭）。 */
  enabled?: boolean;
  /** 云端变化轮询间隔（毫秒，用户可设置；缺省 5000）。 */
  pollIntervalMs?: number;
  /** 卡片右下角同步状态；缺省 true（Serpent-871f34）。 */
  showCardSyncStatus?: boolean;
};

export type SyncOwnedRequestRuntime = {
  readSyncServers: () => SyncServerRecord[];
  writeSyncServers: (servers: SyncServerRecord[]) => void;
  readSyncBindings: () => Record<string, SyncBindingRecord>;
  writeSyncBindings: (bindings: Record<string, SyncBindingRecord>) => void;
  encryptPassword: (password: string) => string;
  syncNow: (libraryId: string) => void;
};

/** 兼容旧格式绑定：directoryName 优先，其次旧 subPath。 */
export function effectiveSyncDirectoryName(
  binding: SyncBindingRecord | undefined,
): string | undefined {
  return binding?.directoryName ?? binding?.subPath;
}

/**
 * Main-owned sync server and library-binding requests.
 * Undefined means the request is not handled here.
 */
export async function tryHandleSyncOwnedRequest(
  request: RendererRequest,
  runtime: SyncOwnedRequestRuntime,
): Promise<RendererResult | undefined> {
  switch (request.type) {
    case "sync.servers.list.request": {
      const servers = runtime.readSyncServers().map((server) => ({
        id: server.id,
        baseUrl: server.baseUrl,
        username: server.username,
        hasPassword: server.passwordEncrypted !== undefined,
        allowInsecureTls: server.allowInsecureTls,
      }));
      return { ok: true, type: "sync.servers.listed", servers } satisfies RendererResult;
    }
    case "sync.servers.upsert.request": {
      const servers = runtime.readSyncServers();
      const id = request.id ?? randomUUID();
      // Serpent-fatf: 保存时即校验/规范化 URL（缺协议自动补 http://），
      // 让非法地址在保存瞬间给出可读提示，而不是等到连接时才报笼统错误。
      // 远端码体系已删除 INVALID_SYNC_URL，用 SYNC_CONNECTION_FAILED +
      // SYNC_INVALID_URL reason 表达同一语义。
      const normalized = normalizeWebDAVBaseUrl(request.baseUrl);
      if (!normalized.ok) {
        return {
          ok: false,
          error: createPublicError("SYNC_CONNECTION_FAILED", "SYNC_INVALID_URL"),
        } satisfies RendererResult;
      }
      const passwordEncrypted = request.password
        ? runtime.encryptPassword(request.password)
        : request.id
          ? (servers.find((entry) => entry.id === id)?.passwordEncrypted)
          : undefined;
      const record: SyncServerRecord = {
        id,
        baseUrl: normalized.value,
        username: request.username || undefined,
        passwordEncrypted,
        allowInsecureTls: request.allowInsecureTls ?? false,
      };
      const existing = servers.findIndex((entry) => entry.id === id);
      if (existing >= 0) servers[existing] = record;
      else servers.push(record);
      runtime.writeSyncServers(servers);
      return { ok: true, type: "sync.server.saved", id } satisfies RendererResult;
    }
    case "sync.servers.delete.request":
      runtime.writeSyncServers(runtime.readSyncServers().filter((entry) => entry.id !== request.id));
      return { ok: true, type: "sync.server.deleted", id: request.id } satisfies RendererResult;
    case "sync.library.binding.save.request": {
      const bindings = runtime.readSyncBindings();
      const previous = bindings[request.libraryId];
      bindings[request.libraryId] = {
        serverId: request.serverId,
        directoryName: request.directoryName,
        lastSyncedAt: previous?.lastSyncedAt,
        enabled: request.enabled ?? previous?.enabled ?? false,
        pollIntervalMs: request.pollIntervalMs ?? previous?.pollIntervalMs,
        showCardSyncStatus: request.showCardSyncStatus ?? previous?.showCardSyncStatus ?? true,
      };
      runtime.writeSyncBindings(bindings);
      // Serpent-7405ef: 保存绑定（含开启自动同步）后立即触发一次同步，
      // 用户不需要等下一个 5s 轮询周期（更不会等不到同步）。
      const savedBinding = bindings[request.libraryId];
      if (savedBinding?.enabled) {
        runtime.syncNow(request.libraryId);
      }
      return {
        ok: true,
        type: "sync.binding.saved",
        libraryId: request.libraryId,
        serverId: request.serverId,
        directoryName: request.directoryName,
        enabled: request.enabled ?? previous?.enabled ?? false,
      } satisfies RendererResult;
    }
    case "sync.library.binding.get.request": {
      const binding = runtime.readSyncBindings()[request.libraryId] ?? null;
      return {
        ok: true,
        type: "sync.binding.got",
        libraryId: request.libraryId,
        binding: binding
          ? {
              serverId: binding.serverId,
              directoryName: effectiveSyncDirectoryName(binding),
              lastSyncedAt: binding.lastSyncedAt,
              enabled: binding.enabled ?? false,
              pollIntervalMs: binding.pollIntervalMs,
              showCardSyncStatus: binding.showCardSyncStatus ?? true,
            }
          : null,
      } satisfies RendererResult;
    }
    default:
      return undefined;
  }
}
