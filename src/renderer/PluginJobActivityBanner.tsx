import type { PluginJobRecord } from "../plugins/plugin-jobs";
import {
  formatPluginJobProgressMessage,
  formatPluginJobProgressSummary,
  formatPluginJobError,
  getPluginJobDisplayProgress,
} from "./plugin-job-display";
import { useT } from "./i18n";

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
  const progressSummary = formatPluginJobProgressSummary(job);
  const errorMessage = formatPluginJobError(job.errorDetail, job.errorCode);
  const progress = getPluginJobDisplayProgress(job);
  const progressWidth = `${progress * 100}%`;
  const statusLabel = t(`dialog.mediaJobs.pluginJobStatus.${job.status}`);

  return (
    <div
      className={`workspace-plugin-job-progress is-${job.status}`}
      role="status"
      aria-live="polite"
    >
      <div className="plugin-job-activity-header">
        <div
          className="plugin-job-activity-title"
          title={`${job.ownerPluginId} · ${job.pluginHandlerId}`}
        >
          <span aria-hidden="true" className="plugin-job-activity-status-mark" />
          <strong className="plugin-job-activity-plugin">{job.ownerPluginId}</strong>
          <span aria-hidden="true" className="plugin-job-activity-separator">
            ·
          </span>
          <span className="plugin-job-activity-handler">{job.pluginHandlerId}</span>
          <span className="plugin-job-activity-stage">
            {progressMessage || statusLabel}
          </span>
        </div>
        <div className="plugin-job-activity-actions">
          <button
            className="secondary-button"
            onClick={onRunInBackground}
            type="button"
          >
            {t("dialog.mediaJobs.runInBackground")}
          </button>
          <button
            aria-label={t("dialog.mediaJobs.closePluginJobActivity")}
            className="plugin-job-activity-dismiss"
            onClick={onDismiss}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      <div className="plugin-job-activity-progress-row">
        <div
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(progress * 100)}
          className="plugin-job-activity-track"
          role="progressbar"
        >
          <div
            className="plugin-job-activity-fill"
            style={{ width: progressWidth }}
          />
        </div>
        <strong className="plugin-job-activity-progress-summary">
          {progressSummary}
        </strong>
      </div>
      {errorMessage && (
        <div className="plugin-job-activity-error" title={errorMessage}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}
