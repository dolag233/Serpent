# UI direction 0001: Studio Contact Sheet

> Status: active visual direction
> Reference: `docs/internal/前端参考/Eagle前端参考.png`
> Date: 2026-07-12

## Intent

Serpent targets designers, game artists, and film/post-production users. UI quality is a product requirement, not decoration applied after functionality. The first slice establishes a real professional desktop workspace so later asset features grow inside a coherent frame.

The direction is **Studio Contact Sheet**: a compact editorial-production tool with neutral graphite surfaces, precise hairline separators, crisp geometry, and one restrained teal accent. Artwork remains the dominant source of color.

## Reference lessons

Adopt from Eagle:

- Persistent three-pane desktop structure: navigation, flexible asset canvas, contextual inspector.
- High information density with compact rows, clear counts, direct manipulation, and a large central media area.
- Strong selection that remains visible over colorful artwork.
- One central grid shared by folders, collections, smart collections, search, and filtered scopes.
- Selection-driven inspector with preview, organizational metadata, and technical metadata.

Improve rather than copy:

- Use explicit sidebar sections for folders, collections, smart collections, tags, and linked folders.
- Reduce unlabeled toolbar icons and group actions by purpose.
- Present inspector metadata as readable information first, editable fields second.
- Do not copy Eagle's exact widths, blue accent, iconography, control positions, or field styling.
- Avoid dashboard cards, oversized welcome typography, glass effects, generic purple gradients, and permanent progress chrome.

## Shell anatomy

```text
┌─────────────────────────────────────────────────────────────────┐
│ app/library controls │ scope trace + toolbar │ search/utilities │
├──────────────────────┼───────────────────────┼──────────────────┤
│ navigation           │ workspace             │ inspector        │
│  system views        │  contact sheet /      │  selection or    │
│  folders             │  empty/create/open    │  library detail  │
│  collections         │  states               │                  │
│  smart collections   │                       │                  │
│  tags / linked       │                       │                  │
└──────────────────────┴───────────────────────┴──────────────────┘
```

The first slice keeps this shell visible even when no library is open. Create and Open actions appear inside the central workspace rather than as a marketing landing page.

## Visual tokens

```text
canvas          #252729
side panes      #2C2E31
raised / hover  #35383B
divider         #44474A
text primary    #F1F2EF
text secondary  #A9ADA9
accent          #42B8A4
warning         #D99A3E
```

- Base spacing: 4px.
- Navigation rows: 28–32px.
- Toolbar: 44px.
- Pane gutters: 12px.
- Future thumbnail gaps: 12–16px.
- Radius: 4–6px; prefer outlines and luminance steps over large shadows.
- Body type: 13px; metadata: 12px; micro-labels: 11px; scope titles: 15–16px.
- Use a packaged open CJK UI face and a mono companion for paths, dimensions, duration, counts, and IDs.

## Serpent signature

The workspace header uses a thin **scope trace**: breadcrumb plus active scope/filter segments rendered as precise compact chips. Focus and selection use a restrained teal edge treatment, like a selection loupe rather than a bright fill.

No literal snake motifs are required.

## Slice 0001 states

### No library

- Full application shell remains visible.
- Central workspace contains a compact product explanation.
- Create Library is primary; Open Library is secondary.
- Navigation and inspector show honest inactive states, not fake sample assets.

### Library open

- Workspace shows library name, location, status, and a Close action.
- Future folder and asset regions use restrained placeholders or disabled affordances.
- Inspector shows library identity and path until asset selection exists.

### Errors

- Recoverable create/open failures appear inline with Retry or Choose Another Location.
- Destructive or irreversible choices use dialogs.
- Error styling preserves the neutral workspace and uses warning color sparingly.

## Visual acceptance

- The screen reads as a desktop creative tool at first glance, not a webpage or admin dashboard.
- Media/workspace area remains visually dominant over navigation and forms.
- Text hierarchy remains legible at compact density and keyboard focus is always visible.
- Sidebar, central workspace, and inspector are structurally clear at the initial target window size.
- Empty, loading, success, and error states feel like one system.
- Screenshot comparison is used for layout and regression review; Eagle is a reference, never a pixel-copy target.
