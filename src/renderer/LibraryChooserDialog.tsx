import { useState, type ReactNode } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";
import { cx } from "./ui/primitives/cx";

export type ImportLibraryChooserExternalKind = "open" | "import";

export interface ImportLibraryChooserDialogProps {
  open: boolean;
  onImportFolder: () => void;
  onImportZip: () => void;
  /** Convert an Eagle library into a new Serpent library (open, not merge). */
  onOpenEagle?: () => void;
  /** Merge an Eagle library into the currently open Serpent library. */
  onImportEagle?: () => void;
  onOpenBillfish?: () => void;
  onImportBillfish?: () => void;
  /**
   * No-library start uses `"open"` (convert and switch). A library already
   * open uses `"import"` (merge into the current library).
   */
  externalKind?: ImportLibraryChooserExternalKind;
  onCancel: () => void;
}

export interface OpenLibraryChooserDialogProps {
  open: boolean;
  onOpenSerpent: () => void;
  /** Pull a library from a configured WebDAV server. */
  onOpenSyncLibrary?: () => void;
  onOpenEagle?: () => void;
  onOpenBillfish?: () => void;
  onCancel: () => void;
}

function ExternalLibraryDisclosure({
  expanded,
  label,
  eagleLabel,
  billfishLabel,
  onEagle,
  onBillfish,
  onToggle,
}: {
  expanded: boolean;
  label: string;
  eagleLabel: string;
  billfishLabel: string;
  onEagle?: () => void;
  onBillfish?: () => void;
  onToggle: () => void;
}): ReactNode {
  return (
    <>
      <button
        aria-expanded={expanded}
        className="secondary-button import-chooser-disclosure"
        onClick={onToggle}
        type="button"
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          className={cx(
            "app-settings-disclosure-chevron",
            expanded && "is-open",
          )}
        >
          <Icon name="chevron" size={16} />
        </span>
      </button>
      {expanded ? (
        <>
          <button
            className="secondary-button"
            disabled={!onEagle}
            onClick={() => onEagle?.()}
            type="button"
          >
            <Icon name="box" size={15} />
            {eagleLabel}
          </button>
          <button
            className="secondary-button"
            disabled={!onBillfish}
            onClick={() => onBillfish?.()}
            type="button"
          >
            <Icon name="box" size={15} />
            {billfishLabel}
          </button>
        </>
      ) : null}
    </>
  );
}

function useChooserExpanded(open: boolean): {
  expanded: boolean;
  toggle: () => void;
} {
  const [expanded, setExpanded] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (!open) setExpanded(false);
  }
  return {
    expanded,
    toggle: () => setExpanded((current) => !current),
  };
}

/**
 * Menu 「打开资源库」chooser (Serpent-pte2 / Serpent-7zp0): existing Serpent
 * library, synced library, plus a collapsed third-party open path.
 */
export function OpenLibraryChooserDialog({
  open,
  onOpenSerpent,
  onOpenSyncLibrary,
  onOpenEagle,
  onOpenBillfish,
  onCancel,
}: OpenLibraryChooserDialogProps): ReactNode {
  const t = useT();
  const { expanded, toggle } = useChooserExpanded(open);
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="open-library-chooser"
        headerActions={
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={onCancel}
        title={t("dialog.openLibraryChooser.title")}
      >
        <p className="field-help">{t("dialog.openLibraryChooser.help")}</p>
        <div className="dialog-actions is-stacked">
          <button
            className="primary-button"
            onClick={onOpenSerpent}
            type="button"
          >
            <Icon name="folder" size={15} />
            {t("dialog.openLibraryChooser.serpent")}
          </button>
          {onOpenSyncLibrary ? (
            <button
              className="secondary-button"
              data-hover-tip={t("shell.openSyncLibraryHint")}
              onClick={onOpenSyncLibrary}
              type="button"
            >
              <Icon name="globe" size={15} />
              {t("shell.openSyncLibraryEllipsis")}
            </button>
          ) : null}
          <ExternalLibraryDisclosure
            billfishLabel={t("shell.openBillfishLibraryEllipsis")}
            eagleLabel={t("shell.openEagleLibraryEllipsis")}
            expanded={expanded}
            label={t("dialog.openLibraryChooser.external")}
            onEagle={onOpenEagle}
            onBillfish={onOpenBillfish}
            onToggle={toggle}
          />
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}

/**
 * 「导入资源库」chooser: folder / ZIP, plus a collapsed third-party path.
 * No-library start converts and opens; an already-open library merges.
 */
export function ImportLibraryChooserDialog({
  open,
  onImportFolder,
  onImportZip,
  onOpenEagle,
  onImportEagle,
  onOpenBillfish,
  onImportBillfish,
  externalKind = "open",
  onCancel,
}: ImportLibraryChooserDialogProps): ReactNode {
  const t = useT();
  const { expanded, toggle } = useChooserExpanded(open);
  if (!open) return null;

  const importExternal = externalKind === "import";

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="import-library-chooser"
        headerActions={
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={onCancel}
        title={t("dialog.importLibraryChooser.title")}
      >
        <p className="field-help">
          {t(
            importExternal
              ? "dialog.importLibraryChooser.helpMerge"
              : "dialog.importLibraryChooser.help",
          )}
        </p>
        <div className="dialog-actions is-stacked">
          <button
            className="primary-button"
            onClick={onImportFolder}
            type="button"
          >
            <Icon name="folder" size={15} />
            {t("dialog.importLibraryChooser.folder")}
          </button>
          <button
            className="secondary-button"
            onClick={onImportZip}
            type="button"
          >
            <Icon name="archive" size={15} />
            {t("dialog.importLibraryChooser.zip")}
          </button>
          <ExternalLibraryDisclosure
            billfishLabel={t(
              importExternal
                ? "shell.importBillfishLibraryEllipsis"
                : "shell.openBillfishLibraryEllipsis",
            )}
            eagleLabel={t(
              importExternal
                ? "shell.importEagleLibraryEllipsis"
                : "shell.openEagleLibraryEllipsis",
            )}
            expanded={expanded}
            label={t(
              importExternal
                ? "dialog.importLibraryChooser.externalImport"
                : "dialog.importLibraryChooser.external",
            )}
            onEagle={importExternal ? onImportEagle : onOpenEagle}
            onBillfish={importExternal ? onImportBillfish : onOpenBillfish}
            onToggle={toggle}
          />
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
