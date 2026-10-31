# Contributing to Serpent

Thank you for your interest in contributing to Serpent!

Serpent is an open-source (MIT licensed), cross-platform digital asset management desktop application. Whether you are contributing code, documentation, automated tests, translations, UI/UX improvements, or bug reports, your contributions help make the project better.

This document describes how to participate in the project's development and community collaboration. For more detailed technical architecture and local build instructions, see the [Developer Documentation](README.en.md).

---

## 1. Code of Conduct and Core Principles

To maintain a welcoming, inclusive, and productive open-source collaboration environment, all participants (including contributors and maintainers) adhere to the following principles:

- **Friendly and respectful**: Maintain a professional, neutral, and constructive communication tone in issue discussions, code reviews, and pull request threads.
- **Focus on the problem**: Discuss technical designs, code implementations, or user experience directly without personal attacks or unconstructive arguments.
- **Privacy and data protection**: When reporting issues, submitting test fixtures, or attaching diagnostic logs, **never expose** local absolute paths, private personal files, passwords/tokens, or unsanitized personal data.

---

## 2. Reporting Issues

If you encounter unexpected errors, performance bottlenecks, or bugs while running or using Serpent, please file an issue on [GitHub Issues](https://github.com/dolag233/Serpent/issues).

### When reporting a bug, please provide:

1. **Environment**: Operating system (macOS / Windows / Linux) and version, system architecture (`arm64` / `x64`).
2. **Application version**: Serpent version string or Git commit hash.
3. **Reproduction steps**: Clear, step-by-step instructions so maintainers can reproduce the behavior locally.
4. **Expected vs. actual behavior**: What you expected to happen versus what actually occurred.
5. **Error output and logs**: Relevant error prompts, console stack traces, or sanitized diagnostic logs (via **Main Menu → About → View Diagnostic Logs**).

---

## 3. Contribution Workflow

### 3.1 Branching Strategy

- **`main`**: The latest branch. Product code, tests, and public documentation live here. **Every Pull Request merges into `main`**.
- **`dolag_dev`**: The maintainer's working branch. External contributions do not merge here.

### 3.2 Step-by-Step Guide

1. **Fork the repository**: Click Fork on GitHub to copy [dolag233/Serpent](https://github.com/dolag233/Serpent) to your personal account.
2. **Clone locally**:
   ```bash
   git clone https://github.com/<your-username>/Serpent.git
   cd Serpent
   ```
   *Note: Clone to a local APFS or NTFS disk; do not develop directly on network shares or SMB/NAS mounts.*
3. **Configure the development environment**:
   - Node.js version requirement is **`24.15.0`** (using `nvm`: `nvm use`).
   - On Windows, Visual Studio Build Tools is required (with the Desktop development with C++ workload and Windows SDK, to compile `better-sqlite3`). To build Windows installer packages (`npm run make:inno`), Inno Setup 6 is also required (see [Setup](setup.en.md)).
   - On macOS, Xcode Command Line Tools is required.
   - On Linux, install `build-essential` / `python3`. `npm start` also needs system `ffmpeg` until the media bundle is acquired (see [Setup](setup.en.md)). The release AppImage packs in the pinned media tools. Docker is recommended for AppImage release builds.
   - Install dependencies and compile native modules:
     ```bash
     npm ci --registry=https://registry.npmjs.org
     npm run rebuild:native
     ```
4. **Create a branch from `main`**:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/your-feature-name
   # Or for bug fixes:
   git checkout -b fix/your-bugfix-name
   ```
5. **Local verification gates**:
   Before committing, ensure your changes pass all local verification gates:
   ```bash
   npm run typecheck    # Static TypeScript type check
   npm run lint         # ESLint style and quality check
   npm run test:unit    # Unit tests
   ```
   If your changes touch library creation, opening, closing, migration, or filesystem operations, run the availability suite:
   ```bash
   npm run test:library-availability
   ```
6. **Commit message conventions (Conventional Commits)**:
   Format commit messages using standard conventions:
   ```text
   <type>(<scope>): <short description>
   ```
   - Common types: `feat` (new feature), `fix` (bug fix), `docs` (documentation), `test` (tests), `refactor` (refactoring), `chore` (build/tooling).
   - Example: `fix(viewer): autoplay video smoothly after navigation`.
7. **Submit a Pull Request**:
   - Push your branch to your GitHub fork: `git push origin feature/your-feature-name`.
   - Open a Pull Request on GitHub, **ensuring the base branch is set to `main`**.
   - Clearly explain the motivation, impact scope, and test evidence in the PR description.

### 3.3 Pull Request rules

- This PR changes one feature, rather than submitting several feature changes at once.
- A corresponding valid issue was opened before this PR. Put the issue number in the description.
- The repository pull request template asks you to confirm both rules, plus local verification, test coverage, and that the change contains no machine paths or credentials.

---

## 4. Architectural and Design Constraints

When writing code, keep Serpent's core architectural constraints in mind:

1. **Process model invariants**:
   - `Renderer` runs in a sandboxed environment with no direct Node.js, filesystem, or SQL access.
   - `Library Worker` (`UtilityProcess`) is the single owner of the SQLite database and on-disk library files.
   - All inter-process communication flows through strongly-typed, schema-validated IPC protocols.
2. **Data compatibility discipline**:
   - Database migrations only add columns, tables, or indexes; never drop or rename existing tables and columns.
   - Libraries are never locked into a read-only state. New versions must smoothly open existing data, and corrupted states trigger automated backup and asset recovery.
3. **Workspace cleanliness and privacy**:
   - Temporary extraction and conversion files must be cleaned up within the same task lifecycle.
   - Source code, test fixtures, and documentation must never contain local absolute disk paths, usernames, or testing credentials.

---

## 5. Acknowledgments

All merged contributions are credited in [`CONTRIBUTORS.md`](https://github.com/dolag233/Serpent/blob/main/CONTRIBUTORS.md) in the root directory.

Thank you for contributing to Serpent!
