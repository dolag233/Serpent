import { expect, test, vi } from "vitest";

import { createPublicError } from "../../src/shared/protocol/errors";
import {
  applySyncWorkerBindings,
  bindingNeedsRunAfterManual,
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
  expect(writeSyncBindings).toHaveBeenCalled();
  expect(syncNow).not.toHaveBeenCalled();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(syncNow).toHaveBeenCalledWith("lib-1");
});

test("a same-target save is covered by an active manual run, but a rebind is not", () => {
  const manual = { serverId: "server-1", directoryName: "Fixture" };
  expect(bindingNeedsRunAfterManual({ serverId: "server-1", directoryName: "Fixture", enabled: true }, manual)).toBe(false);
  expect(bindingNeedsRunAfterManual({ serverId: "server-1", directoryName: "Other", enabled: true }, manual)).toBe(true);
  expect(bindingNeedsRunAfterManual({ serverId: "server-2", directoryName: "Fixture", enabled: true }, manual)).toBe(true);
  expect(bindingNeedsRunAfterManual({ serverId: "server-2", directoryName: "Fixture", enabled: false }, manual)).toBe(false);
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

test("a completed manual sync preserves settings saved during the transfer", () => {
  const writeSyncBindings = vi.fn();
  const binding = {
    serverId: "server-1",
    directoryName: "Fixture",
    enabled: true,
    pollIntervalMs: 60_000,
    showCardSyncStatus: false,
  };
  applySyncWorkerBindings(
    { type: "sync.run.request", libraryId: "lib-1", serverId: "server-1", directoryName: "Fixture" },
    { ok: true, type: "ai.config.saved" },
    {
      readSyncBindings: () => ({ "lib-1": binding }),
      writeSyncBindings,
      now: () => new Date("2026-11-07T00:00:00.000Z"),
    },
  );
  expect(writeSyncBindings).toHaveBeenCalledWith({
    "lib-1": { ...binding, lastSyncedAt: "2026-11-07T00:00:00.000Z" },
  });
});

test("a completed old manual sync does not revert a newer remote binding", () => {
  const writeSyncBindings = vi.fn();
  const newer = {
    serverId: "server-2",
    directoryName: "Other",
    enabled: true,
    pollIntervalMs: 60_000,
    showCardSyncStatus: false,
  };
  applySyncWorkerBindings(
    { type: "sync.run.request", libraryId: "lib-1", serverId: "server-1", directoryName: "Fixture" },
    { ok: true, type: "ai.config.saved" },
    {
      readSyncBindings: () => ({ "lib-1": newer }),
      writeSyncBindings,
      now: () => new Date("2026-11-07T00:00:00.000Z"),
    },
  );
  expect(writeSyncBindings).not.toHaveBeenCalled();
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
