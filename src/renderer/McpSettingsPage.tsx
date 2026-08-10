import { useEffect, useState, type ReactNode } from "react";

import {
  MCP_DEFAULT_PORT,
  type McpConfigFormat,
  type McpSettingsSnapshot,
  type SerpentMcpSettingsApi,
} from "../shared/mcp";
import { useT } from "./i18n";
import { SettingsCard } from "./ui/patterns";
import { Switch } from "./ui/primitives";

export function McpSettingsPage({ api }: { api?: SerpentMcpSettingsApi }): ReactNode {
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
  }), [api]);

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
        <div className="app-settings-row-copy">
          <strong>{t("settings.mcpIntroTitle")}</strong>
          <span>{t("settings.mcpIntroHint")}</span>
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-toggle-row">
          <span className="app-settings-row-copy">
            <strong>{t("settings.mcpEnabled")}</strong>
            <span>{t("settings.mcpEnabledHint")}</span>
          </span>
          <Switch
            aria-label={t("settings.mcpEnabled")}
            checked={snapshot?.preferences.enabled ?? false}
            disabled={busy}
            onCheckedChange={(enabled) => void request({ type: "enable", enabled })}
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
            disabled={busy || !(snapshot?.preferences.enabled ?? false)}
            onCheckedChange={(enabled) => void request({ type: "set-auto-start", enabled })}
          />
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.mcpStatus")}</strong>
            <span>
              {running && runtime
                ? `${runtime.endpoint} · ${t("settings.mcpConnections")}: ${runtime.connectedClientCount} · ${t("settings.mcpActiveSessions")}: ${runtime.activeSessionCount}`
                : statusLabel}
            </span>
          </div>
          {running ? (
            <button className="secondary-button" disabled={busy} onClick={() => void request({ type: "stop" })} type="button">
              {t("settings.mcpStop")}
            </button>
          ) : (
            <button className="secondary-button" disabled={busy || !(snapshot?.preferences.enabled ?? false)} onClick={() => void request({ type: "start" })} type="button">
              {t("settings.mcpStart")}
            </button>
          )}
        </div>
        <div className="app-settings-card-divider" />
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
        {error ? <p className="settings-error-message">{error}</p> : null}
        {notice ? <p className="settings-success-message">{notice}</p> : null}
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-action-row">
          <div className="app-settings-row-copy">
            <strong>{t("settings.mcpConfigTitle")}</strong>
            <span>{t("settings.mcpConfigHint")}</span>
          </div>
          <div className="app-settings-option-group">
            <select
              aria-label={t("settings.mcpConfigFormat")}
              className="settings-select"
              onChange={(event) => setFormat(event.target.value as McpConfigFormat)}
              value={format}
            >
              <option value="generic-json">{t("settings.mcpConfigGeneric")}</option>
              <option value="endpoint-and-token">{t("settings.mcpConfigEndpoint")}</option>
            </select>
            <button className="secondary-button" disabled={busy || !(snapshot?.preferences.enabled ?? false)} onClick={() => void request({ type: "create-client-config", input: { format } })} type="button">
              {t("settings.mcpCopyConfig")}
            </button>
          </div>
        </div>
        <div className="app-settings-card-divider" />
        <div className="app-settings-row-copy">
          <strong>{t("settings.mcpCredentialsTitle")}</strong>
          <span>{t("settings.mcpCredentialsHint")}</span>
        </div>
        {snapshot?.credentials.length ? (
          <ul className="app-settings-help-list">
            {snapshot.credentials.map((credential) => (
              <li key={credential.credentialId}>
                <span>{credential.label}</span>
                <button className="text-button" disabled={busy || credential.revokedAt !== null} onClick={() => void request({ type: "revoke-credential", credentialId: credential.credentialId })} type="button">
                  {credential.revokedAt === null ? t("settings.mcpRevoke") : t("settings.mcpRevoked")}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="app-settings-help-note">{t("settings.mcpNoCredentials")}</p>}
      </SettingsCard>

      <SettingsCard>
        <div className="app-settings-row-copy">
          <strong>{t("settings.mcpPermissionsTitle")}</strong>
          <span>{t("settings.mcpPermissionsHint")}</span>
        </div>
        {snapshot?.credentials.filter((credential) => credential.revokedAt === null).map((credential) => {
          const permissionState = snapshot.credentialPermissions.find(
            (candidate) => candidate.credentialId === credential.credentialId,
          );
          return (
            <div className="mcp-permission-client" key={credential.credentialId}>
              <div className="app-settings-card-divider" />
              <div className="app-settings-action-row">
                <div className="app-settings-row-copy">
                  <strong>{credential.label}</strong>
                  <span>{t("settings.mcpPermissionClientHint")}</span>
                </div>
                <select
                  aria-label={`${credential.label} ${t("settings.mcpAccessMode")}`}
                  className="settings-select"
                  disabled={busy}
                  onChange={(event) => {
                    void request({ type: "set-access-mode", credentialId: credential.credentialId, mode: event.target.value as "auto" | "full-access" });
                  }}
                  value={permissionState?.mode ?? "auto"}
                >
                  <option value="auto">{t("settings.mcpAccessModeAuto")}</option>
                  <option value="full-access">{t("settings.mcpAccessModeFull")}</option>
                </select>
              </div>
              <p className="app-settings-help-note">
                {permissionState?.mode === "full-access"
                  ? t("settings.mcpAccessModeFullHint")
                  : t("settings.mcpAccessModeAutoHint")}
              </p>
            </div>
          );
        })}
      </SettingsCard>

    </>
  );
}
