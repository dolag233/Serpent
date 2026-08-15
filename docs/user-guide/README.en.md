# User Guide

A Serpent usage guide for end users. Chinese version: [README.md](README.md)

- [Install](installation.en.md) — macOS / Windows, browser extension, upgrades
- [Basics](basics.en.md) — libraries, importing, browsing, organization, file actions, and the viewer
- [Search and filters](search-and-filters.en.md) — advanced query syntax, filter dimensions, and Shift multi-select
- [AI analysis](ai.en.md) — supported assets, automatic/manual analysis, jobs, and privacy
- [Plugin features](plugins.en.md) — install, enable, update, and uninstall plugins, plus the browser extension
- [Automation](automation.en.md) — automation scripts and MCP client connections
- [Troubleshooting](troubleshooting.en.md) — common problems and fixes

## Quick start

1. Install Serpent (see [Install](installation.en.md))
2. Launch the app and create a local library
3. Drag images, videos, audio, 3D models, or text into the window, or click Import
4. Assets appear on the canvas. Double-click to open the viewer; right-click for more actions. Thumbnails, metadata, and AI analysis complete progressively in the background

All data stays in your local library directory — no cloud sync.

## Interface at a glance

A typical workspace has library navigation on the left, the asset canvas in the center, and the Inspector on the right. On Windows, the upper-left Main menu contains File, Edit, Window, Library, and Settings; macOS also exposes the same commands in the native menu. Import, search, filtering, and sorting stay in the top toolbar.

![Serpent library overview](../assets/ui/Serpent-Preview.png)

See [Basics](basics.en.md) for the complete workflow.

```mermaid
flowchart LR
    A[Create library] --> B[Import files or folders]
    B --> C[Browse masonry canvas]
    C --> D{Organize}
    D --> E[Tags and collections]
    D --> F[Folders and metadata]
    C --> G[Search and filter]
    C --> H[Open viewer]
    H --> I[Inspect or edit metadata]
    C --> J[Trash and restore]
    C --> K[AI analysis]
```

## Documentation status

This directory describes the current user-facing product. Screens and available features can change between releases; follow the latest installer and release notes.
