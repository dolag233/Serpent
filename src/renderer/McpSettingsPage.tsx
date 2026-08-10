import { useEffect, useState, type ReactNode } from "react";

import {
  MCP_DEFAULT_PORT,
  type McpConfigFormat,
  type McpSettingsSnapshot,
  type SerpentMcpSettingsApi,
} from "../shared/mcp";
import { Icon } from "./Icons";
import { useT } from "./i18n";
import { SettingsCard, SettingsDisclosure } from "./ui/patterns";
import { Switch } from "./ui/primitives";

function CredentialLabel({
  label,
  busy,
  onRename,
}: {
  label: string;
  busy: boolean;
  onRename(next: string): void;
}): ReactNode {
  const [draft, setDraft] = useState(label);
  // Keep the draft in sync when the snapshot refreshes (render-time state
  // adjustment, not an effect).
  const [committedLabel, setCommittedLabel] = useState(label);
  if (committedLabel !== label) {
    setCommittedLabel(label);
    setDraft(label);
  }
  return (
    <input
      aria-label="客户端名称"
      className="mcp-client-name"
      disabled={busy}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next.length > 0 && next !== label) onRename(next);
        else setDraft(label);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(label);
      }}
      title="点击重命名"
      type="text"
      value={draft}
    />
  );
}

export function McpSettingsPage({
  api,
  onOpenAppLog,
}: {
  api?: SerpentMcpSettingsApi;
  onOpenAppLog?: () => void;
}): ReactNode {
  const t = useT();
  const [snapshot, setSnapshot] = useState<McpSettingsSnapshot | null>(null);
  const [portDraft, setPortDraft] = useState(String(MCP_DEFAULT_PORT));
  const [format, setFormat] = useState<McpConfigFormat>("generic-json");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.request({ type: "get" }).then((response) => {
      if (!active) return;
      if (response.snapshot) {
        setSnapshot(response.snapshot);
        setPortDraft(String(response.snapshot.preferences.port));
      }
      if (!response.ok) setError(response.message);
    }).catch(() => {
      if (active) setError(t("settings.mcpUnavailable"));
    });
    return () => {
      active = false;
    };
  }, [api, t]);

  useEffect(() => api?.onChanged((nextSnapshot) => {
    setSnapshot(nextSnapshot);
    setPortDraft(String(nextSnapshot.preferences.port));
  }) ?? undefined, [api]);

  async function request(input: Parameters<SerpentMcpSettingsApi["request"]>[0]): Promise<void> {
    if (!api) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.request(input);
      if (response.snapshot) {
        setSnapshot(response.snapshot);
        setPortDraft(String(response.snapshot.preferences.port));
      }
      if (!response.ok) setError(response.message);
      else if (response.copied) setNotice(t("settings.mcpConfigCopied"));
    } catch {
      setError(t("settings.mcpOperationFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!api) {
    return <SettingsCard><p>{t("settings.mcpUnavailable")}</p></SettingsCard>;
  }

  const runtime = snapshot?.runtime;
  const running = runtime?.status === "running";
  const enabled = snapshot?.preferences.enabled ?? false;
  const status = runtime?.status ?? "stopped";
  const statusLabel = status === "stopped"
    ? t("settings.mcpStatusStopped")
    : status === "starting"
      ? t("settings.mcpStatusStarting")
      : status === "running"
        ? t("settings.mcpStatusRunning")
        : status === "stopping"
          ? t("settings.mcpStatusStopping")
          : t("settings.mcpStatusError");

  return (
    <>
      <SettingsCard>
        <div className="app-settings-toggle-row">
          <span className="app-settings-row-copy">
            <strong>{t("settings.mcpEnabled")}</strong>
            <span>
              {t("settings.mcpEnabledHint")}
              {running && runtime ? ` · ${statusLabel} · ${runtime.endpoint} · ${t("settings.mcpConnections")}: ${runtime.connectedClientCount}` : ""}
            </span>
          </span>
          <Switch
            aria-label={t("settings.mcpEnabled")}
            checked={enabled}
            disabled={busy}
            onCheckedChange={(next) => void request({ type: "enable", enabled: next })}
          />
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-toggle-row">
          <span className="app-settings-row-copy">
            <strong>{t("settings.mcpAutoStart")}</strong>
            <span>{t("settings.mcpAutoStartHint")}</span>
          </span>
          <Switch
            aria-label={t("settings.mcpAutoStart")}
            checked={snapshot?.preferences.autoStart ?? false}
            disabled={busy || !enabled}
            onCheckedChange={(next) => void request({ type: "set-auto-start", enabled: next })}
          />
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.mcpStatus")}</strong>
            <span>
              {running && runtime
                ? `${t("settings.mcpConnections")}: ${runtime.connectedClientCount} · ${t("settings.mcpActiveSessions")}: ${runtime.activeSessionCount}`
                : statusLabel}
            </span>
          </div>
          {running ? (
            <button className="primary-button" disabled={busy} onClick={() => void request({ type: "stop" })} type="button">
              {t("settings.mcpStop")}
            </button>
          ) : (
            <button className="primary-button" disabled={busy || !enabled} onClick={() => void request({ type: "start" })} type="button">
              {t("settings.mcpStart")}
            </button>
          )}
        </div>
        {error ? <p className="settings-error-message">{error}</p> : null}
        {notice ? <p className="settings-success-message">{notice}</p> : null}
        <SettingsDisclosure
          defaultOpen={false}
          hint={t("settings.mcpAdvancedHint")}
          title={t("settings.mcpAdvanced")}
        >
          <label className="app-settings-row app-settings-row-inline" htmlFor="mcp-port">
            <span className="app-settings-row-copy">
              <strong>{t("settings.mcpPort")}</strong>
              <span>{t("settings.mcpPortHint")}</span>
            </span>
            <input
              aria-label={t("settings.mcpPort")}
              className="settings-number-input"
              disabled={busy || running}
              id="mcp-port"
              max={65535}
              min={1024}
              onBlur={() => {
                const port = Number(portDraft);
                if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
                  void request({ type: "set-port", port });
                } else if (snapshot) {
                  setPortDraft(String(snapshot.preferences.port));
                }
              }}
              onChange={(event) => setPortDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              type="number"
              value={portDraft}
            />
          </label>
          <div className="app-settings-action-row">
            <div className="app-settings-row-copy">
              <strong>{t("settings.mcpConfigFormat")}</strong>
              <span>{t("settings.mcpConfigFormatHint")}</span>
            </div>
            <select
              aria-label={t("settings.mcpConfigFormat")}
              className="settings-select"
              onChange={(event) => setFormat(event.target.value as McpConfigFormat)}
              value={format}
            >
              <option value="generic-json">{t("settings.mcpConfigGeneric")}</option>
              <option value="claude">{t("settings.mcpConfigClaude")}</option>
              <option value="cursor">{t("settings.mcpConfigCursor")}</option>
              <option value="codex">{t("settings.mcpConfigCodex")}</option>
              <option value="endpoint-and-token">{t("settings.mcpConfigEndpoint")}</option>
            </select>
          </div>
        </SettingsDisclosure>
        {onOpenAppLog ? (
          <div className="app-settings-card-divider" />
        ) : null}
        {onOpenAppLog ? (
          <div className="app-settings-action-row">
            <div className="app-settings-row-copy">
              <strong>{t("settings.mcpLogTitle")}</strong>
              <span>{t("settings.mcpLogHint")}</span>
            </div>
            <button className="secondary-button" onClick={onOpenAppLog} type="button">
              {t("settings.mcpOpenLog")}
            </button>
          </div>
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.mcpCredentialsTitle")}</strong>
            <span>{t("settings.mcpCredentialsHint")}</span>
          </div>
          <button
            className="primary-button"
            disabled={busy || !enabled}
            onClick={() => void request({ type: "create-client-config", input: { format } })}
            type="button"
          >
            {t("settings.mcpAddClient")}
          </button>
        </div>
        {snapshot?.credentials.filter((credential) => credential.revokedAt === null).length ? (
          snapshot!.credentials.filter((credential) => credential.revokedAt === null).map((credential) => {
            const permissionState = snapshot!.credentialPermissions.find(
              (candidate) => candidate.credentialId === credential.credentialId,
            );
            const mode = permissionState?.mode ?? "read-write";
            return (
              <div className="mcp-permission-client" key={credential.credentialId}>
                <div className="app-settings-card-divider" />
                <div className="app-settings-action-row">
                  <div className="app-settings-row-copy">
                    <CredentialLabel
                      busy={busy}
                      label={credential.label}
                      onRename={(next) => void request({ type: "rename-credential", credentialId: credential.credentialId, label: next })}
                    />
                    <span>
                      {mode === "full-access"
                        ? t("settings.mcpAccessModeFullHint")
                        : mode === "read-only"
                          ? t("settings.mcpAccessModeReadOnlyHint")
                          : t("settings.mcpAccessModeReadWriteHint")}
                    </span>
                  </div>
                  <div className="app-settings-option-group">
                    <select
                      aria-label={`${credential.label} ${t("settings.mcpAccessMode")}`}
                      className="settings-select"
                      disabled={busy}
                      onChange={(event) => {
                        void request({ type: "set-access-mode", credentialId: credential.credentialId, mode: event.target.value as "read-only" | "read-write" | "full-access" });
                      }}
                      value={mode}
                    >
                      <option value="read-only">{t("settings.mcpAccessModeReadOnly")}</option>
                      <option value="read-write">{t("settings.mcpAccessModeReadWrite")}</option>
                      <option value="full-access">{t("settings.mcpAccessModeFull")}</option>
                    </select>
                    <button
                      aria-label={t("settings.mcpCopyCredential")}
                      className="mcp-client-action"
                      disabled={busy}
                      onClick={() => void request({ type: "duplicate-credential", credentialId: credential.credentialId, format })}
                      title={t("settings.mcpCopyCredential")}
                      type="button"
                    >
                      <Icon name="copy" size={15} />
                    </button>
                    <button
                      aria-label={t("settings.mcpDeleteCredential")}
                      className="mcp-client-action"
                      disabled={busy}
                      onClick={() => void request({ type: "revoke-credential", credentialId: credential.credentialId })}
                      title={t("settings.mcpDeleteCredential")}
                      type="button"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="app-settings-help-note">{t("settings.mcpNoCredentials")}</p>
        )}
      </SettingsCard>
    </>
  );
}
