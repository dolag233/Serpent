# Branches and development workflow

This guide is for contributors joining Serpent for the first time. It explains the two long-lived branches and why tickets, documentation, and acceptance evidence must be maintained with the code.

## `main` and `dev`

| Branch | Purpose | What belongs there |
| --- | --- | --- |
| `main` | Release baseline | Shippable source, tests, resources, public docs, and build configuration; packages are built from here |
| `dev` | Daily development integration | A descendant of `main` plus `.beads/`, `AGENTS.md`, `docs/internal/`, and other collaboration material |

`main` is for “ready to release”; `dev` is for “safe to keep developing”. Feature branches must start from `dev`. Development, acceptance, ticket assignment, and internal records happen on `dev` or its feature branches. The current development branch in this repository is `dev`.

Development-only files must not leak into the release baseline. Do not merge `dev` directly into `main`: prefer cherry-picking reviewed feature commits. If a merge is unavoidable, use `--no-commit`, remove `.beads/`, `.codex/`, `.cursor/`, agent instructions, and `docs/internal/` before committing. Verify the result with:

```bash
git merge-base --is-ancestor main dev
git ls-tree main --name-only
```

Push `dev` through the normal hooks. Because `main` has no Beads mirror, follow the repository release procedure for its `--no-verify` push rule. Do not delete hooks or skip quality gates just to make a push succeed.

## Recommended order for a feature

### 1. Understand the project and current state

Before coding, read:

- `docs/product-brief.md` — product goals and MVP boundaries;
- `docs/internal/project-status.md` — current frontier, risks, and platform evidence;
- `docs/internal/domain-model.md` — entities, relationships, and terminology;
- `docs/internal/development-process.md` — quality gates and definition of done;
- `docs/internal/qa/human-acceptance-checklist.md` — human acceptance queue and withdrawn feedback.

Confirm that the worktree does not contain another agent’s uncommitted changes:

```bash
git status --short
git branch --show-current
```

In a shared worktree, never overwrite unrelated changes. Coordinate scope before editing a file another agent is changing.

### 2. Claim one Beads ticket

Beads is Serpent’s task source of truth. Find available work, inspect the exact ticket, and claim it atomically before coding:

```bash
bd ready --json
bd show <issue-id>
bd update <issue-id> --claim
```

Claiming sets `in_progress` and records the assignee. Only one agent may implement a ticket at a time. File a new ticket when new scope appears instead of silently expanding the current one:

```bash
bd create "Short title" -d "Context, scope, and acceptance criteria" -p 1 -t bug -l "label"
```

Close only after recording the commit and evidence:

```bash
bd close <issue-id> --reason "What changed; commands and results; commit <sha>"
```

On `dev`, `.beads/issues.jsonl` is the Git-tracked mirror. After hooks are installed, commits and pushes synchronize the mirror. Dolt data cannot be merged with an ordinary Git merge: before a cross-branch ticket migration, save `bd export --all` and `bd stats` on both sides, form the union by issue ID, and resolve conflicts manually.

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
- Implementation plan and acceptance criteria: `docs/internal/implementation/`;
- Why it was built this way, how it was verified, and remaining risk: `docs/internal/development/`;
- Standards/Spec review: `docs/internal/reviews/`;
- Automated, platform, and human evidence: `docs/internal/qa/` and the continuous acceptance checklist.

Any “verified” statement must include the command, commit baseline, platform, and result summary. Screenshots, logs, and fixtures must not expose API keys, tokens, private paths, or original user assets.

## Closing a work unit

Before handoff, check:

1. `git diff --check` and tests directly affected by the change;
2. code, tests, docs, development logs, and the `.beads` mirror belong to the same change;
3. `bd show <issue-id>` has the correct status and assignee;
4. `git status --short` contains only your intended changes;
5. the handoff states the baseline, changed files, validation commands, unverified items, and next step.

Commit and push only with the current user’s authorization. Without explicit authorization, hand off the worktree state and suggested commands instead of pushing.
