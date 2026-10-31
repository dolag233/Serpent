# Branching and Development Workflow

This document is for contributors and maintainers participating in Serpent development. It explains the repository's long-lived branching architecture, external contribution workflow, and internal maintainer practices.

## 1. Branch Roles: `main` and `dolag_dev`

| Branch | Purpose | What belongs there | Access and releases |
| --- | --- | --- | --- |
| `main` | **Latest branch** | Product code, automated tests, runtime resources, public documentation (including `docs/developer/`), and build configuration | Default branch. Every Pull Request merges here |
| `dolag_dev` | **Maintainer working branch** | May carry internal tickets (`.beads/`) and internal documents (`docs/internal/`) alongside the product tree | Does not receive external Pull Requests |

- `main` stays current. Product changes arrive through Pull Requests;
- `dolag_dev` holds the maintainer's internal records;
- **External Pull Requests target `main`**.

---

## 2. External Contributor Workflow (GitHub Collaboration)

The recommended workflow for external developers participating in Serpent:

### 2.1 Preparation

1. Fork the [dolag233/Serpent](https://github.com/dolag233/Serpent) repository on GitHub;
2. Clone your forked repository to your local development environment (do not place it on SMB/NAS network shares):
   ```bash
   git clone https://github.com/<your-username>/Serpent.git
   cd Serpent
   ```
3. Follow the [Setup Guide](setup.en.md) to configure Node.js 24 and dependencies:
   ```bash
   npm ci --registry=https://registry.npmjs.org
   npm run rebuild:native
   ```
4. Check out the latest `main` and create your feature or bugfix branch:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/my-feature-name
   ```

### 2.2 Development and Quality Gates

When making changes, adhere to these engineering principles:

1. **Type safety and code style**: Pass static TypeScript type checking and ESLint before committing:
   ```bash
   npm run typecheck
   npm run lint
   ```
2. **Test coverage**:
   - Add unit tests for pure logic to `tests/unit/`;
   - Add tests for Worker or SQLite operations to `tests/worker/`;
   - Run targeted tests to verify your changes:
     ```bash
     npm run test:unit -- tests/unit/<your-test-file>.test.ts
     ```
   - If changes touch library opening, database migrations, or underlying filesystem operations, pass the library availability suite:
     ```bash
     npm run test:library-availability
     ```
3. **Workspace cleanliness and privacy sanitization**:
   - Committed files **must never contain local absolute paths, personal usernames, drive letters, private credentials, or temporary test media**;
   - Test artifacts must be created in temporary directories and cleaned up when tests complete.

### 2.3 Commit Message Conventions (Conventional Commits)

Commit messages should clearly state the intent and scope of the change using standard conventions:

```text
<type>(<scope>): <short description>
```

- **`type`** common categories:
  - `feat`: New user-facing feature or interaction;
  - `fix`: Bug fix;
  - `docs`: Documentation only;
  - `test`: Adding or fixing tests;
  - `refactor`: Code change that neither fixes a bug nor adds a feature;
  - `chore`: Tooling, build pipeline, or dependency updates.
- **`scope`** optional modules: `canvas`, `viewer`, `library`, `worker`, `mcp`, `plugin`, `shell`, etc.

Examples:
```bash
git commit -m "fix(viewer): autoplay video smoothly after navigation"
git commit -m "feat(canvas): add hover scrub position preview"
```

### 2.4 Pull Requests and Code Review

For detailed step-by-step instructions, quality gate requirements, and environment setup, see the [Contributing Guide](contributing.en.md).

1. Push your local branch to your fork on GitHub:
   ```bash
   git push origin feature/my-feature-name
   ```
2. Open a Pull Request on GitHub, **ensuring the Base branch is `main`**;
3. This PR changes one feature, rather than submitting several feature changes at once. A corresponding valid issue was opened before this PR;
4. Clearly state the purpose of the change, affected scope, and local test evidence in the PR description;
5. Maintainers review the change and merge it into `main`;
6. Merged contributions are acknowledged in [`CONTRIBUTORS.md`](https://github.com/dolag233/Serpent/blob/main/CONTRIBUTORS.md) in the root directory.

---

## 3. Core Maintainer Workflow (Internal Engineering & Release Discipline)

This section applies to core maintainers and contributors with repository write permissions, outlining ticket tracking and release merging disciplines.

### 3.1 Internal Ticket Tracking (`.beads/`)

The core team tracks daily tasks on `dolag_dev` using lightweight plain-text tickets:

```bash
# View ready tasks
node scripts/ticket.mjs ready --json
# Claim a ticket
node scripts/ticket.mjs claim <issue-id>
# Close a completed ticket
node scripts/ticket.mjs status <issue-id> closed --reason "Resolution description, with commit hash"
```

*Note: Ticket data is stored in `.beads/issues.jsonl` and versioned directly with Git.*

### 3.2 Internal Slices and Design Docs (`docs/internal/`)

Major vertical slice developments maintain technical specifications, development logs, and code review records in `docs/internal/`. Those records stay on `dolag_dev` and do not land on `main`.

### 3.3 Releases and the public branch

Product changes enter `main` through Pull Requests. Do not merge `dolag_dev` into `main` as a whole.

1. **Internal development files stay on `dolag_dev`**:
   - `AGENTS.md`, `CLAUDE.md`, `docs/internal/`, `.beads/`, and CI config under `.github/` do not enter `main`;
   - `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE.md` are the public templates and stay on `main`;
   - `docs/developer/` is public developer and contributor documentation and **must remain on `main`**.
2. **Release packaging runs on `main`**:
   - Maintainers produce the release artifacts from `main` with `npm run release:local`;
   - Run `npm run rebuild:native` afterward to restore the development native module.
