# Slice 0006 code review: thumbnails, preview, and format decoding

> Status: fixing
> Date: 2026-07-14

## Review ranges

- Original fixed range: `git diff 8dc2470...cdc2247`
- Relevant original commits: `9f3774e`, `f588404`, `b4bcbb3`
- Re-review: current uncommitted working tree on 2026-07-13.
- Spec: `docs/internal/implementation/0006-thumbnails-preview-format-decoding-vertical-slice.md`

## Standards

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| Native module bundling | Worker build attempted to consume Sharp's `.node` file as text. | Sharp is externalized; build/test regression exists. | resolved |
| Artifact state invariant | Repeated generation inserted a second current `(revision_id, kind)` and could hit the partial unique index; failed poster could still produce empty success. | Retry invalidates prior current rows; poster failure yields one current failed row and no ready/empty ID. | resolved |
| Process output memory | stdout/stderr accumulated without bounds; diagnostics kept the beginning. | Bounded tail buffers and tail diagnostics added. | resolved |
| Architectural boundary | `serpent://` avoids exposing absolute paths. | No relevant regression found. | pass |
| Artifact authorization | Original handler trusted a lexical path and could follow a tampered artifact symlink. | Current-ready-kind checks, Worker realpath/lstat containment and Main `O_NOFOLLOW`/regular-file descriptor validation added. | resolved |
| Long-running retry IPC | Synchronous retry could exceed the 15-second Worker request timeout and produce a fatal late response. | Retry now queues, returns `started`, drains in the background and exposes pending/failed state through polling. | resolved |
| Renderer async lifecycle | Interval polling could overlap and late IPC results could update an unmounted modal. | Single-flight recursive polling, request sequencing, unmount invalidation and catch/finally handling added. | resolved |
| Development-process documentation | No contemporaneous 0006 dev/review/QA set existed. | Rebuilt documents disclose the deviation. | documented process deviation |

## Spec

| Finding | Original range | Working-tree re-review | Status |
| --- | --- | --- | --- |
| Image thumbnails/basic artifact generation | Implemented with Sharp and mockable CLI seams. | Targeted tests pass. | implemented |
| Packaged FFmpeg/OIIO | Resolver returned a bundled path even when no binary existed; repository contained no approved binary acquisition/package/license verification chain. | Reproducible vcpkg builds, lock/manifest verification, license evidence, architecture/import checks and Forge fail-closed hooks now exist. A real macOS arm64 archive passed verification, but publication provenance and Windows evidence remain open. | partial / release-blocking |
| Complete video preview UI | Renderer primarily displayed an image thumbnail modal. | Current tree capability-probes MP4/MOV/WebM direct playback, performs one-time proxy fallback, streams source/proxy Range reads, renders native controls, supports explicit/spacebar full-screen, retry and actionable states. | implemented; packaged smoke open |
| Media job lifecycle | Jobs existed without complete user-operable lifecycle or hard cancellation. | list/pause/resume/cancel/retry, subprocess abort, late-write cleanup, restart recovery and process-global limits have automated coverage. | implemented |
| OCIO/complex formats | OIIO invocation did not establish the specified display transform. | Pinned OCIO studio-config display transform and exposure seam run with the real bundle; Renderer exposure control and professional corpus remain open. | partial |
| Revision freshness | Import and watcher stored mtime through different precision paths. | Unified BigIntStats millisecond persistence prevents phantom external revisions and artifact invalidation; real format regression covers the failure. | resolved |
| Automatic palette lifecycle | Schema reserved palette artifacts/jobs but no producer, revision rebuild, retry path or provenance-aware UI existed. | Deterministic local extraction consumes bounded current derivatives, persists normalized JSON, uses the media queue lifecycle, and keeps manual metadata authoritative. | resolved |
| Colour sorting | Product scope lists colour sorting, but palettes were not queryable without parsing JSON. | schema v12 persists indexed dominant hue/lightness; `color` sort is available to search/UI/smart collections with NULL-last and stable ID tie-break. | implemented |

## Re-review conclusion

Standards: reliability blockers found in the original range are fixed in the working tree; the current shared diff still requires the independent final review.
Spec: media generation, lifecycle, direct/proxy preview and a real macOS decoder matrix are implemented. Publication provenance, Windows bundle/packaged QA, Renderer exposure control and animated GIF behavior remain gaps. Slice remains **fixing**.

## 2026-07-14 scoped two-axis re-review

Scope: `tests/worker/real-media-bundle.test.ts`, `tests/e2e/media-video-playback.test.ts`, the WebM proxy generator, mainline media gate, and the Computer Use process gate.

### Standards findings

- Resolved: real binary subprocesses now have bounded test timeouts and output buffers; E2E cleanup covers fixture generation and Electron launch failures.
- Resolved: agents without Computer Use may not silently skip product acceptance; the process requires an explicit unexecuted result and handoff.
- Resolved: real media tests honor environment overrides / build fallback, and macOS arm64 mainline requires the bundle instead of silently skipping.
- Resolved: proxy output now has a 512 MiB safety limit with file cleanup, failed job/artifact state and persisted diagnostic.

### Spec findings

- Resolved: the real format matrix traverses the persistent queue, creates and probes true AVI/WMV proxies, then closes/reopens to prove reuse without duplicate work.
- Resolved: the new Electron flow proves both direct MP4 and automatic AVI proxy playback rather than only DOM/job presence.
- Resolved from review: `scale=720:-2` upscaled small media and could exceed the long-edge limit for portrait input. The new filter preserves both landscape and portrait dimensions when already below 720.
- Remaining release blockers: packaged media playback cannot run until immutable bundle publication provenance is configured; Windows remains unverified. These are recorded as unexecuted, not passed.
- Remaining UX finding: Computer Use reproduced that `Esc` may be consumed when a native video control owns focus. This is assigned to slice 0013 and prevents viewer UX acceptance, but does not invalidate verified local playback.

Re-review result: no unresolved blocker in the local real queue/source/proxy playback scope. Slice 0006 remains **fixing** for package provenance/platform evidence and the explicitly deferred format/UX items.
