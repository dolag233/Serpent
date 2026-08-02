import type { PluginJobRecord } from "../plugins/plugin-jobs";
import {
  formatPluginJobProgressMessage,
  formatPluginJobProgressSummary,
} from "./plugin-job-display";
import { useT } from "./i18n";

export function PluginJobActivityBanner({
  job,
  onOpenJobs,
}: {
  job: PluginJobRecord;
  onOpenJobs: () => void;
}) {
  const t = useT();
  const progressMessage = formatPluginJobProgressMessage(job);
  const progressSummary = formatPluginJobProgressSummary(job);
  const errorMessage = job.errorDetail ?? job.errorCode;
  const progressWidth = `${Math.max(0, Math.min(1, job.progress)) * 100}%`;
  const progressActive = job.status === "running" || job.status === "paused";

  return (
    <div
      className={`workspace-ai-progress workspace-plugin-job-progress is-${job.status}`}
      role="status"
      aria-live="polite"
    >
      <div className="workspace-ai-progress-body">
        <div className="workspace-ai-progress-headline">
          {job.status === "running" ? (
            <span aria-hidden="true" className="activity-pulse" />
          ) : null}
          <strong
            className="workspace-ai-progress-message"
            title={`${job.ownerPluginId} · ${job.pluginHandlerId}`}
          >
            {job.ownerPluginId} · {job.pluginHandlerId}
          </strong>
          <span className="micro-label">{job.status}</span>
        </div>
        <div className="workspace-ai-progress-message">
          {[progressMessage, progressSummary, errorMessage]
            .filter((value): value is string => Boolean(value))
            .join(" · ")}
        </div>
        {progressActive && (
          <div
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(job.progress * 100)}
            className="task-progress-track workspace-ai-progress-bar"
            role="progressbar"
          >
            <div
              className="task-progress-fill"
              style={{ width: progressWidth }}
            />
          </div>
        )}
      </div>
      <div className="workspace-ai-progress-actions">
        <button
          className="secondary-button"
          onClick={onOpenJobs}
          type="button"
        >
          {t("dialog.mediaJobs.openPluginJobs")}
        </button>
      </div>
    </div>
  );
}
