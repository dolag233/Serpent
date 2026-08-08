# Developer Docs

Developer documentation is split into two parts.

## Part 1: Software development

For developers working on Serpent itself: architecture, building from source, testing.

- [Setup](setup.en.md) — dependencies, first build, development environment
- [Build & packaging](build-packaging.en.md) — package / make / release pipeline / signing
- [Architecture](architecture.en.md) — process model, directory layout, key design
- [Testing](testing.en.md) — test layers and how to run them

Other software docs:

- [Development process](../development-process.md) — slice workflow and quality gates
- [Domain model](../domain-model.md) / [Glossary](../glossary.md)
- [Architecture decision records](../adr/) — ADR-0001 onward
- [Implementation specs](../implementation/) — slice specs

## Part 2: Extension development

For developers writing plugins, scripts or MCP adapters. **No software-architecture knowledge required** — go straight to the [extension author manual](../manual/README.md):

- [Plugin development guide](../manual/plugins/development.md) + [API reference](../manual/plugins/api-reference.md)
- [Script development guide](../manual/scripts/development.md) + [API reference](../manual/scripts/api-reference.md)
- [MCP development guide](../manual/mcp/development.md) + [API reference](../manual/mcp/api-reference.md)

End users: see [User guide: Plugins, scripts and MCP](../user-guide/extensions.en.md).
