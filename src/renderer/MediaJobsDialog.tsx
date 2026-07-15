import { Icon } from "./Icons";
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
            <span className="eyebrow">BACKGROUND MEDIA JOBS</span>
            <h2 id="media-jobs-title">后台媒体任务</h2>
          </div>
          <button
            aria-label="关闭后台任务"
            className="dialog-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        {mediaJobsLoading && !mediaJobs ? (
          <p className="field-help">正在读取任务状态…</p>
        ) : mediaJobs ? (
          <>
            <p className="field-help">
              排队 {mediaJobs.queued} · 运行 {mediaJobs.running} · 暂停{" "}
              {mediaJobs.paused} · 失败 {mediaJobs.failed} · 已完成{" "}
              {mediaJobs.succeeded}
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
                全部暂停
              </button>
              <button
                className="secondary-button"
                disabled={mediaJobs.paused === 0}
                onClick={() => void onControlMediaJobs("resume")}
                type="button"
              >
                继续暂停项
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
                取消未完成项
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
                重试失败项
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
                      display: "grid",
                      gap: 8,
                      gridTemplateColumns:
                        "minmax(140px, 1fr) 90px minmax(180px, 2fr)",
                      padding: "9px 2px",
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
                ))
              ) : (
                <p className="field-help">当前没有媒体任务。</p>
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
                  AI 分析任务
                </h3>
                <p className="field-help">
                  排队 {aiJobs.queued} · 运行 {aiJobs.running} · 暂停{" "}
                  {aiJobs.paused} · 失败 {aiJobs.failed} · 已完成{" "}
                  {aiJobs.succeeded}
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
                    暂停 AI
                  </button>
                  <button
                    className="secondary-button"
                    disabled={aiJobs.paused === 0}
                    onClick={() => void onControlAiJobs("resume")}
                    type="button"
                  >
                    继续 AI
                  </button>
                  <button
                    className="secondary-button"
                    disabled={
                      aiJobs.queued + aiJobs.running + aiJobs.paused === 0
                    }
                    onClick={() => void onControlAiJobs("cancel")}
                    type="button"
                  >
                    取消 AI
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
                    重试 AI 失败项
                  </button>
                </div>
                <div style={{ maxHeight: 180, overflow: "auto" }}>
                  {aiJobs.jobs.map((job) => (
                    <div
                      key={job.jobId}
                      style={{
                        display: "grid",
                        gap: 8,
                        gridTemplateColumns:
                          "minmax(150px, 1fr) 90px minmax(180px, 2fr)",
                        padding: "7px 2px",
                        fontSize: 11,
                      }}
                    >
                      <span>{job.kind}</span>
                      <strong>{job.status}</strong>
                      <span title={job.errorCode ?? undefined}>
                        {job.errorDetail ?? job.errorCode ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="field-help">暂时无法读取任务状态，请关闭后重试。</p>
        )}
      </div>
    </div>
  );
}
