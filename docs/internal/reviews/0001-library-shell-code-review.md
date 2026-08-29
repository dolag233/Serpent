# Slice 0001 code review

> Status: fixes applied; local re-review complete

## Review range

- Base: `a371ac2aca622e52eddb57b69af76ea844c016de`
- Head: `ae1fcf4b5646c46a7334024032c99dfb8549b576`
- Spec: `docs/internal/implementation/0001-library-shell-vertical-slice.md`

## Standards

- P1 typecheck failure from `process.env`: resolved by inheriting the packaged test environment.
- P1 missing Windows-forbidden name characters: resolved; `< > : " | ? *` are rejected and tested.
- P2 invalid libraries modified before validation: resolved; database and migration validation now precede regenerable-directory repair.
- P2 missing CSP: resolved with an Electron-local policy and development-only localhost connections.
- P2 packaged startup could silently skip: resolved by separating `test:e2e` and mandatory `test:e2e:packaged`; the latter fails without its executable.
- P3 duplicated Preload/Renderer API types: resolved in `src/shared/library-api.ts`.

## Spec

- Missing lifecycle event contract: resolved with strict schemas, Main publication, Preload allowlisted subscription and E2E event-order assertion.
- Missing old-schema upgrade: accepted clarification. v1 is the first valid schema and no v0 library format exists; guessing identity from an empty database would be unsafe. The spec now states this explicitly.
- Missing restart, second-instance and macOS window lifecycle coverage: resolved with production-bundle E2E tests.
- Worker failure coverage gaps: substantially resolved with missing database, tampered migration, validation-before-repair and unwritable-parent cases.
- Windows packaged QA: unresolved environment item, recorded as unexecuted rather than passed.

## Resolution and re-review

All first-pass agent findings were fixed and all local automated gates pass. The two review agents could not complete their second turn because the agent quota was exhausted; the primary agent therefore performed the final diff, package-content and runtime re-review locally. No unresolved code finding remains. Windows packaged QA and the v1-to-future migration implementation remain explicitly tracked scope/environment items rather than falsely closed findings.
