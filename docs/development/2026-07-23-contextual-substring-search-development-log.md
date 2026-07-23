# Contextual substring search — development log

> Status: implementing
>
> Date: 2026-07-23
>
> Branch: `codex/slice-002-asset-ingestion`
>
> Baseline: `8d2db30` (`refactor(shell): align toolbar with browse column gutters`)
>
> Tracking: `Serpent-wcnk`, `Serpent-45io`

## Product decision

The library search field is a normal contextual search surface. It must search
only the assets visible in the current browse scope (including its active
filters), and must match case-insensitive substrings in filename, tags,
description, source link, author, folder path, and indexed metadata. One
character is a valid term: `y` must find both a filename containing `y` and a
`y2k` tag. AI may still analyse an asset on explicit request, but it is not a
search mode and has no search-bar control.

The query grammar is:

- whitespace = AND;
- `|` = OR;
- `-term` = exclusion;
- quoted text keeps a phrase intact;
- `name:`, `tag:`, `desc:`, `link:`, `author:`, `path:`, and `meta:` narrow a
  term to one indexed field (documented aliases remain supported).

## Implementation

- Added a renderer expression parser and display highlighter in
  `src/renderer/search-expression.ts`.
- Replaced token-only FTS search with contextual normalized text and a trigram
  FTS index in schema migration 18. Terms shorter than three characters use a
  parameterized SQLite substring predicate; longer positive queries use FTS to
  narrow candidates and the same predicate to preserve exact semantics.
- Carries grouped OR/AND expressions through the typed preload/worker API and
  ranks exact filename/tag matches before prefixes and other contains matches.
- Preserves current browse scope, filters, sorting, paging, and contextual
  snippets. A request generation counter prevents slower automatic searches
  from replacing newer results while the user is typing.
- Removed the renderer AI-search mode, state, submit route, and sparkle
  control. The right edge of the search field now has an accessible `?` help
  button. Its light, multi-line guide uses art-work examples (`机甲 场景`,
  `tag:y2k`, `-草图`) and clamps inside the window edge. Filename text
  highlights matching positive terms.
- Updated product/domain documentation and human acceptance entries
  `SEARCH-005` through `SEARCH-007`.

## Important implementation decisions

SQLite trigram FTS cannot match one- or two-character inputs. Rather than
pretend that a search such as `y` is supported, the Worker deliberately falls
back to safe parameterized `instr()` predicates for those inputs. The fallback
is covered by a 100k-asset performance gate and returned a 299.1 ms median on
this macOS development machine.

The existing internal AI query-planning protocol is intentionally not removed
in this change because it is independently typed and covered by historical
compatibility tests. It is no longer reachable from the product UI, documented
as a search feature, or invoked by automatic searching.

## Verification so far

| Command | Result |
| --- | --- |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search-performance.test.ts --reporter=dot` | Pass: 5 tests. Browse 178.2 ms, keyword 73.5 ms, one-character 299.1 ms, combined filter/sort 113.3 ms median on 100k assets. |

Additional typecheck, unit/worker suite, lint, real desktop exercise, review,
and final QA evidence are recorded in the corresponding QA report as they run.

## Known verification limits

- The product desktop instance could not be driven through Computer Use because
  macOS was locked. The real application must be unlocked before the `?`,
  highlight, auto-search, and current-scope journey can be visually signed off.
- Windows has no runner and remains unverified.
- The duplicate local development server on port 5173 serves stale pre-change
  renderer code, including the removed sparkle button. The current server on
  port 5174 serves the new `?` button. This is a local process issue, not a
  second renderer implementation; do not use the stale instance for QA.
