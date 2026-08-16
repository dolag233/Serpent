import { useEffect, useState, type ReactNode } from "react";

import type { SyncCapabilities } from "../shared/library-api";
import { useT } from "./i18n";
import { SettingsCard } from "./ui/patterns";
import type { SyncServerSummary } from "./sync-settings-types";

export interface SyncServerSettingsCallbacks {
  syncListServers(): Promise<{ ok: true; value: SyncServerSummary[] } | { ok: false; message: string }>;
  syncSaveServer(input: { id?: string; baseUrl: string; username?: string; password?: string; allowInsecureTls?: boolean }): Promise<{ ok: true; value: { id: string } } | { ok: false; message: string }>;
  syncDeleteServer(input: { id: string }): Promise<{ ok: true } | { ok: false; message: string }>;
  syncProbe(input: { serverId: string }): Promise<{ ok: true; value: SyncCapabilities } | { ok: false; message: string }>;
}

type BusyState = "save" | "probe" | "delete" | null;

/**
 * Global sync-server management (Serpent-xffq). Servers configured here are
 * available to every library; each library selects a server + subpath in
 * LibrarySettings. Passwords are persisted encrypted in the Main process
 * (safeStorage) and never sent back to the renderer in full.
 */
export function SyncSettingsPage({
  callbacks,
}: {
  callbacks: SyncServerSettingsCallbacks;
}): ReactNode {
  const t = useT();
  const [servers, setServers] = useState<SyncServerSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [allowInsecureTls, setAllowInsecureTls] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<{ serverId: string; value: SyncCapabilities } | null>(null);

  const reload = async () => {
    const listed = await callbacks.syncListServers();
    if (listed.ok) setServers(listed.value);
  };

  useEffect(() => {
    void (async () => {
      const listed = await callbacks.syncListServers();
      if (listed.ok) setServers(listed.value);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setBaseUrl("");
    setUsername("");
    setPassword("");
    setAllowInsecureTls(false);
  };

  const startEdit = (server: SyncServerSummary) => {
    setEditingId(server.id);
    setBaseUrl(server.baseUrl);
    setUsername(server.username ?? "");
    setPassword("");
    setAllowInsecureTls(server.allowInsecureTls);
    setError(null);
    setNotice(null);
  };

  const saveServer = async () => {
    const url = baseUrl.trim();
    if (!url) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const saved = await callbacks.syncSaveServer({
        id: editingId ?? undefined,
        baseUrl: url,
        username: username.trim() || undefined,
        password: password || undefined,
        allowInsecureTls: allowInsecureTls || undefined,
      });
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      setNotice(t("settings.sync.saved"));
      resetForm();
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const probeServer = async (serverId: string) => {
    setBusy("probe");
    setError(null);
    setNotice(null);
    setCapabilities(null);
    try {
      const probe = await callbacks.syncProbe({ serverId });
      if (!probe.ok) {
        setError(probe.message);
        return;
      }
      setCapabilities({ serverId, value: probe.value });
    } finally {
      setBusy(null);
    }
  };

  const deleteServer = async (serverId: string) => {
    if (confirmingDeleteId !== serverId) {
      setConfirmingDeleteId(serverId);
      return;
    }
    setBusy("delete");
    setError(null);
    setNotice(null);
    try {
      const deleted = await callbacks.syncDeleteServer({ id: serverId });
      if (!deleted.ok) {
        setError(deleted.message);
        return;
      }
      setNotice(t("settings.sync.deleted"));
      setConfirmingDeleteId(null);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsCard>
      <div className="app-settings-row-copy">
        <strong>{t("settings.sync.serversTitle")}</strong>
        <span>{t("settings.sync.serversHint")}</span>
      </div>

      {servers.length === 0 ? (
        <p className="app-settings-help-note">{t("settings.sync.noServers")}</p>
      ) : (
        servers.map((server, index) => (
          <div key={server.id}>
            {index > 0 ? <div className="app-settings-card-divider" /> : null}
            <div className="app-settings-action-row">
              <div className="app-settings-row-copy">
                <strong>{server.baseUrl}</strong>
                <span>
                  {server.username
                    ? t("settings.sync.serverSummary", {
                        username: server.username,
                        password: server.hasPassword ? t("settings.sync.passwordStored") : t("settings.sync.passwordNone"),
                      })
                    : t("settings.sync.serverSummaryAnonymous", {
                        password: server.hasPassword ? t("settings.sync.passwordStored") : t("settings.sync.passwordNone"),
                      })}
                </span>
                {capabilities?.serverId === server.id ? (
                  <span>
                    {t("settings.sync.capabilitySummary", {
                      auth: capabilities.value.auth,
                      transfer: capabilities.value.supportsContentTransfer ? t("common.yes") : t("common.no"),
                      etag: capabilities.value.supportsEtagIfMatch ? t("common.yes") : t("common.no"),
                      move: capabilities.value.supportsMove ? t("common.yes") : t("common.no"),
                    })}
                  </span>
                ) : null}
              </div>
              <div className="app-settings-option-group">
                <button className="secondary-button" disabled={busy !== null} onClick={() => void probeServer(server.id)} type="button">
                  {busy === "probe" ? t("common.saving") : t("settings.sync.probe")}
                </button>
                <button className="secondary-button" disabled={busy !== null} onClick={() => startEdit(server)} type="button">
                  {t("settings.sync.edit")}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() => void deleteServer(server.id)}
                  type="button"
                >
                  {confirmingDeleteId === server.id ? t("settings.sync.deleteConfirm") : t("settings.sync.delete")}
                </button>
              </div>
            </div>
          </div>
        ))
      )}

      <div className="app-settings-card-divider" />
      <div className="app-settings-row-copy">
        <strong>{editingId ? t("settings.sync.editServer") : t("settings.sync.addServer")}</strong>
      </div>
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.sync.webdavUrl")}</strong>
          <span>{t("settings.sync.webdavUrlHint")}</span>
        </div>
        <input className="text-field" aria-label={t("settings.sync.webdavUrl")} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://nas.local/dav/share/" />
      </div>
      <div className="app-settings-row app-settings-row-stack">
        <div className="app-settings-row-copy">
          <strong>{t("settings.sync.credentials")}</strong>
          <span>{t("settings.sync.credentialsHint")}</span>
        </div>
        <div className="library-settings-name-row">
          <input className="text-field" aria-label={t("settings.sync.username")} value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("settings.sync.username")} />
          <input className="text-field" aria-label={t("settings.sync.password")} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={editingId ? t("settings.sync.passwordKeepHint") : t("settings.sync.password")} />
        </div>
      </div>
      <div className="app-settings-row">
        <div className="app-settings-row-copy">
          <strong>{t("settings.sync.insecureTls")}</strong>
          <span>{t("settings.sync.insecureTlsHint")}</span>
        </div>
        <input type="checkbox" checked={allowInsecureTls} onChange={(event) => setAllowInsecureTls(event.target.checked)} />
      </div>
      <div className="app-settings-card-divider" />
      {error ? <p className="settings-error-message">{error}</p> : null}
      {notice ? <p className="settings-success-message">{notice}</p> : null}
      <div className="app-settings-action-row">
        <span className="app-settings-row-copy" />
        <div className="app-settings-option-group">
          {editingId ? (
            <button className="secondary-button" disabled={busy !== null} onClick={resetForm} type="button">
              {t("common.cancel")}
            </button>
          ) : null}
          <button className="primary-button" disabled={busy !== null || !baseUrl.trim()} onClick={() => void saveServer()} type="button">
            {busy === "save" ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}
