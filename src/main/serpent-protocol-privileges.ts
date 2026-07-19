/**
 * Privileges for the `serpent://` artifact / source media scheme.
 *
 * Must be registered via `protocol.registerSchemesAsPrivileged` before
 * `app.ready`. `stream: true` is required so `<video>` / `<audio>` treat
 * Range responses as a streaming transport; without it Chromium buffers as if
 * the body were a single download, and seek/scrub against `createArtifactResponse`
 * frequently surfaces MEDIA_ERR_NETWORK / decode failures (Serpent-jh2).
 */
export const SERPENT_PROTOCOL_SCHEME = "serpent" as const;

export const SERPENT_PROTOCOL_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true,
} as const;

export function serpentProtocolSchemes() {
  return [
    {
      scheme: SERPENT_PROTOCOL_SCHEME,
      privileges: { ...SERPENT_PROTOCOL_PRIVILEGES },
    },
  ];
}
