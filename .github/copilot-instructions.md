# Serpent Copilot instructions

Treat `AGENTS.md` as the canonical repository instruction file. Before changing code, read `docs/product-brief.md`, `docs/development-process.md`, `docs/domain-model.md`, and `docs/project-status.md`.

Browsing, thumbnail decode, embedded viewing, import, search, deletion, and restart persistence are core user journeys. Their tests must cross the real Electron process boundaries. An image test must prove `complete && naturalWidth > 0`; a video test must reach metadata with non-zero dimensions. Closing a window is not a full restart test. After shared-tree or multi-agent work, run `npm run verify:mainline` on the merged state.

Do not leave product decisions, incident lessons, or QA gates only in chat or tool-specific memory; update the tracked repository documents.
