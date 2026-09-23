import { expect, test, vi } from "vitest";

import { createPublicError } from "../../src/shared/protocol/errors";
import {
  applySyncWorkerBindings,
  runSyncProbeWithRetry,
  tryHandleSyncOwnedRequest,
  type SyncOwnedRequestRuntime,
  type SyncServerRecord,
} from "../../src/main/library-request/sync";
import { WorkerRequestTimeoutError } from "../../src/main/worker-client";

function runtime(overrides?: Partial<SyncOwnedRequestRuntime>): SyncOwnedRequestRuntime {
  return {
    readSyncServers: () => [],
    writeSyncServers: vi.fn(),
    readSyncBindings: () => ({}),
    writeSyncBindings: vi.fn(),
    encryptPassword: (password) => `enc:${password}`,
    syncNow: vi.fn(),
    ...overrides,
  };
}

test("unrelated renderer requests fall through", async () => {
  await expect(tryHandleSyncOwnedRequest(
    { type: "folder.list.request", libraryId: "lib-1" },
    runtime(),
  )).resolves.toBeUndefined();
});

test("sync.servers.list maps stored records onto the renderer payload", async () => {
  const servers: SyncServerRecord[] = [{
    id: "server-1",
    baseUrl: "https://sync.example.com",
    username: "studio",
    passwordEncrypted: "enc",
    allowInsecureTls: false,
  }];
  await expect(tryHandleSyncOwnedRequest(
    { type: "sync.servers.list.request" },
    runtime({ readSyncServers: () => servers }),
  )).resolves.toEqual({
    ok: true,
    type: "sync.servers.listed",
    servers: [{
      id: "server-1",
      baseUrl: "https://sync.example.com",
      username: "studio",
      hasPassword: true,
      allowInsecureTls: false,
    }],
  });
});

test("sync.servers.upsert rejects an invalid url", async () => {
  await expect(tryHandleSyncOwnedRequest(
    {
      type: "sync.servers.upsert.request",
      baseUrl: "ftp://sync.example.com",
    },
    runtime(),
  )).resolves.toMatchObject({
    ok: false,
    error: { code: "SYNC_CONNECTION_FAILED", reason: "SYNC_INVALID_URL" },
  });
});

test("sync.library.binding.save triggers syncNow when enabled", async () => {
  const writeSyncBindings = vi.fn();
  const syncNow = vi.fn();
  await expect(tryHandleSyncOwnedRequest(
    {
      type: "sync.library.binding.save.request",
      libraryId: "lib-1",
      serverId: "server-1",
      directoryName: "Studio",
      enabled: true,
    },
    runtime({ writeSyncBindings, syncNow }),
  )).resolves.toEqual({
    ok: true,
    type: "sync.binding.saved",
    libraryId: "lib-1",
    serverId: "server-1",
    directoryName: "Studio",
    enabled: true,
  });
  expect(syncNow).toHaveBeenCalledWith("lib-1");
  expect(writeSyncBindings).toHaveBeenCalled();
});

test("sync.run persists lastSyncedAt and keeps auto-sync off by default", () => {
  const writeSyncBindings = vi.fn();
  applySyncWorkerBindings(
    {
      type: "sync.run.request",
      libraryId: "lib-1",
      serverId: "server-1",
      directoryName: "Studio",
    },
    { ok: true as const, type: "ai.config.saved" as const },
    {
      readSyncBindings: () => ({}),
      writeSyncBindings,
      now: () => new Date("2026-09-21T00:00:00.000Z"),
    },
  );
  expect(writeSyncBindings).toHaveBeenCalledWith({
    "lib-1": {
      serverId: "server-1",
      directoryName: "Studio",
      lastSyncedAt: "2026-09-21T00:00:00.000Z",
      enabled: false,
    },
  });
});

test("sync.probe retries timeouts then returns the timeout error", async () => {
  const requestWorker = vi.fn(async () => {
    throw new WorkerRequestTimeoutError("req-1", "sync.probe");
  });
  const delay = vi.fn(async () => undefined);
  await expect(runSyncProbeWithRetry(
    { type: "sync.probe", baseUrl: "http://127.0.0.1:8080" },
    requestWorker,
    delay,
  )).resolves.toMatchObject({
    ok: false,
    error: { code: "SYNC_CONNECTION_FAILED", reason: "SYNC_TIMEOUT" },
  });
  expect(requestWorker).toHaveBeenCalledTimes(3);
  expect(delay).toHaveBeenCalledTimes(2);
});

test("sync.probe does not retry deterministic connection errors", async () => {
  const requestWorker = vi.fn(async () => ({
    ok: false as const,
    error: createPublicError("SYNC_CONNECTION_FAILED", "SYNC_AUTH_FAILED"),
  }));
  await expect(runSyncProbeWithRetry(
    { type: "sync.probe", baseUrl: "http://127.0.0.1:8080" },
    requestWorker,
    async () => undefined,
  )).resolves.toEqual({
    ok: false,
    error: createPublicError("SYNC_CONNECTION_FAILED", "SYNC_AUTH_FAILED"),
  });
  expect(requestWorker).toHaveBeenCalledTimes(1);
});
