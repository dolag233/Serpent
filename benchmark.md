# Serpent-sa65 Resource Loading Benchmark

## Scope

- Branch: `codex/serpent-sa65-benchmark`
- Baseline: `78fa65724e97cd89e4d8b5fee1989bbc7907c074`
- Target: 10,000+ asset library, fourth card-size stop (index 3), random scrollbar jumps to unseen ranges, every visible thumbnail decoded within 500 ms.
- Fixture: local APFS v3 fixture; absolute local paths are intentionally omitted from committed evidence.

## Reproducible command

```bash
npm run large-library:generate -- \
  --output <local-apfs-path> --assets 10000 --seed 20260816 --reset \
  --asset-profile images-only

SERPENT_LARGE_LIBRARY_PREWARM_PATH=<local-apfs-path> \
  node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts \
  tests/worker/large-library-benchmark-prewarm.test.ts --disableConsoleIntercept

npm run test:perf:large-library -- <local-apfs-path>

SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 \
  npm run test:e2e:large-library-benchmark -- <local-apfs-path>
```

The Electron benchmark uses the fixed jump fractions
`0.11, 0.83, 0.37, 0.69, 0.22, 0.77, 0.46, 0.61, 0.15, 0.54`.
It checks actual image decoding (`complete && naturalWidth > 0`), visible card
count, placeholders, default icons, page request offsets/waves, and renderer
long tasks. The image-only profile isolates the hard acceptance path; the
mixed profile remains a separate media-coverage smoke test because text/audio/
unsupported assets do not have image thumbnails by design.

## Baseline

The pre-optimization warm-thumbnail Electron run (10,000 assets, image-only,
fourth stop) passed all 10 jumps:

- Per-jump elapsed ms: `217.5, 265.9, 255.6, 188.8, 257.0, 300.1, 305.9,
  241.6, 293.3, 254.5`.
- `p50=257.0 ms`, `p95=305.9 ms`, `max=305.9 ms`, `500 ms=10/10`.
- Visible cards: `22–24`; decoded images: equal to visible cards on every
  sample; placeholders: `0`; default icons: `0`.
- Page request waves: `0–2` per jump; the zero-wave samples were already
  covered by an actual decoded layout thumbnail.

Worker baseline on the same image-only 10,000-asset fixture:
`startup=300.2 ms`, `folder switch=1.1 ms`, `search=10.6 ms`,
`layout=33.2 ms`, `Inspector=0.2 ms`.

After the queue-path optimization, the current HEAD Worker rerun measured:
`startup=296.9 ms`, `folder switch=0.9 ms`, `search=8.4 ms`,
`layout=28.7 ms`, `Inspector=0.2 ms`.

For comparison, the mixed v3 smoke run produced `4/10` within the strict
image-only assertion because two visible cards were non-image assets without
preview artifacts; this is fixture media composition, not an image decode
timeout. Its Worker baseline was `startup=320.8 ms`, `folder switch=0.9 ms`,
`search=9.2 ms`, `layout=32.6 ms`, `Inspector=0.1 ms`.

## Optimized result

The renderer now reports visible layout slots to the visible-window thumbnail
queue even before their full `AssetSummary` cards mount. It also keeps the
reported window key across React state updates and limits the queue runway to
25% of one viewport; the previous full-viewport runway could enqueue up to
three times the work needed for the interaction. Light visible-window waves
now stop after the primary preview job and leave metadata/palette/proxy/contact
sheet work to the secondary idle lane. None of these paths introduce
synthetic `__pending:` cards.

Post-change Electron run:

- Per-jump elapsed ms: `279.5, 275.0, 312.4, 237.7, 224.2, 275.2, 199.4,
  250.4, 273.8, 191.1`.
- `p50=273.8 ms`, `p95=312.4 ms`, `max=312.4 ms`, `500 ms=10/10`.
- Visible cards: `22–24`; decoded images equal visible cards on every sample;
  placeholders: `0`; default icons: `0`.
- Page request waves: `0–2` per jump; maximum observed renderer long task:
  `80 ms`.

The warm run is within normal local Electron variance and is not presented as
a numeric speedup over the baseline; importantly, the optimization preserves
the 500 ms gate while improving the cold/missing-thumbnail scheduling path.

A second unchanged post-change Electron run also passed `10/10`:
`p50=265.6 ms`, `p95=318.6 ms`, `max=318.6 ms`; visible/decode counts still
matched for all samples and placeholder/default-icon counts remained zero.

After reducing the visible queue runway, deduplicating repeated visible-window
reports, and isolating secondary media work, the current HEAD was rebuilt and
rerun with the same fixture and fixed jumps:

- Per-jump elapsed ms: `156.8, 158.1, 165.9, 166.5, 162.5, 212.9,
  145.7, 186.6, 136.8, 178.7`.
- `p50=165.9 ms`, `p95=212.9 ms`, `max=212.9 ms`, `500 ms=10/10`.
- Visible cards: `22–24`; every visible card had a decoded image;
  placeholders: `0`; default icons: `0`.
- Page request waves: `0–1` per jump; renderer long tasks: `0`.

The cold Worker generation probe was also fixed to coldify its APFS clone
before enqueueing (the warm shared fixture previously made the test report
`enqueued=0`). In three isolated runs on the same 10,000-image fixture, one
fourth-stop viewport of 30 thumbnails processed `30/30` in
`380.0/368.7/376.3 ms` (p50 `376.3 ms`, max `380.0 ms`), with throughput
`78.9/81.4/79.7 thumbnails/s`.

Final queue-path rerun after the independent review:

- The library-open primary backfill is delayed until the first interactive
  visible-window report has been idle for 1 second.
- A light visible-window queue claims the reported window in one bounded
  queue call; decoder concurrency remains capped by physical CPU count.
- If a layout slot has no artifact when the full summary page arrives, the
  ready event now supplies the real artifact id to that slot/card without
  creating a synthetic card or placeholder.
- Warm Electron rerun: per-jump elapsed ms
  `159.8, 150.5, 151.1, 150.8, 161.0, 145.7, 160.6, 169.0, 132.6, 145.9`;
  `p50=151.1 ms`, `p95=169.0 ms`, `max=169.0 ms`, `500 ms=10/10`.
  Visible cards/decode counts were `23/23, 23/23, 23/23, 22/22, 22/22,
  24/24, 23/23, 23/23, 22/22, 23/23`; placeholders/default icons were `0/0`
  for every jump, request waves were `0–1`, and long tasks were `0`.

Cold stress measurement (not the warm-thumbnail acceptance gate) removed
1,000 destination-page thumbnail artifacts from an APFS clone while retaining
real source files. The final fixed-jump run reached `7/10`, with per-jump
`194.1, 623.7, 443.4, 786.7, 464.3, 566.6, 447.6, 417.0, 287.5,
452.2 ms`, `p50=452.2 ms`, `p95/max=786.7 ms`. Earlier isolated
`0.83` reproductions were `833.4 ms` before deferring startup backfill,
`651.4 ms` after the delay, and `640.2 ms` after the single-window queue
claim. The visible images still decoded with no placeholders/default icons;
the remaining misses are cold source thumbnail generation plus page/render
latency, outside the committed real-thumbnail-file gate. A direct Worker run
for the same offset (`8200`) processed 30 cold thumbnails in `369.8 ms`
(`81.1 thumbnails/s`).

## Other worktree comparison

`git worktree list` found no `benchmark.md` in the other local worktrees:
`Serpent`, `Serpent-8b5b-9`, `Serpent-rtg8-fork`, or
`.worktrees/serpent-3kfe-load-perf`. There is therefore no local competitor
result to compare numerically. This worktree currently has reproducible
10/10 image-only Electron evidence under the 500 ms target.
