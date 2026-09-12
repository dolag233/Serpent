# Branches and development workflow

This guide is for contributors joining Serpent for the first time. It explains the two long-lived branches and why tickets, documentation, and acceptance evidence must be maintained with the code.

## `main` and `dev`

| Branch | Purpose | What belongs there |
| --- | --- | --- |
| `main` | Release baseline | Shippable source, tests, resources, public docs (including `docs/developer/` contributor guides), and build configuration; packages are built from here |
| `dev` | Daily development integration | A descendant of `main` plus `.beads/`, `AGENTS.md`, [`docs/internal/`](https://github.com/dolag233/Serpent/tree/dev/docs/internal), and other internal collaboration material |

`main` is for “ready to release and contribute”; `dev` is for “safe to keep developing”. `docs/developer/` teaches local setup and how to become a contributor; it ships on `main`. `docs/internal/` holds slice logs, specs, QA, and agent records; it stays on `dev`. Feature branches must start from `dev`. Development, acceptance, ticket assignment, and internal records happen on `dev` or its feature branches. The current development branch in this repository is `dev`.

## External contributions and pull requests

External contributors should target pull requests at `dev`, rather than submitting directly to `main`. Maintainers review, integrate, and, when necessary, refine contributions on `dev`; once a group of features meets the release conditions, reviewed work is promoted to `main` through the release process.

Accepted and merged code, documentation, tests, translations, design improvements, and other useful project changes may be credited in the root [`CONTRIBUTORS.md`](../../CONTRIBUTORS.md). Unmerged pull requests, issues that only provide suggestions, and changes that are not adopted are not listed yet. There is no hard line-count threshold: when a contribution is retained and merged, the original author should receive credit even if maintainers later reorganize or refine the change.

GitHub's automatic Contributors graph is primarily based on commits to the default branch, so a contribution merged into `dev` may not appear there immediately. This does not prevent the project from recognizing the contributor in `CONTRIBUTORS.md`. Contributors should associate the email used for their commits with their GitHub account so that GitHub can attribute the commits correctly when the work later reaches `main`.

Internal collaboration files must not leak into the release baseline. Do not merge `dev` directly into `main`: prefer cherry-picking reviewed feature commits. If a merge is unavoidable, use `--no-commit`, remove `.beads/`, `.codex/`, `.cursor/`, agent instructions, and `docs/internal/` before committing. **Do not delete `docs/developer/`.** Verify the result with:

```bash
git merge-base --is-ancestor main dev
git ls-tree main --name-only
```

Push `dev` through the normal hooks. Because `main` has no Beads mirror, follow the repository release procedure for its `--no-verify` push rule. Do not delete hooks or skip quality gates just to make a push succeed.

## Recommended order for a feature

### 1. Understand the project and current state

Before coding, read:

- [Product brief](../product-brief.md) — product goals and MVP boundaries;
- [Project status](https://github.com/dolag233/Serpent/blob/dev/docs/internal/project-status.md) — current frontier, risks, and platform evidence;
- [Domain model](https://github.com/dolag233/Serpent/blob/dev/docs/internal/domain-model.md) — entities, relationships, and terminology;
- [Development process](https://github.com/dolag233/Serpent/blob/dev/docs/internal/development-process.md) — quality gates and definition of done;
- [Human acceptance checklist](https://github.com/dolag233/Serpent/blob/dev/docs/internal/qa/human-acceptance-checklist.md) — human acceptance queue and withdrawn feedback.

Confirm that the worktree does not contain another agent’s uncommitted changes:

```bash
git status --short
git branch --show-current
```

In a shared worktree, never overwrite unrelated changes. Coordinate scope before editing a file another agent is changing.

### 2. Inspect and claim one ticket

Serpent’s task source of truth is the version-controlled `.beads/issues.jsonl`. Find available work, inspect the exact ticket, and claim it atomically before coding:

```bash
node scripts/ticket.mjs ready --json
node scripts/ticket.mjs show <issue-id> --json
node scripts/ticket.mjs claim <issue-id>
```

Claiming sets `in_progress` and records the owner. Only one agent may implement a ticket at a time. File a new ticket when new scope appears instead of silently expanding the current one:

```bash
node scripts/ticket.mjs add "Short title" -d "Context, scope, and acceptance criteria" -p 1 -t bug -l "label"
```

Close only after recording the commit and evidence:

```bash
node scripts/ticket.mjs status <issue-id> closed --reason "What changed; commands and results; commit <sha>"
```

On Windows, call `node scripts/ticket.mjs` directly; do not rely on `npm run ticket --` to forward valued options. The script rereads the JSONL under a lock and replaces it atomically; do not edit the file by hand or write it concurrently from another process. The current workflow does not use Dolt; do not run `bd dolt push`, `bd dolt pull`, `bd export`, or `bd import`.

### 3. Write the spec and development record first

A feature slice normally has these records:

```text
docs/internal/implementation/NNNN-<slice>-vertical-slice.md
docs/internal/development/NNNN-<slice>-development-log.md
docs/internal/reviews/NNNN-<slice>-code-review.md
docs/internal/qa/NNNN-<slice>-qa-report.md
```

Create the development log before the first line of implementation and keep it current. Record the baseline SHA, decisions, deviations, command results, root causes of failures, known risks, and next steps. Chat history is not project knowledge; important conclusions belong in `docs/`.

### 4. Implement a vertical slice

Follow the user journey through Renderer → Preload → Main → Worker instead of changing only a surface or making one unit test green. Reuse existing commands, menus, dialogs, theme tokens, and calm error patterns. Do not keep adding large inline logic to `App.tsx`.

Every behavior change updates affected tests. Put pure logic in `tests/unit/`, Worker/SQLite behavior in `tests/worker/`, complete cross-process journeys in `tests/e2e/`, and packaging behavior in packaged E2E. Changes to browsing, thumbnails, preview, import, search, deletion, or custom protocols require the relevant Electron journeys, not only local unit tests.

### 5. Finish with evidence

Every requirement must be traceable to its requirement, implementation location, automated test, and human/platform evidence. If Windows, a real external AI service, packaged execution, or Computer Use was not run, write “not verified”, never “passed”. After a multi-agent merge, the primary agent runs the final gate:

```bash
npm run verify:mainline
```

When a test fails, decide whether it is a regression or a deliberate spec change. Fix regressions; for spec changes update fixtures, assertions, docs, and the development log. Never delete a test to make the suite green.

## What belongs in documentation

- User behavior: `docs/user-guide/`, with synchronized English/Chinese pages and screenshots;
- Product boundaries, terminology, and irreversible decisions: product brief, domain model, or ADR;
- Implementation plan and acceptance criteria: [`docs/internal/implementation/`](https://github.com/dolag233/Serpent/tree/dev/docs/internal/implementation);
- Why it was built this way, how it was verified, and remaining risk: [`docs/internal/development/`](https://github.com/dolag233/Serpent/tree/dev/docs/internal/development);
- Standards/Spec review: [`docs/internal/reviews/`](https://github.com/dolag233/Serpent/tree/dev/docs/internal/reviews);
- Automated, platform, and human evidence: [`docs/internal/qa/`](https://github.com/dolag233/Serpent/tree/dev/docs/internal/qa) and the continuous acceptance checklist.

Any “verified” statement must include the command, commit baseline, platform, and result summary. Screenshots, logs, and fixtures must not expose API keys, tokens, private paths, or original user assets.

## Closing a work unit

Before handoff, check:

1. `git diff --check` and tests directly affected by the change;
2. code, tests, docs, development logs, and the `.beads` mirror belong to the same change;
3. `node scripts/ticket.mjs show <issue-id> --json` has the correct status and owner;
4. `git status --short` contains only your intended changes;
5. the handoff states the baseline, changed files, validation commands, unverified items, and next step.

Commit and push only with the current user’s authorization. Without explicit authorization, hand off the worktree state and suggested commands instead of pushing.
