# Slice 0006 QA report: thumbnails, preview, and format decoding

> Status: fixing / QA incomplete
> Date: 2026-07-14

## Build under test

- Original fixed range: `8dc2470...cdc2247`
- Working-tree re-test: uncommitted shared tree on macOS arm64, Node 24.15.0 / Electron 43.1.0.
- Most deterministic failure/concurrency tests use injected decoders. In addition, a real locally built macOS arm64 FFmpeg/OIIO bundle now runs the complete MVP format decode matrix. Formal packaged acquisition remains fail-closed until publication provenance is recorded.

## Automated evidence

| Gate | Result |
| --- | --- |
| Media binary supply-chain unit tests | **9/9 passed** |
| Media lifecycle/format scoped tests | **96/96 passed** |
| Full Worker suite | **456 passed, 1 platform skip** |
| Full unit + Worker suite | latest combined-tree run **778 passed, 1 platform skip** |
| Real bundle decode matrix | passed repeatedly: PNG/JPEG/GIF/TIFF/TGA/EXR/MP4/MOV/AVI/WMV |
| Real persistent queue/derivatives | **passed**: all four videos produce poster/metadata/contact sheet; AVI/WMV proxies are VP9+Opus, seek-decodable, preserve 64×48 landscape / 48×64 portrait without upscaling, and survive reopen without duplicate jobs |
| Media preview Electron E2E | **2/2 passed** after updating the diagnostic assertion to the persistent media-job scope |
| Successful video Electron E2E | **1/1 passed**: H.264 MP4 source + AVI WebM proxy both metadata-ready, non-zero size, playback advances and seek succeeds |
| Thumbnail and image preview decode/reopen regression | **passed**; assertions require non-zero decoded dimensions before and after reopening |
| Existing populated library copy smoke | **passed**; first 20 thumbnails decoded, image modal decoded, failed WebM proxy retried to 720×900 metadata-ready playback |
| Scoped ESLint / `git diff --check` | passed |
| Global lint/typecheck | passed |
| Full `npm test` | latest combined-tree run **777 passed, 1 skipped** |
| Automatic palette targeted suite | **220/220 passed** (algorithm, artifact/job lifecycle, manual priority, revision invalidation, video poster, failure/retry/cancel/reopen, protocol and colour sorting) |
| Latest full `npm test` after palette work | **738 passed, 1 skipped, 1 unrelated ZIP streaming timeout**; isolated ZIP rerun **27/27 passed** |
| Full Electron E2E | latest combined-tree run **17/17 passed** |
| Package/verify + packaged startup/import | media verification intentionally refuses packaging until immutable archive provenance is configured |

## Acceptance matrix

| Scenario | Result |
| --- | --- |
| PNG/JPEG/etc. thumbnail generation and artifact lookup | automated pass |
| Video probe/poster and first-frame behavior | real FFmpeg matrix pass |
| Contact sheet/WebM command construction and cancellation | automated + real local bundle pass; real packaged playback pending |
| EXR/TGA/TIFF OIIO + OCIO display path | real oiiotool matrix pass |
| Retry after ready/failed artifact leaves one current row | automated pass |
| Poster failure produces failed state and no ready/empty ID | automated pass |
| Subprocess diagnostic buffers are bounded and tail-preserving | automated pass |
| Actual FFmpeg/OIIO binary present in packaged app | **not executed**; local verified archive exists, acquisition provenance not yet approved |
| Direct source/proxy URL, seekable Range transport, native controls, explicit/spacebar full-screen, pending/failed and retry UI | automated protocol/unit coverage; failure UI E2E pass |
| Symlink/current-ready-kind artifact authorization | automated Worker/Main-boundary unit coverage |
| Real decoder generation | passed outside packaged Electron |
| Real Electron playback/capability fallback | source MP4 + automatic AVI proxy E2E and Computer Use pass; packaged playback remains unexecuted |
| OCIO transform/exposure on representative professional corpus | basic real fixtures pass; broad corpus and Renderer exposure control incomplete |
| Automatic/manual palette provenance UI | protocol and Worker pass; full Electron E2E **16/16 passed** |

## Platform/manual QA

- macOS media UI/manual: **executed on 2026-07-14 with Computer Use** for the local final working tree; packaged UI remains unexecuted.
- macOS package/ASAR/native module verification and packaged startup/import passed; media binary/license/playback verification remains incomplete.
- Windows codec, binary resolver, path quoting, playback and packaged QA: not executed; no runner.
- Safe UI reason + persisted `serpent.log` diagnostic pairing for a deterministic media failure: Electron E2E passed.

## 2026-07-13 preview regression incident

- Impact: all `serpent://preview` images and `serpent://source` / `serpent://proxy` media were blocked by Renderer CSP; assets and generated artifacts remained intact.
- Root cause: `index.html` omitted `serpent:` from `img-src` and `media-src`.
- Escaped test: the PNG E2E asserted only that an `<img>` element was visible, not that it decoded; the proxy Worker mock checked the codec but not the misspelled `-row-mv` option. The report also already marked real Electron playback and manual media QA as unexecuted, so the slice should not have been treated as generally usable.
- Corrective action: require decoded image dimensions, reopen an existing library in E2E, assert both CSP directives, check critical FFmpeg options, and run `npm run verify:mainline` on the final combined tree before more feature work.
- Retest: a copy of the user's 147-asset library was used. The first 20 thumbnails and an image modal decoded; a previously failed VP9/Opus proxy regenerated with the corrected option and loaded at 720×900. The source library was never opened for writes during this check.
- Final combined-tree gate: `npm run verify:mainline` passed lint, typecheck, extension build, **774 passed / 1 skipped** unit+Worker tests, **4/4** search performance tests, and **16/16** Electron E2E tests.
- Browsing/restart follow-up: the final gate passed again with **777 passed / 1 skipped**, **4/4** search performance tests and **16/16** Electron E2E. New assertions cover decoded media, continuous no-pagination browsing, masonry first/last-item reachability, Ctrl+Wheel/pinch semantics with a retained visual anchor, and full-process restart restoration of the recent library and focused asset.

## 2026-07-14 real video playback closure and UX evidence

- Data: dedicated temporary library with a 4-second 640×360 H.264 MP4 and MPEG-4 AVI; no user library or private asset was opened.
- Journey: create library → import both videos → wait for decoded cards → double-click MP4 → verify source playback → next asset → verify generated AVI proxy playback → resize to a narrower window → return to asset browser.
- Functional result: both cards decoded; MP4 displayed as “视频原文件预览”; AVI displayed as “视频代理预览”; both showed the complete frame, native controls and matching inspector metadata. The AVI proxy visibly played to the end. The transient disk-sync notice disappeared automatically after four seconds.
- Layout result: normal and narrower-window screenshots show the full 16:9 frame without cropping, controls contained within the media stage, and inspector metadata consistent with the selected asset. No overlap or horizontal overflow was observed.
- Known viewer UX debt, not silently accepted: the top toolbar, “关闭” wording, speed-control placement and video-control focus/`Esc` behavior remain part of planned slice 0013. In the manual run, `Esc` was consumed while the native video play control held focus, so the toolbar button was needed to return. This does not block the local decode/playback closure, but slice 0013 must fix and regression-test it before viewer UX acceptance.
- Screenshots:
  - `docs/internal/qa/evidence/0006-video-playback/01-video-thumbnails.jpg`
  - `docs/internal/qa/evidence/0006-video-playback/02-direct-mp4-viewer.jpg`
  - `docs/internal/qa/evidence/0006-video-playback/03-avi-proxy-viewer.jpg`
  - `docs/internal/qa/evidence/0006-video-playback/04-avi-proxy-viewer-narrow.jpg`
- Not executed: packaged playback, Windows playback/package, broad professional EXR/TIFF corpus. These remain explicit blockers; the slice stays `fixing`.

## Final result

**Not passed.** Core generation, job lifecycle, direct/proxy selection, failure observability and the real macOS decoder matrix are covered. Immutable bundle publication, Windows bundle/package evidence, real packaged playback, animated GIF behavior and the remaining exposure/corpus work are required. Slice stays **fixing**.
