import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import type { RecentLibraryMenuEntry } from "./LibrarySwitcher";

export interface NoLibraryEmptyStateProps {
  busy?: boolean;
  onCreateLibrary: () => void;
  onImportLibrary: () => void;
  onOpenLibrary: () => void;
  onOpenRecent: (path: string) => void;
  onForgetRecent?: (path: string) => void;
  recentLibraries: RecentLibraryMenuEntry[];
}

/**
 * No-library start surface (Serpent-y0au / REQ-LIB-002): create, open via
 * picker, import, and one-click recent libraries — not only「打开资源库…」.
 */
export function NoLibraryEmptyState({
  busy = false,
  onCreateLibrary,
  onImportLibrary,
  onOpenLibrary,
  onOpenRecent,
  onForgetRecent,
  recentLibraries,
}: NoLibraryEmptyStateProps) {
  const t = useT();

  return (
    <div className="empty-state">
      <div className="empty-copy">
        <h1>{t("empty.noLibraryTitle")}</h1>
        <p>{t("empty.noLibraryBody")}</p>
        <div className="empty-actions">
          <button
            className="primary-button"
            disabled={busy}
            onClick={onCreateLibrary}
            type="button"
          >
            <Icon name="plus" size={15} />
            {t("shell.createLibrary")}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={onOpenLibrary}
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
        </div>
        {recentLibraries.length > 0 ? (
          <div
            aria-label={t("empty.recentLibraries")}
            className="empty-recent"
          >
            <div className="empty-recent-label">{t("empty.recentLibraries")}</div>
            <ul className="empty-recent-list">
              {recentLibraries.map((entry) => (
                <li className="empty-recent-row" key={entry.path}>
                  <button
                    className="empty-recent-open"
                    disabled={busy}
                    onClick={() => onOpenRecent(entry.path)}
                    title={entry.path}
                    type="button"
                  >
                    <span className="empty-recent-name">{entry.name}</span>
                    <span className="empty-recent-path">{entry.path}</span>
                  </button>
                  {onForgetRecent != null ? (
                    <button
                      className="empty-recent-forget"
                      disabled={busy}
                      onClick={() => onForgetRecent(entry.path)}
                      type="button"
                      {...iconActionAttrs(t("shell.forgetRecentLibrary"))}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
