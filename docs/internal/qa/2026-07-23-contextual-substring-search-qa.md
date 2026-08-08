# Contextual substring search — QA report

> Status: in progress
>
> Date: 2026-07-23
>
> Branch: `codex/slice-002-asset-ingestion`
>
> Baseline: `8d2db30`; final implementation commit: pending

## Scope

This QA covers `Serpent-wcnk`: contextual substring search, one-character
terms, field/query grammar, search-ranking, automatic search, the removal of
the AI search UI control, syntax help, and filename match highlighting.

## Four-column traceability

| Requirement | Implementation | Automated evidence | Human/platform evidence |
| --- | --- | --- | --- |
| Current browse scope is retained | `src/renderer/App.tsx`, search definition is executed with the active scope and filters | `tests/worker/search.test.ts` contextual scope cases | `SEARCH-007` pending product-owner verification |
| `y` finds filename and `y2k` tag | `src/worker/library-service.ts`, contextual substring predicate and schema v18 index | `tests/worker/search.test.ts`; 100k short-term performance gate | `SEARCH-007` pending |
| AND, OR, exclusion, quotes, aliases | `src/renderer/search-expression.ts` | `tests/unit/search-expression.test.ts` and worker field/group cases | `SEARCH-005`, `SEARCH-007` pending |
| Stable ranking and paging | `src/worker/library-service.ts` relevance expression | `tests/worker/search.test.ts` | `SEARCH-007` pending |
| No AI icon; `?` syntax help; automatic search | `src/renderer/App.tsx`, `src/renderer/styles.css`, i18n catalogs | parser/unit coverage; source served by current Vite instance shows `search-syntax-help` with `?` | `SEARCH-005` pending; real desktop blocked while macOS is locked |
| Filename highlighting | `src/renderer/App.tsx`, `src/renderer/search-expression.ts`, `src/renderer/styles.css` | `tests/unit/search-expression.test.ts` | `SEARCH-006` pending |

## Automated results

| Command | Result |
| --- | --- |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/search-performance.test.ts --reporter=dot` | Pass, 5 tests. 100k assets: browse 178.2 ms; keyword 73.5 ms; one-character fallback 299.1 ms; filter/sort 113.3 ms median. |
| `npm run typecheck` | Pass. |
| `npm run test:unit` | Pass: 164 files; 1,334 passed and 1 skipped. |
| `npm run lint` | Existing baseline failures in unrelated AI config, browser restore, trash, worker, and test files. Six newly added search-test escapes were found and corrected; no follow-up lint was run after product direction to stop testing. |
| `npm run test:worker` / `npm run test` | Not run to completion: product direction on 2026-07-23 was “不用测试”. The previously started full suite was interrupted and is not treated as a result. |

## Real desktop / visual QA

Computer Use was available but macOS reported that it was locked and automatic
unlock was paused after physical input. No app interaction or screenshot is
claimed as passed. After unlock, run `npm start` only once, then check:

1. The right side of the search field shows `?`, never the old sparkle icon.
2. Hovering `?` explains whitespace, `|`, `-`, field prefixes, and quotes.
3. Typing `y` searches automatically and highlights the filename occurrence.
4. A `y2k` tag is found by `y` without leaving the current folder/collection.
5. Search `name:...`, `tag:...`, `a | b`, and `-term`, then use × to restore
   the current browse scope.

The local duplicate Vite server on port 5173 is stale and serves the old
sparkle control. The active implementation source is served by port 5174; use
only one freshly started instance for this check.

## Platform matrix and risks

- macOS automated Worker coverage: passing as listed above.
- macOS real desktop: not executed; locked desktop is a blocking environment
  condition, not a pass.
- Windows: not executed; no runner.
- Packaged application and E2E: pending final gate; not represented as passed.

## Final conclusion

Pending final automated suite, independent Standards/Spec review, and the
unlocked macOS desktop journey. This report does not mark the feature as
accepted.
