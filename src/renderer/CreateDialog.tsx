import { type FormEvent } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import type { RecentLibraryMenuEntry } from "./LibrarySwitcher";

export interface CreateDialogProps {
  open: boolean;
  value: string;
  onValueChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Open an existing library via the native folder picker (Serpent-y0au). */
  onOpenExisting?: () => void;
  /** One-click open from the recent list shown inside the create flow. */
  onOpenRecent?: (path: string) => void;
  recentLibraries?: RecentLibraryMenuEntry[];
  busy?: boolean;
}

/**
 * Library-creation dialog. Folder creation used to share this dialog until
 * REQ-FOLDER-007 moved folder create/rename to inline editing in the directory
 * tree; what remains here is the local-library name prompt only.
 *
 * Serpent-y0au: the create flow also surfaces opening an existing library
 * (picker + recent list) so users are not forced back to the empty-state
 * 「打开资源库…」 button alone.
 */
export function CreateDialog({
  open,
  value,
  onValueChange,
  onSubmit,
  onCancel,
  onOpenExisting,
  onOpenRecent,
  recentLibraries = [],
  busy = false,
}: CreateDialogProps) {
  const t = useT();
  if (!open) return null;

  const showExisting =
    onOpenExisting != null ||
    (onOpenRecent != null && recentLibraries.length > 0);

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        aria-labelledby="create-dialog-title"
        aria-modal="true"
        className="create-dialog"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!value.trim() || busy) return;
          onSubmit();
        }}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            {/* REQ-SHELL-009: no decorative English caption in the Chinese
                UI — the library-only dialog goes straight to the title. */}
            <h2 id="create-dialog-title">{t("dialog.createLibrary.title")}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
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
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            disabled={busy || !value.trim()}
            type="submit"
          >
            {t("dialog.createLibrary.submit")}
          </button>
        </div>
        {showExisting ? (
          <div className="create-dialog-existing">
            <div className="create-dialog-existing-label">
              {t("dialog.createLibrary.existingSection")}
            </div>
            {onOpenExisting != null ? (
              <button
                className="secondary-button create-dialog-open-existing"
                disabled={busy}
                onClick={onOpenExisting}
                type="button"
              >
                <Icon name="folder" size={14} />
                {t("dialog.createLibrary.openExisting")}
              </button>
            ) : null}
            {onOpenRecent != null && recentLibraries.length > 0 ? (
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
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}
