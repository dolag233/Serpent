# Basics

## Create, open, and configure a library

On first launch choose **Create library**, pick a location, and enter a display name. A library contains managed assets, its database, and a `.serpent/` working directory. The display name does not move the library directory.

Use the upper-left **Main menu → Library** to create, open, import, or export libraries. **Library settings** lets you rename the current library, see its location, and edit its ignore configuration. A description field is not implemented yet.

The ignore editor uses one rule per line, similar to `.gitignore`; the UI calls it an “ignore configuration file”. Saving immediately affects browsing, search, and scanning:

```text
*.tmp                 # ignore every .tmp file
references/drafts/    # ignore this folder
!references/drafts/keep.png  # un-ignore one file
```

The `?` help explains `*`, `?`, `**`, a trailing `/` for directories, a leading `/` for library-root rules, and `!` negation.

### Open external libraries (Eagle / Billfish)

**Open library** → **Open external library…** → choose **Eagle** or **Billfish**:

1. Pick the source library (an Eagle/Billfish library folder or its archive);
2. choose where Serpent should create the local library;
3. Serpent converts the source and creates a local library at the destination (a large Eagle library can take several minutes on first conversion).

After conversion, browsing, search, tags, AI analysis, and everything else work exactly like a local library, and the original files are left untouched.

![Open external library](../assets/ui/open-external-library.png)

## Import assets

Drop one or more files or folders into Serpent, or use **Import files** / **Import folder**. Folder imports are recursive. The browser extension can save web images and videos from the context menu or by drag-and-drop.

The current product registry includes:

- Images: PNG, JPG/JPEG, GIF, TIFF/TIF, WebP, SVG, BMP, ICO, PSD, EXR, TGA
- Camera RAW: DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2
- Video: MP4, MOV, AVI, WMV, WebM, MKV, M4V
- Audio: WAV, MP3, OGG/OGA, M4A, AAC, FLAC, Opus (waveform cover plus playback)
- 3D: FBX, OBJ, GLTF, GLB, STL (FBX is converted to a viewable GLB)
- Text: TXT, Markdown, JSON, CSV, XML, YAML, and common source/config formats

Serpent copies managed files into the library and assigns a stable asset ID. Name or content duplicates open a conflict dialog. Thumbnails, technical metadata, and eligible AI analysis are generated in the background, so you can keep browsing immediately.

## Browse and organize

- Sidebar: All assets, Trash, folders, collections, and smart collections. Folders and collections can include descendants; a collection is a many-to-many relationship, so an asset may belong to several collections.
- Canvas: tile, masonry, and folder/collection cards. Resizing sidebars or card size reflows the layout while preserving the approximate scroll position.
- Toolbar: search, filters, sorting, view, and card fields. In non-grid pages, irrelevant view controls are hidden.
- Inspector: file information, tags, rating, favorite, description, source URL, author, technical metadata, color space, and AI content.

Click to select and double-click to open the viewer. Drag on empty canvas space to marquee-select; use `⌘` on macOS or `Ctrl` on Windows while clicking to add to a selection. `Tab` moves focus between assets; `Shift` enables range selection where supported. Folders, collections, and smart collections support context-menu actions, inline `F2` rename, and `Delete`; deleting a non-empty container confirms first, and deleting a collection never deletes its assets.

![Library, Inspector, filters, and AI overview](../assets/ui/Serpent-Preview.png)

## Viewer

Double-click an asset to open the viewer. Images, SVG, RAW, PSD, TIFF, TGA, and EXR use their decoder or a generated derivative; SVG is rendered from its vector source in the viewer, not treated as the thumbnail. Videos loop by default and may use a Serpent-generated compatible proxy. Audio shows a waveform and playback controls. 3D models use the dedicated model viewer.

The viewer supports pan, wheel zoom, fit-to-view (numpad `.`), fullscreen, and rotate/horizontal/vertical mirror transforms for images and video. For formats other than PNG/JPEG, Serpent uses a detected color space when available and lets you choose among supported spaces. EXR can expose multiple planes/parts when present; this is not a professional channel-grading tool.

![3D viewer and Inspector](../assets/ui/3D-inspector.png)

## Tags, collections, and smart collections

- Add tags from the Inspector or an asset context menu. The tag picker supports search, recent tags, and batch operations.
- Collections are manually maintained relationships. Drag assets into a collection or use the **Add to collection** submenu; removing an asset from a collection only removes the relationship.
- Smart collections save a search, filter, and sort definition and calculate results live.

## Trash and deletion

Normal `Delete` / macOS `⌘⌫` moves an asset or folder to Trash. Windows `Shift+Delete` and macOS `⌥⌘Delete` delete from disk after a confirmation. The undo icon in the notification can reverse the most recent undoable file operation and refreshes the current view.

## WebDAV cloud sync

Serpent can sync a library across machines over WebDAV: configure servers globally, bind each library, set auto-sync and the poll interval, and open remote synced libraries. See [Sync and external libraries](sync.en.md).

## Shortcuts

| Action | macOS | Windows |
| --- | --- | --- |
| Open viewer | Enter | Enter |
| Open in external app | ⌘O | Ctrl+O |
| Reveal in file manager | ⌘⇧S | Ctrl+Shift+S |
| Focus search | ⌘F | Ctrl+F |
| Rename | F2 | F2 |
| Move to Trash | ⌘⌫ | Delete |
| Delete from disk | ⌥⌘Delete | Shift+Delete |
| Copy / Paste | ⌘C / ⌘V | Ctrl+C / Ctrl+V |
| Fit viewer | Numpad `.` | Numpad `.` |

See [Search and filters](search-and-filters.en.md) for query examples and [AI analysis](ai.en.md) for AI setup and jobs.
