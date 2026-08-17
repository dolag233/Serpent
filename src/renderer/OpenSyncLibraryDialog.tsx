import { useEffect, useState, type ReactNode } from "react";

import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";
import type { SyncServerSummary } from "./sync-settings-types";

export interface RemoteLibrarySummary {
  libraryId: string;
  displayName: string;
  directoryName: string;
}

export interface OpenSyncLibraryCallbacks {
  syncListServers(): Promise<{ ok: true; value: SyncServerSummary[] } | { ok: false; message: string }>;
  syncListRemoteLibraries(input: { serverId: string }): Promise<{ ok: true; value: RemoteLibrarySummary[] } | { ok: false; message: string }>;
  syncOpenRemoteLibrary(input: { serverId: string; libraryId: string; displayName: string; directoryName: string }): Promise<{ ok: true; value: RendererLibrarySummary } | { ok: false; message: string }>;
}

/**
 * 打开同步资源库（Serpent-xffq）：选择服务器 → 列出远端库 → 拉取并创建本地库。
 * 保存位置由 Main 弹出原生目录选择器。
 */
export function OpenSyncLibraryDialog({
  open,
  callbacks,
  onClose,
  onOpened,
}: {
  open: boolean;
  callbacks: OpenSyncLibraryCallbacks;
  onClose: () => void;
  onOpened: (library: RendererLibrarySummary) => void;
}): ReactNode {
  const t = useT();
  const [servers, setServers] = useState<SyncServerSummary[]>([]);
  const [serverId, setServerId] = useState("");
  const [remoteLibraries, setRemoteLibraries] = useState<RemoteLibrarySummary[] | null>(null);
  const [busy, setBusy] = useState<"list" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const listed = await callbacks.syncListServers();
      if (!listed.ok) {
        setError(listed.message);
        return;
      }
      setServers(listed.value);
      if (listed.value.length > 0 && !serverId) {
        setServerId(listed.value[0]!.id);
      }
      setRemoteLibraries(null);
      setError(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const listRemote = async () => {
    if (!serverId) return;
    setBusy("list");
    setError(null);
    setRemoteLibraries(null);
    try {
      const result = await callbacks.syncListRemoteLibraries({ serverId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRemoteLibraries(result.value);
    } finally {
      setBusy(null);
    }
  };

  const openRemote = async (library: RemoteLibrarySummary) => {
    setBusy("open");
    setError(null);
    try {
      const result = await callbacks.syncOpenRemoteLibrary({
        serverId,
        libraryId: library.libraryId,
        displayName: library.displayName,
        directoryName: library.directoryName,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOpened(result.value);
      onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && busy === null) onClose();
      }}
      role="presentation"
    >
      <DialogShell
        className="create-dialog open-sync-library-dialog"
        dialogId="open-sync-library-dialog"
        headerActions={(
          <button
            className="dialog-close"
            onClick={onClose}
            disabled={busy !== null}
            type="button"
            {...iconActionAttrs(t("common.close"))}
          >
            <Icon name="close" size={16} />
          </button>
        )}
        title={t("shell.openSyncLibraryEllipsis")}
      >
        <div className="open-sync-library-body">
          <div className="app-settings-row app-settings-row-stack">
            <div className="app-settings-row-copy">
              <strong>{t("settings.sync.server")}</strong>
            </div>
            {servers.length === 0 ? (
              <p className="app-settings-help-note">{t("settings.sync.noServer")}</p>
            ) : (
              <select
                className="text-field"
                aria-label={t("settings.sync.server")}
                value={serverId}
                onChange={(event) => {
                  setServerId(event.target.value);
                  setRemoteLibraries(null);
                }}
              >
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>{server.baseUrl}</option>
                ))}
              </select>
            )}
          </div>
          <div className="app-settings-action-row">
            <span className="app-settings-row-copy" />
            <button
              className="primary-button"
              disabled={busy !== null || !serverId}
              onClick={() => void listRemote()}
              type="button"
            >
              {busy === "list" ? t("common.saving") : t("settings.sync.listRemoteLibraries")}
            </button>
          </div>

          {remoteLibraries !== null ? (
            remoteLibraries.length === 0 ? (
              <p className="app-settings-help-note">{t("settings.sync.noRemoteLibraries")}</p>
            ) : (
              <div className="open-sync-library-existing">
                <div className="create-dialog-existing-label">
                  {t("settings.sync.remoteLibrariesTitle")}
                </div>
                <ul className="create-dialog-recent-list open-sync-library-list">
                  {remoteLibraries.map((library) => (
                    <li className="create-dialog-recent-row" key={library.libraryId}>
                      <button
                        className="create-dialog-recent-open"
                        disabled={busy !== null}
                        onClick={() => void openRemote(library)}
                        type="button"
                      >
                        <span className="create-dialog-recent-texts">
                          <span className="create-dialog-recent-name">
                            {library.displayName}
                          </span>
                          <span className="create-dialog-recent-path">
                            {library.directoryName}
                          </span>
                        </span>
                        <span className="open-sync-library-open">
                          {busy === "open" ? t("common.saving") : t("settings.sync.openRemoteLibrary")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}

          {error ? <p className="settings-error-message">{error}</p> : null}
        </div>
      </DialogShell>
    </div>
  );
}
