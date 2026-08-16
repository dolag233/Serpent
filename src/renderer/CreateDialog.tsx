import { type FormEvent } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import type { RecentLibraryMenuEntry } from "./LibrarySwitcher";
import { DialogShell } from "./ui/patterns";

export type CreateLibraryPhase = "start" | "form" | "eagle" | "billfish";

export interface CreateDialogProps {
  open: boolean;
  /**
   * Serpent-kipk: `start` is the no-library surface; `form` is the name
   * prompt for creating a Serpent library; `eagle`/`billfish` are the same
   * name prompt after a validated external source, before choosing the save
   * location.
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
  /** One-click open from the recent list. */
  onOpenRecent: (path: string) => void;
  /** Serpent-kqgy: remove a library from the recent list (not from disk). */
  onForgetRecent?: (path: string) => void;
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
 * and canvas content are defocused. The no-library start surface keeps open /
 * import CTAs. Menu 「新建资源库」 opens the name form only (Serpent-pte2).
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
  onOpenRecent,
  onForgetRecent,
  recentLibraries = [],
  busy = false,
  required = false,
}: CreateDialogProps) {
  const t = useT();
  if (!open) return null;

  const showRecents =
    required && phase === "start" && recentLibraries.length > 0;
  // Serpent-s0oq: the create dialog shows at most five most-recent libraries;
  // the list container scrolls when the store holds more (cap is 8). Rows
  // always show name + full path (the dialog's original layout).
  const visibleRecents = showRecents ? recentLibraries.slice(0, 5) : [];
  const isNameForm = phase === "form" || phase === "eagle" || phase === "billfish";
  const isBillfish = phase === "billfish";
  const isExternalLibrary = phase === "eagle" || isBillfish;
  const title =
    isExternalLibrary
      ? t(isBillfish ? "dialog.openBillfishLibrary.title" : "dialog.openEagleLibrary.title")
      : t("empty.noLibraryTitle");
  const body =
    isExternalLibrary
      ? t(isBillfish ? "dialog.openBillfishLibrary.body" : "dialog.openEagleLibrary.body")
      : t("empty.noLibraryBody");
  const nameLabel =
    isExternalLibrary
      ? t(isBillfish ? "dialog.openBillfishLibrary.name" : "dialog.openEagleLibrary.name")
      : t("dialog.createLibrary.name");
  const nameHelp =
    isExternalLibrary
      ? t(isBillfish ? "dialog.openBillfishLibrary.help" : "dialog.openEagleLibrary.help")
      : t("dialog.createLibrary.help");
  const submitLabel =
    isExternalLibrary
      ? t(isBillfish ? "dialog.openBillfishLibrary.submit" : "dialog.openEagleLibrary.submit")
      : t("dialog.createLibrary.submit");

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog create-library-dialog"
        dialogId="create-library-dialog"
        headerActions={
          !required ? (
            <button
              className="dialog-close"
              onClick={onCancel}
              type="button"
              {...iconActionAttrs(t("common.cancel"))}
            >
              <Icon name="close" size={16} />
            </button>
          ) : null
        }
        style={{ padding: 0 }}
        title={title}
        description={
          <span className="create-library-lead">
            {body}
          </span>
        }
      >
        {isNameForm ? (
          <form
            className="create-library-form"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!value.trim() || busy) return;
              onSubmit();
            }}
          >
            <label className="field-label" htmlFor="dialog-name">
              {nameLabel}
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
            {nameHelp.trim() ? (
              <p className="field-help">{nameHelp}</p>
            ) : null}
            <div className="dialog-actions">
              {required || phase === "eagle" ? (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={onBackToStart}
                  type="button"
                >
                  {t("common.back")}
                </button>
              ) : null}
              <button
                className="primary-button"
                disabled={busy || !value.trim()}
                type="submit"
              >
                {submitLabel}
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
            {required ? (
              <>
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
              </>
            ) : null}
          </div>
        )}

        {showRecents ? (
          <div className="create-dialog-existing">
            <div className="create-dialog-existing-label">
              {t("empty.recentLibraries")}
            </div>
            <ul className="create-dialog-recent-list">
              {visibleRecents.map((entry) => (
                <li className="create-dialog-recent-row" key={entry.path}>
                  {/* Serpent-kqgy follow-up: the forget affordance lives inside
                      the full-width row button (far right), not as a separate
                      button — one row, one button. */}
                  <button
                    className="create-dialog-recent-open"
                    disabled={busy}
                    onClick={() => onOpenRecent(entry.path)}
                    title={entry.path}
                    type="button"
                  >
                    <span className="create-dialog-recent-texts">
                      <span className="create-dialog-recent-name">
                        {entry.name}
                      </span>
                      <span className="create-dialog-recent-path">
                        {entry.path}
                      </span>
                    </span>
                    {onForgetRecent != null && (
                      <span
                        aria-label={t("shell.forgetRecentLibrary")}
                        className="create-dialog-recent-forget"
                        onClick={(event) => {
                          event.stopPropagation();
                          onForgetRecent(entry.path);
                        }}
                        role="button"
                        tabIndex={-1}
                        title={t("shell.forgetRecentLibrary")}
                      >
                        <Icon name="close" size={12} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogShell>
    </div>
  );
}
