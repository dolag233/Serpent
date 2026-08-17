import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface MoveDialogProps {
  assetIds: string[];
  folderIds?: string[];
  folders: Array<{
    folderId: string;
    name: string;
    relativePath: string;
    directAssetCount: number;
  }>;
  targetFolderId: string | null;
  conflictStrategy: "keep-both" | "replace" | "skip";
  /** When only folders are moved, hide replace (folders use keep-both / skip). */
  folderOnly?: boolean;
  onTargetChange: (folderId: string | null) => void;
  onStrategyChange: (strategy: "keep-both" | "replace" | "skip") => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MoveDialog({
  assetIds,
  folderIds = [],
  folders,
  targetFolderId,
  conflictStrategy,
  folderOnly = false,
  onTargetChange,
  onStrategyChange,
  onConfirm,
  onCancel,
}: MoveDialogProps) {
  const t = useT();
  const itemCount = assetIds.length + folderIds.length;
  // Exclude folders being moved from the destination list (and their
  // descendants via relativePath prefix) so the picker cannot target self.
  const movingFolderIds = new Set(folderIds);
  const movingPrefixes = folders
    .filter((folder) => movingFolderIds.has(folder.folderId))
    .map((folder) => folder.relativePath);
  const destinationFolders = folders.filter((folder) => {
    if (movingFolderIds.has(folder.folderId)) return false;
    return !movingPrefixes.some(
      (prefix) =>
        folder.relativePath === prefix ||
        folder.relativePath.startsWith(`${prefix}/`),
    );
  });
  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="move-dialog"
        headerActions={
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("dialog.move.cancelAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={onCancel}
        title={t("dialog.move.title", { count: itemCount })}
      >
        <label className="field-label" htmlFor="move-target">
          {t("dialog.move.targetFolder")}
        </label>
        <select
          className="text-field"
          id="move-target"
          onChange={(event) =>
            onTargetChange(event.target.value || null)
          }
          value={targetFolderId ?? ""}
        >
          <option value="">{t("scope.rootFolder")}</option>
          {destinationFolders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.relativePath} ({folder.directAssetCount})
            </option>
          ))}
        </select>
        <label
          className="field-label field-label-spaced"
          htmlFor="move-conflict"
        >
          {t("dialog.move.nameConflict")}
        </label>
        <select
          className="text-field"
          id="move-conflict"
          onChange={(event) =>
            onStrategyChange(
              event.target.value as MoveDialogProps["conflictStrategy"],
            )
          }
          value={
            folderOnly && conflictStrategy === "replace"
              ? "keep-both"
              : conflictStrategy
          }
        >
          <option value="keep-both">{t("dialog.move.keepBoth")}</option>
          {!folderOnly && (
            <option value="replace">{t("dialog.move.replace")}</option>
          )}
          <option value="skip">{t("dialog.move.skip")}</option>
        </select>
        <p className="field-help">{t("dialog.move.help")}</p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            onClick={onConfirm}
            type="button"
          >
            {t("dialog.move.submit")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
