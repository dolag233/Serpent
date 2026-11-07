import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

import { startMockWebDAVServer } from "../worker/webdav-fixture-server";
import { electronLaunchEnv, resolveElectronExecutablePath } from "./electron-test-helpers";

test.describe.configure({ timeout: 120_000 });

test("saving auto sync while a manual WebDAV transfer is blocked returns before transfer completion", async () => {
  let releasePut!: () => void;
  let notifyPut!: () => void;
  const putEntered = new Promise<void>((resolve) => { notifyPut = resolve; });
  const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
  let blockedOnce = false;
  let manifestWrites = 0;
  const server = await startMockWebDAVServer({
    onPut: async (remotePath) => {
      if (remotePath === "Fixture/manifest.json") manifestWrites += 1;
      if (blockedOnce || !remotePath.startsWith("Fixture/")) return;
      blockedOnce = true;
      notifyPut();
      await putGate;
    },
  });
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-sync-save-e2e-"));
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath: resolveElectronExecutablePath(),
      env: electronLaunchEnv({
        SERPENT_E2E: "1",
        SERPENT_E2E_HIDE_WINDOW: "1",
        SERPENT_E2E_SHOW_INACTIVE: "1",
        SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: path.join(temporaryRoot, "Fixture"),
      }),
    });
    const window = await application.firstWindow();
    await expect(window.getByRole("heading", { name: "创建本地资源库" })).toBeVisible();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill("Fixture");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(window.getByText("Fixture", { exact: true }).first()).toBeVisible();

    const setup = await window.evaluate(async (baseUrl) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        syncSaveServer(input: { baseUrl: string }): Promise<{ ok: boolean; value?: { id: string } }>;
      } } }).serpent.library;
      const opened = await api.listOpen();
      const serverResult = await api.syncSaveServer({ baseUrl });
      const libraryId = opened.value?.[0]?.libraryId;
      const serverId = serverResult.value?.id;
      if (!opened.ok || !serverResult.ok || !libraryId || !serverId) throw new Error("Fixture setup failed.");
      return { libraryId, serverId };
    }, server.baseUrl);

    await window.evaluate(({ libraryId, serverId }) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        syncRun(input: { libraryId: string; serverId: string; directoryName: string }): Promise<unknown>;
      } } }).serpent.library;
      (globalThis as typeof globalThis & { __fixtureSyncRun?: Promise<unknown> }).__fixtureSyncRun =
        api.syncRun({ libraryId, serverId, directoryName: "Fixture" });
    }, setup);
    await putEntered;

    const saved = await window.evaluate(async ({ libraryId, serverId }) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        syncSaveBinding(input: { libraryId: string; serverId: string; directoryName: string; enabled: boolean; pollIntervalMs: number; showCardSyncStatus: boolean }): Promise<{ ok: boolean }>;
        syncGetBinding(input: { libraryId: string }): Promise<{ ok: boolean; value?: { enabled?: boolean; pollIntervalMs?: number; showCardSyncStatus?: boolean } }>;
      } } }).serpent.library;
      return Promise.race([
        (async () => {
          const save = await api.syncSaveBinding({
            libraryId, serverId, directoryName: "Fixture", enabled: true,
            pollIntervalMs: 60_000, showCardSyncStatus: false,
          });
          const binding = await api.syncGetBinding({ libraryId });
          return { saveOk: save.ok, persisted: binding.value?.enabled,
            pollIntervalMs: binding.value?.pollIntervalMs, showCardSyncStatus: binding.value?.showCardSyncStatus,
            timedOut: false };
        })(),
        new Promise<{ saveOk: boolean; persisted: boolean; pollIntervalMs?: number; showCardSyncStatus?: boolean; timedOut: boolean }>((resolve) =>
          setTimeout(() => resolve({ saveOk: false, persisted: false, timedOut: true }), 5_000)),
      ]);
    }, setup);
    expect(saved.timedOut).toBe(false);
    expect(saved.saveOk).toBe(true);
    expect(saved.persisted).toBe(true);
    expect(saved.pollIntervalMs).toBe(60_000);
    expect(saved.showCardSyncStatus).toBe(false);
    expect(blockedOnce).toBe(true);

    releasePut();
    await expect.poll(() => window.evaluate(async () => {
      const result = await (globalThis as typeof globalThis & { __fixtureSyncRun: Promise<{ ok: boolean }> }).__fixtureSyncRun;
      return result.ok;
    }), { timeout: 30_000 }).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(manifestWrites).toBe(1);
    const after = await window.evaluate(async (libraryId) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        syncGetBinding(input: { libraryId: string }): Promise<{ ok: boolean; value?: { enabled?: boolean; pollIntervalMs?: number; showCardSyncStatus?: boolean } }>;
      } } }).serpent.library;
      return api.syncGetBinding({ libraryId });
    }, setup.libraryId);
    expect(after.value).toMatchObject({ enabled: true, pollIntervalMs: 60_000, showCardSyncStatus: false });
  } finally {
    releasePut();
    try {
      await application?.close();
    } finally {
      try {
        await server.close();
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    }
  }
});
