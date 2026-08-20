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
  const canInstall = updateCheck?.ok === true && updateCheck.status === "available";
  const updateMessage = (() => {
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
    return t("dialog.about.updateAvailable", { version: updateCheck.latestVersion });
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
          <span>{t("dialog.about.version", { version })}</span>
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
          <section aria-label={t("dialog.about.updateTitle")} className="about-dialog-update">
            <div className="about-dialog-update-heading">
              <strong>{t("dialog.about.updateTitle")}</strong>
              <span aria-live="polite">{updateMessage}</span>
            </div>
            {canInstall && updateCheck.ok && updateCheck.status === "available" ? (
              <p className="about-dialog-update-detail">
                {t("dialog.about.updateAsset", { asset: updateCheck.assetName })}
              </p>
            ) : null}
            <div className="about-dialog-update-actions">
              <button
                className="secondary-button"
                disabled={updateBusy}
                onClick={onCheckForUpdates}
                type="button"
              >
                {updateChecking ? t("dialog.about.updateCheckingButton") : t("dialog.about.checkForUpdates")}
              </button>
              {canInstall && updateCheck.ok && updateCheck.status === "available" ? (
                <button
                  className="primary-button"
                  disabled={updateBusy}
                  onClick={onDownloadAndInstall}
                  type="button"
                >
                  {updateCheck.distribution === "portable"
                    ? t("dialog.about.downloadPortableUpdate")
                    : t("dialog.about.installUpdate")}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
