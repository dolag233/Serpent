import { useState, type ReactNode } from "react";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

type LibrarySettingsCategory = "general" | "ignore";

export function LibrarySettingsDialog({
  library,
  gitignoreContent,
  open,
  onClose,
  onSaveName,
  onSaveGitignore,
}: {
  library: RendererLibrarySummary | null;
  gitignoreContent: string;
  open: boolean;
  onClose: () => void;
  onSaveName: (name: string) => Promise<void>;
  onSaveGitignore: (content: string) => Promise<void>;
}): ReactNode {
  const t = useT();
  const [category, setCategory] = useState<LibrarySettingsCategory>("general");
  const [name, setName] = useState(library?.displayName ?? "");
  const [gitignoreDraft, setGitignoreDraft] = useState(gitignoreContent);
  const [savingName, setSavingName] = useState(false);
  const [savingIgnore, setSavingIgnore] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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
      <div className="create-dialog app-settings-dialog library-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="library-settings-title">
        <div className="dialog-heading app-settings-heading">
          <h2 id="library-settings-title">{t("settings.librarySettings")}</h2>
          <button className="dialog-close" onClick={onClose} type="button" {...iconActionAttrs(t("common.close"))}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="app-settings-frame library-settings-frame">
          <nav aria-label={t("settings.librarySettingsCategories")} className="app-settings-nav">
            <div className="app-settings-nav-list" role="tablist">
              {(["general", "ignore"] as const).map((item) => {
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
                    <Icon name={item === "general" ? "settings" : "eye-off"} size={16} />
                    <span>{t(item === "general" ? "settings.libraryGeneral" : "settings.libraryIgnore")}</span>
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
                      <input className="text-field" value={name} onChange={(event) => setName(event.target.value)} />
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
            ) : (
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
                      {savingIgnore ? t("text.saving") : t("common.save")}
                    </button>
                  </div>
                </section>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
