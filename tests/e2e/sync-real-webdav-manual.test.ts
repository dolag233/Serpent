/**
 * Opt-in real WebDAV check. Set SERPENT_REAL_SYNC_CONFIG_PATH to an existing
 * sync-servers.json and SERPENT_REAL_SYNC_URL to the exact configured URL.
 * The encrypted server record is copied into isolated E2E userData. This test
 * creates and then removes only its uniquely named remote library directory.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

import { electronLaunchEnv, resolveElectronExecutablePath } from "./electron-test-helpers";

const configPath = process.env.SERPENT_REAL_SYNC_CONFIG_PATH;
const targetUrl = process.env.SERPENT_REAL_SYNC_URL;
const fixtureBytes = 64 * 1024 * 1024;

test.describe.configure({ timeout: 180_000 });

test.skip(!configPath || !targetUrl, "Requires explicit real WebDAV configuration.");

test("saving auto sync during transfer on the configured WebDAV server", async () => {
  const servers = JSON.parse(readFileSync(configPath!, "utf8")) as Array<{
    id: string; baseUrl: string; username?: string; passwordEncrypted?: string;
    allowInsecureTls: boolean;
  }>;
  const configured = servers.find((item) => item.baseUrl.replace(/\/$/, "") === targetUrl!.replace(/\/$/, ""));
  if (!configured?.username || !configured.passwordEncrypted) {
    throw new Error("Expected one matching saved server with encrypted credentials.");
  }
  const tempBase = tmpdir();
  const disk = statfsSync(tempBase);
  if (disk.bavail * disk.bsize < fixtureBytes * 3) throw new Error("Insufficient free disk space for the fixture.");
  const localState = path.join(path.dirname(configPath!), "Local State");
  if (!existsSync(localState)) throw new Error("Saved credentials require the profile's Local State encryption key.");
  const remoteName = `serpent-e2e-${randomUUID()}`;
  const remoteUrl = new URL(`${remoteName}/`, configured.baseUrl.endsWith("/") ? configured.baseUrl : `${configured.baseUrl}/`);
  const temporaryRoot = mkdtempSync(path.join(tempBase, "serpent-real-sync-e2e-"));
  const userData = path.join(temporaryRoot, "user-data");
  const source = path.join(temporaryRoot, "qa-transfer.bin");
  let application: ElectronApplication | undefined;
  let authorization: string | undefined;
  let runStarted = false;
  let result: Record<string, unknown> | undefined;
  let testError: unknown;
  const cleanupErrors: Error[] = [];
  try {
    mkdirSync(userData);
    copyFileSync(localState, path.join(userData, "Local State"));
    writeFileSync(path.join(userData, "sync-servers.json"), JSON.stringify([configured]));
    writeFileSync(source, Buffer.alloc(fixtureBytes, 0x61));
    application = await electron.launch({
      args: [process.cwd()],
      cwd: process.cwd(),
      executablePath: resolveElectronExecutablePath(),
      env: electronLaunchEnv({
        SERPENT_E2E: "1",
        SERPENT_E2E_HIDE_WINDOW: "1",
        SERPENT_E2E_SHOW_INACTIVE: "1",
        SERPENT_E2E_USER_DATA_PATH: userData,
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: path.join(temporaryRoot, remoteName),
        SERPENT_E2E_IMPORT_FILES: source,
      }),
    });
    const password = await application.evaluate(({ safeStorage }, encrypted) =>
      safeStorage.decryptString(Buffer.from(encrypted, "base64")), configured.passwordEncrypted);
    authorization = `Basic ${Buffer.from(`${configured.username}:${password}`).toString("base64")}`;
    const remoteRequest = (method: string) => fetch(remoteUrl, {
      method, headers: { Authorization: authorization!, Depth: "0" },
      signal: AbortSignal.timeout(15_000),
    });
    const before = await remoteRequest("PROPFIND");
    expect(before.status).toBe(404);
    const options = await fetch(configured.baseUrl, {
      method: "OPTIONS", headers: { Authorization: authorization }, signal: AbortSignal.timeout(15_000),
    });
    console.log("[real-webdav-options]", JSON.stringify({ status: options.status, allow: options.headers.get("allow") }));
    const created = await remoteRequest("MKCOL");
    expect(created.status).toBe(201);
    const probeFile = new URL("write-probe.bin", remoteUrl);
    const written = await fetch(probeFile, {
      method: "PUT", headers: { Authorization: authorization, "Content-Type": "application/octet-stream" },
      body: Buffer.from("serpent-real-webdav-check"), signal: AbortSignal.timeout(15_000),
    });
    const readBack = await fetch(probeFile, {
      method: "GET", headers: { Authorization: authorization }, signal: AbortSignal.timeout(15_000),
    });
    console.log("[real-webdav-write]", JSON.stringify({ put: written.status, get: readBack.status }));
    expect([200, 201, 204]).toContain(written.status);
    expect(readBack.status).toBe(200);
    expect(await readBack.text()).toBe("serpent-real-webdav-check");
    const probeDeleted = await fetch(probeFile, {
      method: "DELETE", headers: { Authorization: authorization }, signal: AbortSignal.timeout(15_000),
    });
    expect([200, 202, 204]).toContain(probeDeleted.status);

    const window = await application.firstWindow();
    await expect(window.getByRole("heading", { name: "创建本地资源库" })).toBeVisible();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(remoteName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(window.getByText(remoteName, { exact: true }).first()).toBeVisible();

    const setup = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        syncListServers(): Promise<{ ok: boolean; value?: Array<{ id: string; hasPassword: boolean }> }>;
        syncProbe(input: { serverId: string }): Promise<{ ok: boolean; value?: { auth: string; supportsContentTransfer: boolean }; error?: { code: string; reason?: string } }>;
        importFiles(input: { libraryId: string }): Promise<{ ok: boolean; error?: { code: string } }>;
      } } }).serpent.library;
      const opened = await api.listOpen();
      const listed = await api.syncListServers();
      const libraryId = opened.value?.[0]?.libraryId;
      const server = listed.value?.[0];
      if (!opened.ok || !listed.ok || !libraryId || !server?.hasPassword) throw new Error("Isolated setup failed.");
      const probe = await api.syncProbe({ serverId: server.id });
      if (!probe.ok || !probe.value?.supportsContentTransfer) {
        throw new Error(`Real WebDAV probe failed: ${JSON.stringify({ ok: probe.ok, auth: probe.value?.auth,
          transfer: probe.value?.supportsContentTransfer, code: probe.error?.code, reason: probe.error?.reason })}`);
      }
      const imported = await api.importFiles({ libraryId });
      if (!imported.ok) throw new Error(`Fixture import failed: ${imported.error?.code ?? "unknown"}`);
      return { libraryId, serverId: server.id };
    });

    await window.getByRole("button", { name: `当前资源库 ${remoteName}` }).click();
    await window.getByRole("menuitem", { name: "资源库设置" }).click();
    await window.getByRole("tab", { name: "同步" }).click();
    const syncCard = window.locator(".library-sync-card");
    await expect(syncCard.getByText("服务器可访问")).toBeVisible({ timeout: 20_000 });
    await syncCard.getByRole("textbox", { name: "同步文件夹名称" }).fill(remoteName);

    await window.evaluate(({ libraryId, serverId, directoryName }) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        syncRun(input: { libraryId: string; serverId: string; directoryName: string }): Promise<{ ok: boolean; value?: { report: { uploads: number } }; error?: { code: string } }>;
      } } }).serpent.library;
      const state = globalThis as typeof globalThis & { __realSyncRun?: Promise<unknown>; __realSyncDone?: boolean };
      state.__realSyncDone = false;
      state.__realSyncRun = api.syncRun({ libraryId, serverId, directoryName }).then((value) => {
        state.__realSyncDone = true;
        return value;
      });
    }, { ...setup, directoryName: remoteName });
    runStarted = true;
    await expect(syncCard.getByText("正在同步").first()).toBeVisible({ timeout: 20_000 });
    expect(await window.evaluate(() => (globalThis as typeof globalThis & { __realSyncDone?: boolean }).__realSyncDone)).toBe(false);
    await syncCard.getByRole("switch", { name: "自动同步" }).click();
    const saveStarted = Date.now();
    await syncCard.getByRole("button", { name: "保存", exact: true }).click();
    await expect(syncCard.getByText("已保存此资源库的同步配置。")).toBeVisible({ timeout: 5_000 });
    const saveMs = Date.now() - saveStarted;
    expect(saveMs).toBeLessThan(5_000);
    expect(await window.evaluate(() => (globalThis as typeof globalThis & { __realSyncDone?: boolean }).__realSyncDone)).toBe(false);
    await expect(syncCard.getByText("连接失败")).toBeHidden();
    const binding = await window.evaluate(async (libraryId) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        syncGetBinding(input: { libraryId: string }): Promise<{ ok: boolean; value?: { enabled: boolean; directoryName: string } }>;
      } } }).serpent.library;
      return api.syncGetBinding({ libraryId });
    }, setup.libraryId);
    expect(binding.value).toMatchObject({ enabled: true, directoryName: remoteName });
    const run = await window.evaluate(() =>
      (globalThis as typeof globalThis & { __realSyncRun: Promise<{ ok: boolean; value?: { report: { uploads: number } }; error?: { code: string } }> }).__realSyncRun);
    expect(run.ok, run.error?.code).toBe(true);
    expect(run.value?.report.uploads).toBeGreaterThan(0);
    await expect(syncCard.getByText("服务器可访问")).toBeVisible({ timeout: 20_000 });
    result = { probe: "ok", saveMs, savedWhileRunning: true, uploads: run.value?.report.uploads };
  } catch (error) {
    testError = error;
  } finally {
    try {
      if (runStarted && application) {
        await Promise.race([
          application.firstWindow().then((window) => window.evaluate(() =>
            (globalThis as typeof globalThis & { __realSyncRun?: Promise<unknown> }).__realSyncRun)).catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 30_000)),
        ]);
      }
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
    }
    try {
      await application?.close();
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
    }
    try {
      if (authorization) {
        // The name was absent before this run and includes a fresh UUID. Always
        // inspect/delete it, even if the app failed before progress was observed.
        const deleted = await fetch(remoteUrl, {
          method: "DELETE", headers: { Authorization: authorization }, signal: AbortSignal.timeout(15_000),
        });
        if (![200, 202, 204, 404].includes(deleted.status)) {
          cleanupErrors.push(new Error(`Remote test directory cleanup failed: HTTP ${deleted.status}`));
        }
        const after = await fetch(remoteUrl, {
          method: "PROPFIND", headers: { Authorization: authorization, Depth: "0" }, signal: AbortSignal.timeout(15_000),
        });
        if (after.status !== 404) cleanupErrors.push(new Error(`Remote test directory remains: HTTP ${after.status}`));
      }
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
    }
    try {
      if (!temporaryRoot.startsWith(path.join(tempBase, "serpent-real-sync-e2e-"))) {
        cleanupErrors.push(new Error("Refusing to remove an unexpected local fixture path."));
      } else {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (testError && cleanupErrors.length > 0) throw new AggregateError([testError, ...cleanupErrors], "Test and cleanup failed.");
  if (testError) throw testError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Test cleanup failed.");
  console.log("[real-webdav-sync]", JSON.stringify(result));
});
