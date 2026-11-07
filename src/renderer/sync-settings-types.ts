/**
 * Shared renderer types for the two-layer sync configuration:
 * servers are global (configured in AppSettings), while each library binds
 * a server + subpath in LibrarySettings.
 */
export interface SyncServerSummary {
  id: string;
  baseUrl: string;
  username?: string;
  hasPassword: boolean;
  allowInsecureTls: boolean;
}

/** A 401 without stored credentials asks for login, not a claim about PUT support. */
export function syncUnavailableMessageKey(
  auth: "none" | "basic" | "digest",
  hasPassword: boolean,
): "settings.sync.authenticationRequired" | "settings.sync.contentTransferUnsupported" {
  return auth !== "none" && !hasPassword
    ? "settings.sync.authenticationRequired"
    : "settings.sync.contentTransferUnsupported";
}
