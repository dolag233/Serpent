import { type ReactNode } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

/** 组件名与许可证是专有名词，无需本地化；完整清单见 THIRD_PARTY_NOTICES.md。 */
const NOTICED_COMPONENTS: ReadonlyArray<{ name: string; license: string }> = [
  { name: "Electron / Chromium", license: "MIT / BSD-3-Clause" },
  { name: "React", license: "MIT" },
  { name: "Vite", license: "MIT" },
  { name: "TypeScript", license: "Apache-2.0" },
  { name: "SQLite / better-sqlite3", license: "Public Domain / MIT" },
  { name: "Sharp (libvips)", license: "Apache-2.0" },
  { name: "FFmpeg (BtbN builds)", license: "LGPL-2.1" },
  { name: "OpenImageIO", license: "BSD-3-Clause" },
  { name: "three.js", license: "MIT" },
  { name: "exifr", license: "MIT" },
  { name: "koffi", license: "MIT" },
  { name: "QuickJS (quickjs-emscripten)", license: "MIT" },
  { name: "adm-zip / archiver / yauzl", license: "MIT" },
  { name: "Zod", license: "MIT" },
  { name: "trash", license: "MIT" },
  { name: "Model Context Protocol SDK", license: "MIT" },
  { name: "ufbx (WASM)", license: "MIT" },
  { name: "Noto Sans SC / IBM Plex Mono", license: "SIL OFL-1.1" },
  { name: "HarmonyOS Sans SC", license: "© Huawei / Unlicense (npm)" },
];

export type OpenSourceLicensesDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
};

export function OpenSourceLicensesDialog({
  open,
  onClose,
}: OpenSourceLicensesDialogProps): ReactNode {
  const t = useT();
  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <DialogShell
        className="create-dialog open-source-dialog"
        dialogId="open-source-licenses"
        description={
          <span className="app-log-subtitle">
            {t("dialog.openSource.subtitle")}
          </span>
        }
        headerActions={
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("dialog.openSource.closeAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={onClose}
        style={{ padding: 0 }}
        title={t("dialog.openSource.title")}
      >
        <div className="open-source-dialog-content">
          <p className="field-help">{t("dialog.openSource.intro")}</p>
          <ul>
            {NOTICED_COMPONENTS.map((component) => (
              <li key={component.name}>
                <strong>{component.name}</strong>
                <span>{component.license}</span>
              </li>
            ))}
          </ul>
          <p className="field-help">{t("dialog.openSource.license")}</p>
        </div>
        <div className="dialog-actions">
          <button className="primary-button" onClick={onClose} type="button">
            {t("dialog.openSource.close")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
