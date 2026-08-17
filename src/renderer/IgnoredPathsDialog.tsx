import type { IgnoredPath } from "../shared/asset-types";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

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
      <DialogShell
        className="create-dialog ignored-paths-dialog"
        dialogId="ignored-paths-dialog"
        description={t("settings.ignoredPathsHint")}
        headerActions={
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("common.close"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={onClose}
        style={{ padding: 0 }}
        title={t("settings.ignoredPathsTitle")}
      >
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
                <button className="secondary-button" onClick={() => onUnignore(path)} type="button">
                  {t("menu.unignore")}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            {t("common.close")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
