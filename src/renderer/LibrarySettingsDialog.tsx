import { useState } from "react";
import type { IgnoredPath } from "../shared/asset-types";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { Icon } from "./Icons";
import { useT } from "./i18n";

export function LibrarySettingsDialog({
  library,
  paths,
  open,
  onClose,
  onSaveName,
  onUnignore,
}: {
  library: RendererLibrarySummary | null;
  paths: IgnoredPath[];
  open: boolean;
  onClose: () => void;
  onSaveName: (name: string) => Promise<void>;
  onUnignore: (path: IgnoredPath) => void;
}) {
  const t = useT();
  const [name, setName] = useState(library?.displayName ?? "");
  const [saving, setSaving] = useState(false);

  if (!open || !library) return null;
  const saveName = async () => {
    const next = name.trim();
    if (!next || next === library.displayName || saving) return;
    setSaving(true);
    try {
      await onSaveName(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }} role="presentation">
      <div className="create-dialog app-settings-dialog library-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="library-settings-title">
        <div className="dialog-heading app-settings-heading">
          <h2 id="library-settings-title">{t("settings.librarySettings")}</h2>
          <button className="dialog-close" onClick={onClose} type="button" aria-label={t("common.close")}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="app-settings-frame library-settings-frame">
          <div className="app-settings-content">
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
                  <input className="text-field" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveName(); }} />
                  <button className="primary-button" disabled={!name.trim() || saving} onClick={() => void saveName()} type="button">{t("common.save")}</button>
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

            <div className="app-settings-page-heading library-settings-section-heading">
              <h3>{t("settings.ignoredPathsTitle")}</h3>
              <p>{t("settings.ignoredPathsHint")}</p>
            </div>
            <section className="app-settings-card">
              {paths.length === 0 ? (
                <p className="empty-state">{t("settings.ignoredPathsEmpty")}</p>
              ) : (
                <div className="ignored-paths-list">
                  {paths.map((path) => (
                    <div className="ignored-path-row" key={`${path.locationKind}:${path.linkedFolderId ?? ""}:${path.pathKind}:${path.relativePath}`}>
                      <div>
                        <strong>{path.displayName}</strong>
                        <span>{path.pathKind === "folder" ? t("settings.ignoredFolder") : path.pathKind === "extension" ? t("settings.ignoredExtension") : t("settings.ignoredAsset")}</span>
                      </div>
                      <button className="secondary-button" onClick={() => onUnignore(path)} type="button">{t("menu.unignore")}</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
