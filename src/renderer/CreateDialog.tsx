import { type FormEvent } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import type { RecentLibraryMenuEntry } from "./LibrarySwitcher";

export type CreateLibraryPhase = "start" | "form";

export interface CreateDialogProps {
  open: boolean;
  /**
   * Serpent-kipk: `start` is the no-library surface; `form` is the name
   * prompt. Both share the same full-window modal shell.
   */
  phase: CreateLibraryPhase;
  value: string;
  onValueChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Switch from start CTAs into the name form. */
  onBeginCreate: () => void;
  /** Return from the name form to start CTAs (required/no-library only). */
  onBackToStart: () => void;
  /** Open an existing library via the native folder picker (Serpent-y0au). */
  onOpenExisting: () => void;
  /** Import a library folder/ZIP (same entry as the former empty-state CTA). */
  onImportLibrary: () => void;
  /** Open the unbound automation Console without creating a library first. */
  onOpenAutomation: () => void;
  /** One-click open from the recent list. */
  onOpenRecent: (path: string) => void;
  recentLibraries?: RecentLibraryMenuEntry[];
  busy?: boolean;
  /**
   * When true (no library open), hide dismiss controls so the surface stays
   * until a library is opened or created.
   */
  required?: boolean;
}

/**
 * Unified create / no-library start dialog (Serpent-kipk / y0au).
 *
 * Renders as a full-window centered modal with backdrop blur so shell chrome
 * and canvas content are defocused. Menu 「创建资源库」 and the no-library
 * start surface share this component.
 */
export function CreateDialog({
  open,
  phase,
  value,
  onValueChange,
  onSubmit,
  onCancel,
  onBeginCreate,
  onBackToStart,
  onOpenExisting,
  onImportLibrary,
  onOpenAutomation,
  onOpenRecent,
  recentLibraries = [],
  busy = false,
  required = false,
}: CreateDialogProps) {
  const t = useT();
  if (!open) return null;

  const titleId = "create-dialog-title";
  const showRecents =
    required && phase === "start" && recentLibraries.length > 0;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="create-dialog create-library-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id={titleId}>{t("empty.noLibraryTitle")}</h2>
            <p className="create-library-lead">{t("empty.noLibraryBody")}</p>
          </div>
          {!required ? (
            <button
              className="dialog-close"
              onClick={onCancel}
              type="button"
              {...iconActionAttrs(t("common.cancel"))}
            >
              <Icon name="close" size={16} />
            </button>
          ) : null}
        </div>

        {phase === "form" ? (
          <form
            className="create-library-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!value.trim() || busy) return;
              onSubmit();
            }}
          >
            <label className="field-label" htmlFor="dialog-name">
              {t("dialog.createLibrary.name")}
            </label>
            <input
              autoFocus
              className="text-field"
              disabled={busy}
              id="dialog-name"
              maxLength={255}
              onChange={(event) => onValueChange(event.target.value)}
              value={value}
            />
            {t("dialog.createLibrary.help").trim() ? (
              <p className="field-help">{t("dialog.createLibrary.help")}</p>
            ) : null}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={onBackToStart}
                type="button"
              >
                {t("common.back")}
              </button>
              <button
                className="primary-button"
                disabled={busy || !value.trim()}
                type="submit"
              >
                {t("dialog.createLibrary.submit")}
              </button>
            </div>
          </form>
        ) : (
          <div className="empty-actions create-library-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={onBeginCreate}
              type="button"
            >
              <Icon name="plus" size={15} />
              {t("shell.createLibrary")}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onOpenExisting}
              type="button"
            >
              <Icon name="folder" size={15} />
              {t("shell.openLibrary")}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onImportLibrary}
              type="button"
            >
              <Icon name="download" size={15} />
              {t("toolbar.importLibrary")}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onOpenAutomation}
              type="button"
            >
              {t("automation.preview.open")}
            </button>
          </div>
        )}

        {showRecents ? (
          <div className="create-dialog-existing">
            <div className="create-dialog-existing-label">
              {t("empty.recentLibraries")}
            </div>
            <ul className="create-dialog-recent-list">
              {recentLibraries.map((entry) => (
                <li key={entry.path}>
                  <button
                    className="create-dialog-recent-open"
                    disabled={busy}
                    onClick={() => onOpenRecent(entry.path)}
                    title={entry.path}
                    type="button"
                  >
                    <span className="create-dialog-recent-name">
                      {entry.name}
                    </span>
                    <span className="create-dialog-recent-path">
                      {entry.path}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
