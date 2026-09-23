import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import {
  selectOpenDirectory,
  type NativeDialogHost,
} from "../native-dialogs";

export type SyncCommandCredentials = {
  baseUrl: string;
  username?: string;
  password?: string;
  allowInsecureTls: boolean;
};

export type SyncCommandRuntime = {
  resolveSyncServerCredentials: (serverId: string) => SyncCommandCredentials | null;
  syncDeviceId: () => string;
  createNativeDialogHost: () => NativeDialogHost;
};

export async function executeSyncMainCommand(
  request: RendererRequest,
  runtime: SyncCommandRuntime,
): Promise<WorkerCommand | undefined> {
  switch (request.type) {
    case "sync.asset-card-status.request":
      return {
        type: "sync.asset-card-status",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "sync.probe.request": {
      const server = runtime.resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      return {
        type: "sync.probe",
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
      };
    }
    case "sync.preview.request": {
      const server = runtime.resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      return {
        type: "sync.preview",
        libraryId: request.libraryId,
        deviceId: runtime.syncDeviceId(),
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
        directoryName: request.directoryName,
      };
    }
    case "sync.run.request": {
      const server = runtime.resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      return {
        type: "sync.run",
        libraryId: request.libraryId,
        deviceId: runtime.syncDeviceId(),
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
        directoryName: request.directoryName,
      };
    }
    case "sync.list-remote-libraries.request": {
      const server = runtime.resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      return {
        type: "sync.list-remote-libraries",
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
      };
    }
    case "sync.open-remote-library.request": {
      const server = runtime.resolveSyncServerCredentials(request.serverId);
      if (!server) throw new Error("同步服务器不存在，请先在通用设置中配置。");
      const host = runtime.createNativeDialogHost();
      const selectedParentPath = await selectOpenDirectory(
        host,
        "openSyncLibraryDestination",
        process.env.SERPENT_E2E_OPEN_SYNC_LIBRARY_PARENT,
        { createDirectory: true },
      );
      if (!selectedParentPath) return undefined;
      return {
        type: "sync.open-remote-library",
        baseUrl: server.baseUrl,
        username: server.username,
        password: server.password,
        allowInsecureTls: server.allowInsecureTls,
        libraryId: request.libraryId,
        displayName: request.displayName,
        directoryName: request.directoryName,
        selectedParentPath,
      };
    }
    case "sync.servers.list.request":
    case "sync.servers.upsert.request":
    case "sync.servers.delete.request":
    case "sync.library.binding.save.request":
    case "sync.library.binding.get.request":
      // Main-owned local config; handled before Worker dispatch.
      return undefined;
    default:
      return undefined;
  }
}
