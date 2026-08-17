import type { PluginJobRecord } from "../plugins/plugin-jobs";
import {
  formatPluginJobProgressMessage,
  formatPluginJobError,
  formatPluginJobPluginName,
  getPluginJobDisplayProgress,
} from "./plugin-job-display";
import { useT } from "./i18n";
import { Activity } from "./ui/patterns";

export function PluginJobActivityBanner({
  job,
  onRunInBackground,
  onDismiss,
}: {
  job: PluginJobRecord;
  onRunInBackground: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const progressMessage = formatPluginJobProgressMessage(job);
  const errorMessage = formatPluginJobError(job.errorDetail, job.errorCode);
  const progress = getPluginJobDisplayProgress(job);
  const progressPercentage = `${Math.round(progress * 100)}%`;
  const statusLabel = t(`dialog.mediaJobs.pluginJobStatus.${job.status}`);
  const tone = job.status === "failed"
    ? "error"
    : job.status === "succeeded"
      ? "success"
      : job.status === "cancelled" || job.status === "interrupted"
        ? "warning"
        : "info";

  return (
    <Activity
      actions={(
        <div className="plugin-job-activity-actions">
          {job.status !== "interrupted" && (
            <button
              className="secondary-button"
              onClick={onRunInBackground}
              type="button"
            >
              {t("dialog.mediaJobs.runInBackground")}
            </button>
          )}
        </div>
      )}
      className={`workspace-plugin-job-progress is-${job.status}`}
      dismissLabel={t("dialog.mediaJobs.closePluginJobActivity")}
      dismissible
      message={progressMessage || undefined}
      onDismiss={onDismiss}
      max={1}
      progress={job.status === "interrupted" ? undefined : progress}
      progressAriaLabel={statusLabel}
      tone={tone}
      title={(
        <span
          className="plugin-job-activity-title"
          title={`${job.ownerPluginId} · ${job.pluginHandlerId}`}
        >
          <span aria-hidden="true" className="plugin-job-activity-status-mark" />
          <span className="plugin-job-activity-plugin">{formatPluginJobPluginName(job.ownerPluginId)}</span>
        </span>
      )}
      valueText={progressPercentage}
    >
      {errorMessage ? (
        <div className="plugin-job-activity-error" title={errorMessage}>
          {errorMessage}
        </div>
      ) : null}
    </Activity>
  );
}
