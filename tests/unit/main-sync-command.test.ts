import { expect, test } from "vitest";

import { executeSyncMainCommand } from "../../src/main/commands/sync";

const runtime = {
  resolveSyncServerCredentials: () => ({
    baseUrl: "https://sync.example.com",
    username: "studio",
    password: "secret",
    allowInsecureTls: false,
  }),
  syncDeviceId: () => "device-1",
  createNativeDialogHost: () => ({
    getLocale: () => "en" as const,
    getMainWindow: () => null,
    isE2e: () => true,
  }),
};

test("sync.probe throws when the server is missing", async () => {
  await expect(executeSyncMainCommand(
    { type: "sync.probe.request", serverId: "missing" },
    { ...runtime, resolveSyncServerCredentials: () => null },
  )).rejects.toThrow("同步服务器不存在，请先在通用设置中配置。");
});

test("sync.preview maps credentials and device id", async () => {
  await expect(executeSyncMainCommand(
    {
      type: "sync.preview.request",
      libraryId: "lib-1",
      serverId: "server-1",
      directoryName: "Studio",
    },
    runtime,
  )).resolves.toEqual({
    type: "sync.preview",
    libraryId: "lib-1",
    deviceId: "device-1",
    baseUrl: "https://sync.example.com",
    username: "studio",
    password: "secret",
    allowInsecureTls: false,
    directoryName: "Studio",
  });
});

test("sync.servers.list stays on the Main-owned config path", async () => {
  await expect(executeSyncMainCommand(
    { type: "sync.servers.list.request" },
    runtime,
  )).resolves.toBeUndefined();
});
