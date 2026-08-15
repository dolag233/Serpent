# Slice 0008 code review: browser extension collection

> Status: fixing
> Date: 2026-07-13

## Review ranges

- Original fixed range: `git diff 8dc2470...cdc2247`
- Relevant original commits: `f7a5c0a`, `1cff9b7`
- Re-review: current uncommitted working tree on 2026-07-13.
- Spec: `docs/internal/implementation/0008-browser-extension-collection-vertical-slice.md`

## Standards

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| False success and observability | Main returned 202 before knowing whether a library existed or Worker accepted the save; downstream failures were swallowed. | Async disposition produces real success/rejection and logs exceptions. | resolved |
| Unbounded input/body memory | HTTP request body and 500 MiB download could be accumulated in memory; timeout ended after headers. | 16 KiB body cap, streaming stage write, Content-Length/running-total caps, whole-body deadline. | resolved |
| Network trust boundary | URL scheme validation alone allowed SSRF and unsafe redirects. | Each hop resolves and rejects special/private addresses, then pins the validated address into the actual HTTP(S) socket while retaining hostname for Host/TLS SNI; redirects repeat the full check. | resolved automatically |
| Remote media authenticity | Content-Type/extension alone could accept forged or unknown bytes. | MIME, portable extension and magic bytes must agree for supported image/video containers; rejection happens after a bounded prefix. | resolved automatically |
| Asset/source metadata atomicity | The media file/asset committed before a second metadata write whose failure was swallowed. | `sourcePageUrl` is part of import intent and commits with asset/revision/FTS in one SQLite transaction; DB/FS fault injection and crash-reopen recovery prove no half-import. | resolved automatically |
| Local caller trust | Loopback was treated as sufficient authentication. | `/save` now requires a high-entropy Bearer pairing token stored through `safeStorage`; explicit browser Origin is restricted, missing/wrong tokens share one 401, and rotation is immediate. | resolved |
| Development-process documentation | No contemporaneous document set existed. | Rebuilt documents disclose provenance. | documented process deviation |

## Spec

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| End-to-end save and source URL | Implemented through extension→Main→Worker→managed import/metadata. | 63/63 targeted tests pass. | implemented |
| “Immediately 202 fire-and-forget” | Original implementation matched the wording but violated reliable error semantics. | Working tree deliberately waits for acceptance and may return 4xx/5xx. Spec should be updated to reflect truthful acceptance semantics. | intentional/open deviation |
| 30 s / 500 MiB protection | Originally incomplete in practice. | Implemented through body completion. | resolved |
| Secure local channel | Spec originally listed Native Messaging/auth as out of scope, but loopback alone was insufficient. | Pairing token, desktop rotation UI, extension options storage, and non-leakage tests are implemented. | resolved |
| DNS rebinding | Not addressed by original spec. | Validated addresses are pinned into the socket lookup with connection reuse disabled; redirect hops re-resolve and re-pin. | resolved automatically |

## Re-review conclusion

Standards: automated review has no open caller-authentication finding.
Spec: the authenticated save flow is implemented; real Chrome/Edge and Windows manual QA remain. Slice remains **fixing**.
