import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import type { SyncCapabilities, SyncReport } from "../shared/library-api";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";
import type { SyncServerSummary } from "./sync-settings-types";

type LibrarySettingsCategory = "general" | "ignore" | "sync";

export interface SyncSettingsCallbacks {
  syncListServers(): Promise<{ ok: true; value: SyncServerSummary[] } | { ok: false; message: string }>;
  syncProbe(input: { serverId: string }): Promise<{ ok: true; value: SyncCapabilities } | { ok: false; message: string }>;
  syncPreview(input: { libraryId: string; serverId: string; subPath: string }): Promise<{ ok: true; value: SyncReport } | { ok: false; message: string }>;
  syncRun(input: { libraryId: string; serverId: string; subPath: string }): Promise<{ ok: true; value: { report: SyncReport; conflicts: Array<{ syncId: string; conflictCopyPath: string }> } } | { ok: false; message: string }>;
  syncSaveBinding(input: { libraryId: string; serverId: string; subPath: string }): Promise<{ ok: true } | { ok: false; message: string }>;
  syncGetBinding(input: { libraryId: string }): Promise<{ ok: true; value: { serverId: string; subPath: string } | null } | { ok: false; message: string }>;
}

function SyncSettingsSection({
  library,
  callbacks,
}: {
  library: RendererLibrarySummary;
  callbacks: SyncSettingsCallbacks;
}): ReactNode {
  const t = useT();
  const [servers, setServers] = useState<SyncServerSummary[]>([]);
  const [serverId, setServerId] = useState("");
  const [subPath, setSubPath] = useState("");
  const [busy, setBusy] = useState<"probe" | "preview" | "run" | "save" | null>(null);
  const [capabilities, setCapabilities] = useState<SyncCapabilities | null>(null);
  const [preview, setPreview] = useState<SyncReport | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const listed = await callbacks.syncListServers();
      if (!listed.ok) return;
      setServers(listed.value);
      const binding = await callbacks.syncGetBinding({ libraryId: library.libraryId });
      if (binding.ok && binding.value) {
        setServerId(binding.value.serverId);
        setSubPath(binding.value.subPath);
      } else if (listed.value.length > 0 && !serverId) {
        setServerId(listed.value[0]!.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.libraryId]);

  const runProbe = async () => {
    setBusy("probe");
    setError(null);
    setCapabilities(null);
    try {
      const probe = await callbacks.syncProbe({ serverId });
      if (probe.ok) {
        setCapabilities(probe.value);
        if (!probe.value.supportsContentTransfer) setError(t("settings.sync.contentTransferUnsupported"));
      } else {
        setError(probe.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    setPreview(null);
    try {
      const previewResult = await callbacks.syncPreview({ libraryId: library.libraryId, serverId, subPath });
      if (previewResult.ok) setPreview(previewResult.value);
      else setError(previewResult.message);
    } finally {
      setBusy(null);
    }
  };

  const runSync = async () => {
    setBusy("run");
    setError(null);
    setResult(null);
    try {
      const syncResult = await callbacks.syncRun({ libraryId: library.libraryId, serverId, subPath });
      if (syncResult.ok) {
        const report = syncResult.value.report;
        setResult(t("settings.sync.completedSummary", {
          uploads: report.uploads,
          downloads: report.downloads,
          conflicts: report.conflicts,
        }));
        if (syncResult.value.conflicts.length > 0) {
          setError(t("settings.sync.conflictsDetected", { count: syncResult.value.conflicts.length }));
        }
      } else {
        setError(syncResult.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const saveBinding = async () => {
    setBusy("save");
    setError(null);
    try {
      const saved = await callbacks.syncSaveBinding({ libraryId: library.libraryId, serverId, subPath });
      if (!saved.ok) setError(saved.message);
      else setResult(t("settings.sync.bindingSaved"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="app-settings-page-heading">
        <h3>{t("settings.sync.title")}</h3>
        <p>{t("settings.sync.hint")}</p>
      </div>
      <section className="app-settings-card">
        <div className="app-settings-row app-settings-row-stack">
          <div className="app-settings-row-copy">
            <strong>{t("settings.sync.server")}</strong>
            <span>{t("settings.sync.serverHint")}</span>
          </div>
          {servers.length === 0 ? (
            <p className="library-settings-gitignore-help">{t("settings.sync.noServer")}</p>
          ) : (
            <select className="text-field" aria-label={t("settings.sync.server")} value={serverId} onChange={(event) => setServerId(event.target.value)}>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>{server.baseUrl}</option>
              ))}
            </select>
          )}
        </div>
        <div className="app-settings-row app-settings-row-stack">
          <div className="app-settings-row-copy">
            <strong>{t("settings.sync.subPath")}</strong>
            <span>{t("settings.sync.subPathHint")}</span>
          </div>
          <input className="text-field" aria-label={t("settings.sync.subPath")} value={subPath} onChange={(event) => setSubPath(event.target.value)} placeholder="Share/Serpent" />
        </div>
        <div className="app-settings-card-divider" />
        <div className="library-settings-gitignore-actions">
          <button className="primary-button" disabled={busy !== null || !serverId} onClick={() => void runProbe()} type="button">
            {busy === "probe" ? t("common.saving") : t("settings.sync.probe")}
          </button>
          <button className="primary-button" disabled={busy !== null || !serverId} onClick={() => void runPreview()} type="button">
            {busy === "preview" ? t("common.saving") : t("settings.sync.preview")}
          </button>
          <button className="primary-button" disabled={busy !== null || !serverId} onClick={() => void runSync()} type="button">
            {busy === "run" ? t("common.saving") : t("settings.sync.run")}
          </button>
          <button className="primary-button" disabled={busy !== null || !serverId} onClick={() => void saveBinding()} type="button">
            {busy === "save" ? t("common.saving") : t("common.save")}
          </button>
        </div>
        {capabilities ? (
          <p className="library-settings-gitignore-help">
            {t("settings.sync.capabilitySummary", {
              auth: capabilities.auth,
              transfer: capabilities.supportsContentTransfer ? t("common.yes") : t("common.no"),
              etag: capabilities.supportsEtagIfMatch ? t("common.yes") : t("common.no"),
              move: capabilities.supportsMove ? t("common.yes") : t("common.no"),
            })}
          </p>
        ) : null}
        {preview ? (
          <p className="library-settings-gitignore-help">
            {t("settings.sync.previewSummary", {
              uploads: preview.uploads,
              downloads: preview.downloads,
              conflicts: preview.conflicts,
              remoteDeletes: preview.remoteDeletes,
              localRecycles: preview.localRecycles,
            })}
          </p>
        ) : null}
        {result ? <p className="library-settings-gitignore-help">{result}</p> : null}
        {error ? <p className="library-settings-gitignore-help">{error}</p> : null}
      </section>
    </>
  );
}

export function LibrarySettingsDialog({
  library,
  gitignoreContent,
  open,
  onClose,
  focusNameOnOpen = false,
  onSaveName,
  onSaveGitignore,
  syncCallbacks,
}: {
  library: RendererLibrarySummary | null;
  gitignoreContent: string;
  open: boolean;
  onClose: () => void;
  focusNameOnOpen?: boolean;
  onSaveName: (name: string) => Promise<void>;
  onSaveGitignore: (content: string) => Promise<void>;
  syncCallbacks: SyncSettingsCallbacks;
}): ReactNode {
  const t = useT();
  const [category, setCategory] = useState<LibrarySettingsCategory>("general");
  const [name, setName] = useState(library?.displayName ?? "");
  const [gitignoreDraft, setGitignoreDraft] = useState(gitignoreContent);
  const [savingName, setSavingName] = useState(false);
  const [savingIgnore, setSavingIgnore] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !focusNameOnOpen) return;
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusNameOnOpen, open]);

  if (!open || !library) return null;

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === library.displayName || savingName) return;
    setSavingName(true);
    try {
      await onSaveName(next);
    } finally {
      setSavingName(false);
    }
  };

  const saveGitignore = async () => {
    if (savingIgnore || gitignoreDraft === gitignoreContent) return;
    setSavingIgnore(true);
    try {
      await onSaveGitignore(gitignoreDraft);
    } finally {
      setSavingIgnore(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }} role="presentation">
      <DialogShell
        className="create-dialog app-settings-dialog library-settings-dialog"
        contentClassName="ui-dialog-shell__content--flush"
        dialogId="library-settings-dialog"
        headerActions={
          <button className="dialog-close" onClick={onClose} type="button" {...iconActionAttrs(t("common.close"))}>
            <Icon name="close" size={16} />
          </button>
        }
        style={{ padding: 0 }}
        title={t("settings.librarySettings")}
      >
        <div className="app-settings-frame library-settings-frame">
          <nav aria-label={t("settings.librarySettingsCategories")} className="app-settings-nav">
            <div className="app-settings-nav-list" role="tablist">
              {(["general", "ignore", "sync"] as const).map((item) => {
                const selected = category === item;
                return (
                  <button
                    aria-selected={selected}
                    className={`app-settings-nav-item${selected ? " is-active" : ""}`}
                    id={`library-settings-tab-${item}`}
                    key={item}
                    onClick={() => setCategory(item)}
                    role="tab"
                    type="button"
                  >
                    <Icon name={item === "general" ? "settings" : item === "ignore" ? "eye-off" : "refresh"} size={16} />
                    <span>{t(item === "general" ? "settings.libraryGeneral" : item === "ignore" ? "settings.libraryIgnore" : "settings.sync.title")}</span>
                  </button>
                );
              })}
            </div>
          </nav>
          <main
            aria-labelledby={`library-settings-tab-${category}`}
            className="app-settings-content"
            role="tabpanel"
          >
            {category === "general" ? (
              <>
                <div className="app-settings-page-heading">
                  <h3>{t("settings.libraryGeneral")}</h3>
                  <p>{t("settings.libraryGeneralHint")}</p>
                </div>
                <section className="app-settings-card">
                  <div className="app-settings-row app-settings-row-stack">
                    <div className="app-settings-row-copy">
                      <strong>{t("settings.libraryName")}</strong>
                      <span>{t("settings.libraryNameHint")}</span>
                    </div>
                    <div className="library-settings-name-row">
                      <input className="text-field" ref={nameInputRef} value={name} onChange={(event) => setName(event.target.value)} />
                      <button className="primary-button" disabled={!name.trim() || savingName} onClick={() => void saveName()} type="button">{t("common.save")}</button>
                    </div>
                  </div>
                  <div className="app-settings-card-divider" />
                  <div className="app-settings-row app-settings-row-stack">
                    <div className="app-settings-row-copy">
                      <strong>{t("settings.libraryLocation")}</strong>
                      <span className="library-settings-path">{library.displayPath}</span>
                    </div>
                  </div>
                  <div className="app-settings-card-divider" />
                  <div className="app-settings-row app-settings-row-stack">
                    <div className="app-settings-row-copy">
                      <strong>{t("settings.libraryDescription")}</strong>
                      <span>{t("settings.libraryDescriptionUnsupported")}</span>
                    </div>
                  </div>
                </section>
              </>
            ) : category === "ignore" ? (
              <>
                <div className="app-settings-page-heading">
                  <h3>{t("settings.libraryIgnore")}</h3>
                  <p>{t("settings.libraryIgnoreHint")}</p>
                </div>
                <section className="app-settings-card library-settings-gitignore-card">
                  <div className="library-settings-gitignore-heading">
                    <div className="app-settings-row-copy">
                      <strong>{t("settings.gitignoreFile")}</strong>
                      <span>{t("settings.gitignoreFileHint")}</span>
                    </div>
                    <button
                      aria-expanded={helpOpen}
                      className="library-settings-help-button"
                      onClick={() => setHelpOpen((current) => !current)}
                      title={t("settings.gitignoreSyntax")}
                      type="button"
                    >
                      ?
                    </button>
                  </div>
                  {helpOpen ? <p className="library-settings-gitignore-help">{t("settings.gitignoreSyntax")}</p> : null}
                  <textarea
                    aria-label={t("settings.gitignoreFile")}
                    className="library-settings-gitignore-editor"
                    onChange={(event) => setGitignoreDraft(event.target.value)}
                    onBlur={() => void saveGitignore()}
                    spellCheck={false}
                    value={gitignoreDraft}
                  />
                  <div className="library-settings-gitignore-actions">
                    <span>{t("settings.gitignoreSaveHint")}</span>
                    <button className="primary-button" disabled={savingIgnore} onClick={() => void saveGitignore()} type="button">
                      {savingIgnore ? t("common.saving") : t("common.save")}
                    </button>
                  </div>
                </section>
              </>
            ) : (
              <SyncSettingsSection library={library} callbacks={syncCallbacks} />
            )}
          </main>
        </div>
      </DialogShell>
    </div>
  );
}
