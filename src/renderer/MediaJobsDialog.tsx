import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import type { MediaJobStatus, AiJobStatus } from "../shared/library-api";

export interface MediaJobsDialogProps {
  open: boolean;
  mediaJobs: MediaJobStatus | null;
  mediaJobsLoading: boolean;
  aiJobs: AiJobStatus | null;
  onClose: () => void;
  onControlMediaJobs: (
    action: "pause" | "resume" | "cancel" | "retry",
    jobIds?: string[],
  ) => void;
  onControlAiJobs: (
    action: "pause" | "resume" | "cancel" | "retry",
    jobIds?: string[],
  ) => void;
}

export function MediaJobsDialog({
  open,
  mediaJobs,
  mediaJobsLoading,
  aiJobs,
  onClose,
  onControlMediaJobs,
  onControlAiJobs,
}: MediaJobsDialogProps) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="media-jobs-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
        style={{ maxWidth: 680 }}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="media-jobs-title">{t("dialog.mediaJobs.title")}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("dialog.mediaJobs.closeAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        {mediaJobsLoading && !mediaJobs ? (
          <p className="field-help">{t("dialog.mediaJobs.loading")}</p>
        ) : mediaJobs ? (
          <>
            <p className="field-help">
              {t("dialog.mediaJobs.summary", {
                queued: mediaJobs.queued,
                running: mediaJobs.running,
                paused: mediaJobs.paused,
                failed: mediaJobs.failed,
                completed: mediaJobs.succeeded,
              })}
            </p>
            <div
              className="dialog-actions"
              style={{ justifyContent: "flex-start", marginBottom: 12 }}
            >
              <button
                className="secondary-button"
                disabled={mediaJobs.queued + mediaJobs.running === 0}
                onClick={() => void onControlMediaJobs("pause")}
                type="button"
              >
                {t("dialog.mediaJobs.pauseAll")}
              </button>
              <button
                className="secondary-button"
                disabled={mediaJobs.paused === 0}
                onClick={() => void onControlMediaJobs("resume")}
                type="button"
              >
                {t("dialog.mediaJobs.resumePaused")}
              </button>
              <button
                className="secondary-button"
                disabled={
                  mediaJobs.queued +
                    mediaJobs.running +
                    mediaJobs.paused ===
                  0
                }
                onClick={() => void onControlMediaJobs("cancel")}
                type="button"
              >
                {t("dialog.mediaJobs.cancelIncomplete")}
              </button>
              <button
                className="secondary-button"
                disabled={mediaJobs.failed === 0}
                onClick={() =>
                  void onControlMediaJobs(
                    "retry",
                    mediaJobs.jobs
                      .filter((job) => job.status === "failed")
                      .map((job) => job.jobId),
                  )
                }
                type="button"
              >
                {t("dialog.mediaJobs.retryFailed")}
              </button>
            </div>
            <div
              style={{
                maxHeight: 330,
                overflow: "auto",
                borderTop: "1px solid var(--border)",
              }}
            >
              {mediaJobs.jobs.length ? (
                mediaJobs.jobs.map((job) => (
                  <div
                    key={job.jobId}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      padding: "6px 2px",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gap: 8,
                        gridTemplateColumns:
                          "minmax(140px, 1fr) 90px minmax(180px, 2fr)",
                        fontSize: 11,
                      }}
                    >
                      <span>
                        {job.kind
                          .replace("generate_", "")
                          .replaceAll("_", " ")}
                      </span>
                      <strong>{job.status}</strong>
                      <span title={job.errorCode ?? undefined}>
                        {job.errorDetail ??
                          job.errorCode ??
                          `${Math.round(job.progress * 100)}%`}
                      </span>
                    </div>
                    {job.status === "running" && (
                      <div className="task-progress-track">
                        <div
                          className="task-progress-fill"
                          style={{
                            width: `${Math.max(0, Math.min(1, job.progress)) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="field-help">{t("dialog.mediaJobs.empty")}</p>
              )}
            </div>
            {aiJobs && (
              <section
                style={{
                  borderTop: "1px solid var(--border)",
                  marginTop: 16,
                  paddingTop: 12,
                }}
              >
                <h3 style={{ fontSize: 13, margin: "0 0 5px" }}>
                  {t("dialog.mediaJobs.aiSection")}
                </h3>
                <p className="field-help">
                  {t("dialog.mediaJobs.summary", {
                    queued: aiJobs.queued,
                    running: aiJobs.running,
                    paused: aiJobs.paused,
                    failed: aiJobs.failed,
                    completed: aiJobs.succeeded,
                  })}
                </p>
                <div
                  className="dialog-actions"
                  style={{ justifyContent: "flex-start", marginBottom: 10 }}
                >
                  <button
                    className="secondary-button"
                    disabled={aiJobs.queued + aiJobs.running === 0}
                    onClick={() => void onControlAiJobs("pause")}
                    type="button"
                  >
                    {t("dialog.mediaJobs.pauseAi")}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={aiJobs.paused === 0}
                    onClick={() => void onControlAiJobs("resume")}
                    type="button"
                  >
                    {t("dialog.mediaJobs.resumeAi")}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={
                      aiJobs.queued + aiJobs.running + aiJobs.paused === 0
                    }
                    onClick={() => void onControlAiJobs("cancel")}
                    type="button"
                  >
                    {t("dialog.mediaJobs.cancelAi")}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={aiJobs.failed === 0}
                    onClick={() =>
                      void onControlAiJobs(
                        "retry",
                        aiJobs.jobs
                          .filter((job) => job.status === "failed")
                          .map((job) => job.jobId),
                      )
                    }
                    type="button"
                  >
                    {t("dialog.mediaJobs.retryAiFailed")}
                  </button>
                </div>
                <div style={{ maxHeight: 180, overflow: "auto" }}>
                  {aiJobs.jobs.map((job) => (
                    <div
                      key={job.jobId}
                      style={{ padding: "5px 2px" }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gap: 8,
                          gridTemplateColumns:
                            "minmax(150px, 1fr) 90px minmax(180px, 2fr)",
                          fontSize: 11,
                        }}
                      >
                        <span>{job.kind}</span>
                        <strong>{job.status}</strong>
                        <span title={job.errorCode ?? undefined}>
                          {job.errorDetail ?? job.errorCode ?? "—"}
                        </span>
                      </div>
                      {job.status === "running" && (
                        <div className="task-progress-track">
                          <div className="task-progress-indeterminate" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="field-help">{t("dialog.mediaJobs.readFailed")}</p>
        )}
      </div>
    </div>
  );
}
