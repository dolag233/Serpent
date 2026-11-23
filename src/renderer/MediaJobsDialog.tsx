import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useLocale, useT } from "./i18n";
import { displayAiJobFailure } from "./ai-job-error-message";
import { DialogShell } from "./ui/patterns";
import { Tooltip } from "./ui/primitives/Tooltip";
import {
  formatPluginJobError,
  formatPluginJobProgressMessage,
  formatPluginJobProgressSummary,
  getPluginJobDisplayProgress,
} from "./plugin-job-display";
import type { MediaJobStatus, AiJobStatus, PluginJobStatus } from "../shared/library-api";
import type { EmbeddingIndexSnapshot } from "../shared/embedding/profile";
import { isEmbeddingServiceSelectionId } from "../shared/embedding/http-service";
import { embeddingServiceTextOnly, type EmbeddingModality } from "../shared/embedding/modalities";
import { embeddingIndexCopyKey, embeddingIndexJobsVisible } from "./semantic-index-copy";

function embeddingModelLabel(
  modelId: string,
  t: ReturnType<typeof useT>,
): string {
  if (modelId === "embeddinggemma-2-compact") return t("settings.semanticSearch.modelCompact");
  if (modelId === "embeddinggemma-2-quality") return t("settings.semanticSearch.modelQuality");
  if (modelId === "embeddinggemma-2-balanced") return t("settings.semanticSearch.modelBalanced");
  return t("settings.semanticSearch.customModel");
}

function MediaJobAssetLabel({
  assetName,
  fallback,
}: {
  assetName: string | null | undefined;
  fallback: string;
}) {
  const label = assetName ?? fallback;
  const content = (
    <span className="media-jobs-grid-cell media-jobs-asset-name">
      {label}
    </span>
  );

  return assetName ? <Tooltip label={assetName}>{content}</Tooltip> : content;
}

export interface MediaJobsDialogProps {
  open: boolean;
  mediaJobs: MediaJobStatus | null;
  mediaJobsLoading: boolean;
  aiJobs: AiJobStatus | null;
  embeddingIndex?: { modelId: string; snapshot: EmbeddingIndexSnapshot; modalities?: readonly EmbeddingModality[] } | null;
  pluginJobs: PluginJobStatus | null;
  onClose: () => void;
  onControlMediaJobs: (
    action: "pause" | "resume" | "cancel" | "retry",
    jobIds?: string[],
  ) => void;
  onLoadMoreMediaJobs?: () => void;
  onControlAiJobs: (
    action: "pause" | "resume" | "cancel" | "retry",
    jobIds?: string[],
  ) => void;
  /** Reveal main-process log (Serpent-iokf). */
  onRevealAppLog?: () => void;
  /** Open the in-app, recent diagnostics view. */
  onViewAppLog?: () => void;
}

export function MediaJobsDialog({
  open,
  mediaJobs,
  mediaJobsLoading,
  aiJobs,
  embeddingIndex,
  pluginJobs,
  onClose,
  onControlMediaJobs,
  onLoadMoreMediaJobs,
  onControlAiJobs,
  onRevealAppLog,
  onViewAppLog,
}: MediaJobsDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog create-dialog-wide"
        dialogId="media-jobs-dialog"
        headerActions={
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("dialog.mediaJobs.closeAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={onClose}
        style={{ padding: 0 }}
        title={t("dialog.mediaJobs.title")}
      >
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
            <div className="dialog-actions dialog-actions-start is-spaced">
              <button
                className="secondary-button"
                disabled={mediaJobs.queuePaused ?? false}
                onClick={() => void onControlMediaJobs("pause")}
                type="button"
              >
                {t("dialog.mediaJobs.pauseAll")}
              </button>
              <button
                className="secondary-button"
                disabled={!mediaJobs.queuePaused && mediaJobs.paused === 0}
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
              className="media-jobs-list"
              style={{
                maxHeight: 330,
                overflow: "auto",

              }}
            >
              {mediaJobs.jobs.length ? (
                mediaJobs.jobs.map((job) => (
                  <div
                    className="media-jobs-row"
                    key={job.jobId}
                    style={{

                      padding: "6px 2px",
                    }}
                  >
                    <div
                      className="media-jobs-grid"
                      style={{
                        display: "grid",
                        gap: 8,
                        gridTemplateColumns:
                          "minmax(0, 1.4fr) minmax(0, 1.2fr) 90px minmax(0, 2fr)",
                      }}
                    >
                      <MediaJobAssetLabel
                        assetName={job.assetName}
                        fallback={t("dialog.mediaJobs.libraryScope")}
                      />
                      <span className="media-jobs-grid-cell">
                        {job.kind
                          .replace("generate_", "")
                          .replaceAll("_", " ")}
                      </span>
                      <strong className="media-jobs-grid-cell">{job.status}</strong>
                      <span
                        className="media-jobs-grid-cell"
                        data-hover-tip={job.errorCode ?? undefined}
                      >
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
              {mediaJobs.hasMore === true ? (
                <div className="dialog-actions dialog-actions-start is-spaced" style={{ padding: "8px 2px" }}>
                  <button
                    className="secondary-button"
                    onClick={() => onLoadMoreMediaJobs?.()}
                    type="button"
                  >
                    {t("dialog.mediaJobs.loadMore")}
                  </button>
                </div>
              ) : null}
            </div>
            {embeddingIndex && embeddingIndexJobsVisible(embeddingIndex.snapshot) ? (
              <section className="media-jobs-embedding-section">
                <h3 className="media-jobs-section-title">
                  {t("dialog.mediaJobs.embeddingSection")}
                </h3>
                <p className="field-help">
                  {embeddingModelLabel(embeddingIndex.modelId, t)}
                  {" · "}
                  {t(embeddingIndexCopyKey(embeddingIndex.snapshot, {
                    textOnly: isEmbeddingServiceSelectionId(embeddingIndex.modelId)
                      && embeddingServiceTextOnly(embeddingIndex.modalities),
                  }), {
                    done: embeddingIndex.snapshot.done,
                    total: embeddingIndex.snapshot.total,
                    failed: embeddingIndex.snapshot.failedCount,
                  })}
                </p>
                <div className="task-progress-track">
                  {embeddingIndex.snapshot.phase === "starting" || embeddingIndex.snapshot.total <= 0 ? (
                    <div className="task-progress-indeterminate" />
                  ) : (
                    <div
                      className="task-progress-fill"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            1,
                            embeddingIndex.snapshot.done / embeddingIndex.snapshot.total,
                          ),
                        ) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </section>
            ) : null}
            {aiJobs && (
              <section
                className="media-jobs-section"
                style={{

                  marginTop: 16,
                  paddingTop: 12,
                }}
              >
                <h3 className="media-jobs-section-title">
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
                <div className="dialog-actions dialog-actions-start is-tight">
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
                  {onRevealAppLog && (
                    <button
                      className="secondary-button"
                      onClick={() => onRevealAppLog()}
                      type="button"
                    >
                      {t("dialog.mediaJobs.revealLog")}
                    </button>
                  )}
                  {onViewAppLog && (
                    <button
                      className="secondary-button"
                      onClick={() => onViewAppLog()}
                      type="button"
                    >
                      {t("dialog.mediaJobs.viewLog")}
                    </button>
                  )}
                </div>
                <div style={{ maxHeight: 180, overflow: "auto" }}>
                  {aiJobs.jobs.map((job) => (
                    <div
                      key={job.jobId}
                      style={{ padding: "5px 2px" }}
                    >
                      <div
                        className="media-jobs-grid"
                        style={{
                          display: "grid",
                          gap: 8,
                          gridTemplateColumns:
                            "minmax(0, 1.4fr) minmax(0, 1.2fr) 90px minmax(0, 2fr)",
                        }}
                      >
                        <MediaJobAssetLabel
                          assetName={job.assetName}
                          fallback={t("dialog.mediaJobs.libraryScope")}
                        />
                        <span className="media-jobs-grid-cell">{job.kind}</span>
                        <strong className="media-jobs-grid-cell">{job.status}</strong>
                        <span
                          className="media-jobs-grid-cell"
                          data-hover-tip={job.errorCode ?? undefined}
                        >
                          {displayAiJobFailure(job.errorCode, job.errorDetail, locale) || "—"}
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
            {pluginJobs && (
              <section
                className="media-jobs-section"
                style={{

                  marginTop: 16,
                  paddingTop: 12,
                }}
              >
                <h3 className="media-jobs-section-title">
                  {t("dialog.mediaJobs.pluginSection")}
                </h3>
                <p className="field-help">
                  {t("dialog.mediaJobs.pluginSummary", {
                    queued: pluginJobs.queued,
                    running: pluginJobs.running,
                    paused: pluginJobs.paused,
                    failed: pluginJobs.failed,
                    interrupted: pluginJobs.interrupted,
                    completed: pluginJobs.succeeded,
                  })}
                </p>
                <div style={{ maxHeight: 180, overflow: "auto" }}>
                  {pluginJobs.jobs.length ? (
                    pluginJobs.jobs.map((job) => {
                      const progressSummary = formatPluginJobProgressSummary(job);
                      const progressMessage = formatPluginJobProgressMessage(job);
                      const progress = getPluginJobDisplayProgress(job);
                      return (
                        <div
                          key={job.jobId}
                          style={{ padding: "5px 2px" }}
                        >
                          <div
                            className="media-jobs-grid"
                            style={{
                              display: "grid",
                              gap: 8,
                              gridTemplateColumns:
                                "minmax(160px, 1.4fr) minmax(90px, 0.8fr) 90px minmax(140px, 1.4fr)",
                            }}
                          >
                            <span data-hover-tip={job.ownerPluginId}>
                              {job.ownerPluginId}
                            </span>
                            <span data-hover-tip={job.pluginHandlerId}>
                              {job.pluginHandlerId}
                            </span>
                            <strong>
                              {t(`dialog.mediaJobs.pluginJobStatus.${job.status}`)}
                            </strong>
                            <span data-hover-tip={job.errorCode ?? undefined}>
                              {formatPluginJobError(job.errorDetail, job.errorCode) ||
                                progressSummary}
                            </span>
                          </div>
                          {progressMessage && (
                            <div
                              className="plugin-job-progress-message"
                              data-hover-tip={progressMessage}
                            >
                              {progressMessage}
                            </div>
                          )}
                          {(job.status === "running" || job.status === "paused") && (
                            <div className="task-progress-track">
                              <div
                                className="task-progress-fill"
                                style={{
                                  width: `${progress * 100}%`,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="field-help">
                      {t("dialog.mediaJobs.pluginEmpty")}
                    </p>
                  )}
                </div>
              </section>
            )}
          </>
        ) : (
          <p className="field-help">{t("dialog.mediaJobs.readFailed")}</p>
        )}
      </DialogShell>
    </div>
  );
}
