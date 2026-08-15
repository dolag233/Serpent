# Developer Docs

Developer documentation is split into two parts.

## Part 1: Software development

For developers working on Serpent itself: architecture, building from source, testing.

- [Setup](setup.en.md) — dependencies, first build, development environment
- [Build & packaging](build-packaging.en.md) — package / make / release pipeline / signing
- [Architecture](architecture.en.md) — process model, directory layout, key design
- [Testing](testing.en.md) — test layers and how to run them
- [Branches and workflow](workflow.en.md) — `main`/`dev`, Beads tickets, development records, acceptance, and handoff

Other software docs:

- [Development process](../internal/development-process.md) — slice workflow and quality gates
- [Domain model](../internal/domain-model.md) / [Glossary](../glossary.md)
- [Architecture decision records](../internal/adr/) — ADR-0000 onward
- [Implementation specs](../internal/implementation/) — slice specs

## Part 2: Extension development

For developers writing plugins, scripts or MCP adapters. **No software-architecture knowledge required** — go straight to the [extension author manual](../manual/README.md):

- [Plugin development guide](../manual/plugins/development.md) + [best practices](../manual/plugins/best-practices.md) + [API reference](../manual/plugins/api-reference.md)
- [Plugin distribution and updates](../manual/plugins/distribution-and-updates.md)
- Reference implementation: [Serpent-Plugin-ImageUpscaler](https://github.com/dolag233/Serpent-Plugin-ImageUpscaler)
- [Script development guide](../manual/scripts/development.md) + [API reference](../manual/scripts/api-reference.md)
- [MCP development guide](../manual/mcp/development.md) + [API reference](../manual/mcp/api-reference.md)

End users: see [Using plugins](../user-guide/plugins.en.md) and [Automation](../user-guide/automation.en.md).
