# Slice 0008 development log: browser extension collection

> Status: fixing
> Started: reconstructed 2026-07-13
> Last updated: 2026-07-13
> Record provenance: **流程偏差**——本文由 `f7a5c0a`/`1cff9b7`、当前源码与测试重建；原实现阶段没有按流程持续维护开发日志。

## References and ranges

- Spec: `docs/implementation/0008-browser-extension-collection-vertical-slice.md`
- Original review range: `8dc2470...cdc2247`
- Relevant commits: `f7a5c0a`（walking skeleton）、`1cff9b7`（end-to-end wiring）
- Re-review: current uncommitted working tree on 2026-07-13.

## Reconstructed implementation

- MV3 extension sends semantic save intents to a loopback HTTP server with port fallback.
- Main tracks focused library/folder context and forwards accepted intents to Worker.
- Worker downloads into operation staging, reuses managed import/conflict handling, and records `source_page_url`.

## Security/reliability fixes in the working tree

- `/save` enforces a 16 KiB request-body limit and returns 413; `onSaveIntent` is awaited, so downstream rejection/exception no longer receives false 202 success.
- Download uses streaming backpressure into staging, enforces Content-Length and running 500 MiB totals, and keeps the 30-second deadline active through body consumption.
- Every redirect hop is limited, restricted to HTTP(S), DNS-resolved, and rejected if any address is local/private/link-local/multicast; URL userinfo is rejected.
- The validated public address is injected into the actual Node HTTP(S) socket lookup, closing the DNS validation/connection TOCTOU while retaining the original hostname for Host and TLS SNI. Redirects close the previous response and repeat resolve/validate/pin.
- Remote downloads require MIME, filename extension and magic bytes to agree for the accepted image/video formats; forged or unknown containers are rejected after a small prefix rather than after consuming the body.
- Browser Origin is restricted to Chrome-extension origins when present. Failures are diagnosed and staging is cleaned.
- Added a 32-byte random browser-extension pairing token. Main persists only `safeStorage` ciphertext with owner-only file mode, `/save` requires a timing-safe Bearer comparison, and rotation invalidates the old token without restarting the HTTP server.
- Added a typed/Zod Main↔Preload pairing boundary and an explicit desktop pairing dialog. Renderer receives plaintext only while that dialog is open and never persists it.
- Added an installable extension options page backed by `chrome.storage.local`; the MV3 worker refuses to send without a configured token and maps 401 to actionable re-pairing guidance.
- `source_page_url` now enters the managed-import intent and commits atomically with the asset, revision and FTS row. Metadata failure rolls back the DB and placed file; crash-after-place retains the operation journal for reopen recovery. Diagnostic URLs retain origin+pathname but remove query/fragment, including nested causes.

## Installable MV3 delivery (0008-A)

- Added `npm run extension:build`, which bundles the TypeScript MV3 service worker, copies the Manifest and installation guide, and rasterizes the source icon into 16/32/48/128 PNG assets under `dist/extension/`.
- The build validates that the Manifest references the generated `background.js`, every declared icon exists, notification permission is present, and no content-script capture cache remains.
- Removed the content script and per-tab in-memory `Map`. The `contextMenus.onClicked` payload supplies `srcUrl`, `pageUrl`, and media kind directly, so MV3 service-worker suspension cannot erase the pending selection.
- Every terminal outcome is visible through a Chrome notification: accepted request, all loopback ports unreachable, explicit non-202 HTTP rejection (including the server-provided reason), and unsupported/non-HTTP media or page URLs.
- Installation instructions live in `extension/README.md` and are copied into the installable output.

## Verification record

- Working-tree extension client/server/pairing unit tests: **57/57 passed**.
- Extension-save coverage grew to **51 cases** after DNS pinning, magic validation and atomic source metadata; final aggregate rerun follows the current cross-slice merge.
- Extension build validation passed and produced all four non-empty PNG icon sizes.
- Global lint and typecheck passed after the installable-extension changes.
- A Chromium 148 isolated-profile smoke loaded the actual `dist/extension`, observed its MV3 service worker, opened the options page and persisted a valid token. Manual context-menu → packaged desktop capture remains pending.

## Residual risks

- No Chrome/Edge manual installation, real authenticated-site media capture, app-restart, or Windows browser QA has been executed.

This slice remains **fixing** and must not be described as accepted.
