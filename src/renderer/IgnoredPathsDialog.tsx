import type { IgnoredPath } from "../shared/asset-types";
import { Icon } from "./Icons";
import { useT } from "./i18n";

export function IgnoredPathsDialog({
  paths,
  open,
  onClose,
  onUnignore,
}: {
  paths: IgnoredPath[];
  open: boolean;
  onClose: () => void;
  onUnignore: (path: IgnoredPath) => void;
}) {
  const t = useT();
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }} role="presentation">
      <div className="create-dialog ignored-paths-dialog" role="dialog" aria-modal="true" aria-labelledby="ignored-paths-title">
        <div className="dialog-heading">
          <h2 id="ignored-paths-title">{t("settings.ignoredPathsTitle")}</h2>
          <button className="dialog-close" onClick={onClose} type="button" aria-label={t("common.close")}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="dialog-description">{t("settings.ignoredPathsHint")}</p>
        {paths.length === 0 ? (
          <p className="empty-state">{t("settings.ignoredPathsEmpty")}</p>
        ) : (
          <div className="ignored-paths-list">
            {paths.map((path) => (
              <div className="ignored-path-row" key={`${path.locationKind}:${path.linkedFolderId ?? ""}:${path.pathKind}:${path.relativePath}`}>
                <div>
                  <strong>{path.displayName}</strong>
                  <span>{path.pathKind === "folder" ? t("settings.ignoredFolder") : t("settings.ignoredAsset")}</span>
                </div>
                <button className="secondary-button" onClick={() => onUnignore(path)} type="button">
                  {t("menu.unignore")}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}
