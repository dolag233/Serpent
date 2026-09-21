import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export function executeBrowseSessionMainCommand(
  request: RendererRequest,
): WorkerCommand | undefined {
  switch (request.type) {
    case "browse.session.open.request":
      return {
        type: "browse.session.open",
        libraryId: request.libraryId,
        ...(request.navigationId === undefined ? {} : { navigationId: request.navigationId }),
        query: request.query,
        filters: request.filters,
        scope: request.scope,
        sort: request.sort,
        smartCollectionId: request.smartCollectionId,
        limit: request.limit,
        showIgnored: request.showIgnored,
      };
    case "browse.session.page.request":
      return {
        type: "browse.session.page",
        libraryId: request.libraryId,
        sessionId: request.sessionId,
        limit: request.limit,
        offset: request.offset,
      };
    case "browse.session.ids.request":
      return {
        type: "browse.session.ids",
        libraryId: request.libraryId,
        sessionId: request.sessionId,
      };
    case "browse.session.close.request":
      return {
        type: "browse.session.close",
        libraryId: request.libraryId,
        sessionId: request.sessionId,
      };
    case "library.navigation-summary.request":
      return {
        type: "library.navigation-summary",
        libraryId: request.libraryId,
        showIgnored: request.showIgnored,
        includeTrashedFolders: request.includeTrashedFolders,
      };
    case "ai.search-plan.request":
      // Planned directly in Main so provider credentials never enter the
      // Renderer response or Library Worker command stream.
      return undefined;
    default:
      return undefined;
  }
}
