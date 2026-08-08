# Troubleshooting

## macOS "cannot verify the developer"

Normal for an unsigned build. Right-click the app → Open (first time only).

```bash
xattr -cr /Applications/Serpent.app
```

## Windows SmartScreen warning

Normal for an unsigned build. Choose "More info → Run anyway".

## Videos show no preview / thumbnail

Video processing needs FFmpeg. It ships with the app; if you see `FFMPEG_REQUIRED`:

1. Make sure you installed the full package (not a trimmed copy)
2. Quit the app completely and reopen it — Serpent retries failed preview jobs automatically

## FBX models fail to convert

FBX conversion needs the ufbx component. If you see "conversion component unavailable", reinstall the app to restore it (the component ships with the package). OBJ/GLB/STL do not need it.

## Images show as broken after import

Usually a failed thumbnail generation. Reopening the library regenerates failed thumbnails automatically.

## A library will not open

- "Read-only": the library was created by a newer Serpent build, or a migration failed repeatedly. Upgrade to the latest Serpent and retry
- "Corrupt": the database or migration history is damaged. Keep the directory, contact the developers and include the `.serpent/` folder

## Searches miss imported assets

Check that no format/size/tag filter is active and that the query uses valid syntax (click `?` for help).

## Shortcuts do nothing

Some shortcuts only apply while the canvas has focus (e.g. not while the sidebar is focused). Click the canvas and retry. F2 rename can lose focus after a context menu closes — click the asset again.

## Still stuck

Report it (GitHub Issues) with:

- OS and version
- Serpent version (see Settings)
- Steps to reproduce
- Logs from the `.serpent/` directory, if present
