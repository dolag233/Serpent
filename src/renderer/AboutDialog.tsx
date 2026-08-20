import appIcon from "../../assets/icons/app.png";

import type {
  AppUpdateCheckResult,
  AppUpdateErrorCode,
  AppUpdateInstallResult,
} from "../shared/app-update";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { type ReactNode } from "react";

export type AboutDialogProps = {
  readonly open: boolean;
  readonly version: string;
  readonly onClose: () => void;
  readonly onOpenGitHub: () => void;
  readonly updateCheck: AppUpdateCheckResult | null;
  readonly updateInstall: AppUpdateInstallResult | null;
  readonly updateChecking: boolean;
  readonly updateInstalling: boolean;
  readonly onCheckForUpdates: () => void;
  readonly onDownloadAndInstall: () => void;
};

export function AboutDialog({
  open,
  version,
  onClose,
  onOpenGitHub,
  updateCheck,
  updateInstall,
  updateChecking,
  updateInstalling,
  onCheckForUpdates,
  onDownloadAndInstall,
}: AboutDialogProps): ReactNode {
  const t = useT();
  if (!open) return null;

  const updateErrorMessage = (code: AppUpdateErrorCode): string => {
    if (code === "network") return t("dialog.about.updateNetworkFailed");
    if (code === "asset-missing" || code === "invalid-release") {
      return t("dialog.about.updateAssetMissing");
    }
    if (code === "verification-failed") return t("dialog.about.updateVerificationFailed");
    if (code === "download-failed") return t("dialog.about.updateDownloadFailed");
    if (code === "open-failed") return t("dialog.about.updateOpenFailed");
    return t("dialog.about.updateFailed");
  };
  const updateBusy = updateChecking || updateInstalling;
  const canInstall = updateCheck?.ok === true
    && updateCheck.status === "available"
    && updateInstall?.ok !== true;
  const updateStatusMessage = (() => {
    if (updateInstalling) return t("dialog.about.updateDownloading");
    if (updateInstall?.ok === true) {
      return updateInstall.action === "portable-downloaded"
        ? t("dialog.about.updatePortableDownloaded")
        : t("dialog.about.updateInstallerOpened");
    }
    if (updateInstall?.ok === false) return updateErrorMessage(updateInstall.code);
    if (updateChecking) return t("dialog.about.updateChecking");
    if (updateCheck === null) return t("dialog.about.updateNotChecked");
    if (!updateCheck.ok) return updateErrorMessage(updateCheck.code);
    if (updateCheck.status === "unsupported") {
      if (updateCheck.reason === "development") return t("dialog.about.updateDevelopment");
      if (updateCheck.reason === "architecture") return t("dialog.about.updateArchitecture");
      return t("dialog.about.updatePlatform");
    }
    if (updateCheck.status === "up-to-date") return t("dialog.about.updateUpToDate");
    return "";
  })();

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        aria-labelledby="about-dialog-title"
        aria-modal="true"
        className="create-dialog about-dialog"
        role="dialog"
      >
        <button
          className="about-dialog-close"
          onClick={onClose}
          type="button"
          {...iconActionAttrs(t("dialog.about.closeAria"))}
        >
          <Icon name="close" size={16} />
        </button>
        <div className="about-dialog-brand">
          <img alt={t("dialog.about.logoAlt")} src={appIcon} />
          <h2 id="about-dialog-title">{t("dialog.about.productName")}</h2>
          <p>{t("dialog.about.tagline")}</p>
          <div className="about-dialog-version-row">
            <span className="about-dialog-version">{t("dialog.about.version", { version })}</span>
            <button
              className="about-dialog-version-action"
              data-checking={updateChecking ? "true" : undefined}
              disabled={updateBusy}
              onClick={onCheckForUpdates}
              type="button"
              {...iconActionAttrs(t("dialog.about.checkForUpdates"))}
            >
              <Icon name="refresh" size={15} />
            </button>
          </div>
          {canInstall && updateCheck.ok && updateCheck.status === "available" ? (
            <div className="about-dialog-update-available" role="status">
              <span>{t("dialog.about.updateAvailable", { version: updateCheck.latestVersion })}</span>
              <button
                className="about-dialog-version-action about-dialog-download-action"
                disabled={updateBusy}
                onClick={onDownloadAndInstall}
                type="button"
                {...iconActionAttrs(t("dialog.about.downloadUpdate", { version: updateCheck.latestVersion }))}
              >
                <Icon name="download" size={15} />
              </button>
            </div>
          ) : null}
          {updateStatusMessage ? (
            <span aria-live="polite" className="about-dialog-update-status">
              {updateStatusMessage}
            </span>
          ) : null}
          <div className="about-dialog-socials">
            <button
              className="about-dialog-social-button"
              onClick={onOpenGitHub}
              type="button"
              {...iconActionAttrs(t("dialog.about.github"))}
            >
              <Icon name="github" size={20} />
            </button>
          </div>
        </div>
        <div className="about-dialog-copy">
          <p>{t("dialog.about.description")}</p>
          <p className="about-dialog-etymology">{t("dialog.about.etymology")}</p>
        </div>
      </div>
    </div>
  );
}
