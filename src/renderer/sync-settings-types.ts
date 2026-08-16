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
