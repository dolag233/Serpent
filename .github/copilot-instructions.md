# Serpent Copilot instructions

Treat `AGENTS.md` as the canonical repository instruction file. Before changing code, read `docs/product-brief.md`, `docs/internal/development-process.md`, `docs/internal/domain-model.md`, `docs/internal/project-status.md`, and `docs/internal/qa/human-acceptance-checklist.md`.

Browsing, thumbnail decode, embedded viewing, import, search, deletion, and restart persistence are core user journeys. Their tests must cross the real Electron process boundaries. An image test must prove `complete && naturalWidth > 0`; a video test must reach metadata with non-zero dimensions. Closing a window is not a full restart test. Library availability is the hardest baseline: any library-related change must fully run `npm run test:library-availability`. After shared-tree or multi-agent work, run `npm run verify:mainline` on the merged state.

Do not leave product decisions, incident lessons, or QA gates only in chat or tool-specific memory; update the tracked repository documents.

Whenever a user-operable feature increment becomes ready, update `docs/internal/qa/human-acceptance-checklist.md` in the same commit and report its acceptance ID and steps. Automated tests and agent QA may move an item to “待人类验收”, but only the user can mark it “人类验收通过”.
