# Developer Docs

For people who want to build Serpent locally or become contributors: setup, architecture, testing, packaging, and how to participate. These pages ship on `main`. They are not the slice logs or internal specs in `docs/internal/`.

Developer documentation is split into two parts.

## Part 1: Software development

For developers working on Serpent itself: architecture, building from source, testing.

- [Setup](setup.md) — dependencies, first build, development environment
- [Build & packaging](build-packaging.md) — package / make / release pipeline / signing
- [Architecture](architecture.md) — process model, directory layout, key design
- [Testing](testing.md) — test layers and how to run them
- [Adding media format support](media-format-support.md) — registry, import, preview, filters, protocols, and acceptance
- [Branches and workflow](workflow.md) — `main`/`dev`, external contributions, Beads tickets, development records, acceptance, and handoff
- [Contributors](../../CONTRIBUTORS.md) — contributions accepted and merged into the project

Other software docs (internal records live on the repo `dev` branch and are not published to the site):

- [Development process](https://github.com/dolag233/Serpent/blob/dev/docs/internal/development-process.md) — slice workflow and quality gates
- [Domain model](https://github.com/dolag233/Serpent/blob/dev/docs/internal/domain-model.md) / [Glossary](../glossary.md)
- [Architecture decision records](https://github.com/dolag233/Serpent/tree/dev/docs/internal/adr) — ADR-0000 onward
- [Implementation specs](https://github.com/dolag233/Serpent/tree/dev/docs/internal/implementation) — slice specs

## Part 2: Extension development

For developers writing plugins, scripts or MCP adapters. **No software-architecture knowledge required** — go straight to the [extension author manual](../manual/README.md):

- [Plugin development guide](../manual/plugins/development.md) + [best practices](../manual/plugins/best-practices.md) + [API reference](../manual/plugins/api-reference.md)
- [Plugin distribution and updates](../manual/plugins/distribution-and-updates.md)
- Reference implementation: [Serpent-Plugin-ImageUpscaler](https://github.com/dolag233/Serpent-Plugin-ImageUpscaler)
- [Script development guide](../manual/scripts/development.md) + [API reference](../manual/scripts/api-reference.md)
- [MCP development guide](../manual/mcp/development.md) + [API reference](../manual/mcp/api-reference.md)

End users: see [Using plugins](../user-guide/plugins.md), [Browser extension](../user-guide/browser-extension.md), and [Automation](../user-guide/automation.md).
