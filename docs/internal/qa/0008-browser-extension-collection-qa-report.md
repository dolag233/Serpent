# Slice 0008 QA report: browser extension collection

> Status: fixing / security QA incomplete
> Date: 2026-07-13

## Build under test

- Original fixed range: `8dc2470...cdc2247`
- Working-tree re-test: uncommitted shared tree on macOS arm64, Node 24.15.0 / Electron 43.1.0.
- Automated security tests use local HTTP/fetch/DNS seams. A real Chromium 148 MV3 runtime was also launched with an isolated temporary profile; it loaded the built extension, started `background.js`, opened `options.html`, and persisted a valid pairing token through `chrome.storage.local`.

## Automated evidence

| Gate | Result |
| --- | --- |
| Pairing/server/client targeted tests | **57/57 passed** at implementation checkpoint |
| Extension-save Worker tests | **51 cases** after URL atomicity/security additions; final aggregate rerun pending current cross-slice merge |
| Global lint/typecheck | passed |
| Full `npm test` | 2026-07-13 checkpoint: **713 passed / 1 skipped**; final aggregate rerun pending |
| Installable extension build | `npm run extension:verify` passed; `dist/extension` contains MV3 worker, options page and icons |
| Real MV3 runtime smoke | Chromium 148 pass: worker URL registered, options UI submitted, token persisted, manifest v3 verified |

## Acceptance/security matrix

| Scenario | Result |
| --- | --- |
| Valid intent reaches downstream and returns truthful acceptance | automated pass |
| No active library/downstream exception returns non-202 with log hook | automated pass |
| Request body over 16 KiB returns 413 | automated pass |
| Content-Length/running total over 500 MiB is rejected | automated pass |
| 30-second timeout covers body streaming | automated pass |
| Multi-chunk body streams to stage without whole-file buffering | automated pass |
| Private/link-local/literal IP and redirect hop rejected | automated pass |
| Overlong server-provided filename maps to filesystem path-limit reason | automated pass |
| DNS answer is pinned between validation and connection | automated pass with injected lookup and real pinned socket; every redirect hop is re-resolved/revalidated/pinned |
| MIME, extension and magic-byte agreement | automated pass for accepted image/video formats; forged/unknown payloads rejected before full body consumption |
| Source-page metadata and asset/file import commit atomically | automated fault-injection pass; no half-import after metadata failure or crash recovery |
| Correct, missing, and incorrect pairing tokens | automated pass |
| Token rotation invalidates old token immediately | automated pass |
| Pairing token absent from 401 responses and error hook | automated pass |
| Encrypted-at-rest token and encryption-unavailable fail-closed behavior | automated pass |

## Platform/manual QA

- Chromium 148 isolated-profile installation/options/service-worker smoke: passed. Context-menu click → live desktop round trip was not executed.
- Google Chrome stable command-line side-load was attempted but the current official build suppressed `--load-extension`; this is a test-harness restriction, not recorded as a product pass or failure. Manual `chrome://extensions` unpacked install remains pending.
- Edge unpacked installation: not executed.
- Capture from a page requiring cookies, redirects or Referer: not executed.
- App stopped/restarted, port fallback and multi-window focused context: not manually executed.
- Persisted `serpent.log` inspection for real network failure: not manually executed.
- Windows browser/firewall/security-product behavior: not executed; no runner.

## Final result

**Automated security acceptance and a real Chromium MV3 load/options smoke passed.** Manual Chrome/Edge context-menu → packaged desktop round trip, restart persistence and Windows browser/firewall QA remain unexecuted, so the slice stays **fixing** rather than accepted.
