# Serpent

Serpent is an open-source, cross-platform digital asset manager for game artists, film and post-production teams, and designers.

The current foundation provides a secure Electron shell and a portable local-library lifecycle. Asset ingestion and browsing are the next active vertical slice.

## Development

Serpent requires Node.js 24 and npm.

```bash
npm ci
npm start
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:worker
npm run package
npm run verify:package
```

Electron lifecycle tests use a production bundle and platform-local staging paths. See `docs/development-process.md` and the current QA report in workspaces that include the separately managed `docs/` directory.

## License

MIT
