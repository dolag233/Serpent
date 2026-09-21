import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export function executeMediaJobMainCommand(
  request: RendererRequest,
): WorkerCommand | undefined {
  switch (request.type) {
    case "media.job-summary.request":
      return {
        type: "media.job-summary",
        libraryId: request.libraryId,
      };
    case "media.list-jobs.request":
      return {
        type: "media.list-jobs",
        libraryId: request.libraryId,
        ...(request.summaryOnly === undefined ? {} : { summaryOnly: request.summaryOnly }),
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      };
    case "plugin.list-jobs.request":
      return { type: "plugin.jobs.list", libraryId: request.libraryId };
    case "media.pause-jobs.request":
      return {
        type: "media.pause-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "media.resume-jobs.request":
      return {
        type: "media.resume-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "media.cancel-jobs.request":
      return {
        type: "media.cancel-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    case "media.retry-jobs.request":
      return {
        type: "media.retry-jobs",
        libraryId: request.libraryId,
        jobIds: request.jobIds,
      };
    default:
      return undefined;
  }
}
