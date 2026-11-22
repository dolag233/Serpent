# Troubleshooting

## macOS Gatekeeper / Windows SmartScreen

Development builds may be unsigned. Verify the package source first, then choose **Open** on macOS or **More info → Run anyway** on Windows. Do not bypass security prompts for an unknown package.

## Linux AppImage will not start or has no video previews

- **Permissions**: run `chmod +x` before launching. The x86_64 file is `Serpent-linux-x86-64-<version>.AppImage`; aarch64 is `Serpent-linux-arm64-<version>.AppImage`.
- **FUSE**: both architectures need `libfuse2`; without FUSE use `./Serpent-….AppImage --appimage-extract-and-run`.
- **Video previews**: The release AppImage already includes `ffmpeg` / `ffprobe` / `oiiotool`. You do not need the distro `ffmpeg` package first. If video previews are still missing, check that `SERPENT_FFMPEG_PATH` does not point at a missing file, then fully quit and relaunch. A source run without the media bundle is the case that needs the distro `ffmpeg` package.
- **3D viewer blank (no GPU)**: set `SERPENT_SOFTWARE_GL=1` before launch.
- **Close quits**: Linux has no system tray; closing the window ends the process (unlike Windows close-to-tray).

## Thumbnails or previews fail

Serpent generates previews for many image, RAW, video, audio, and 3D formats. Confirm that the source is readable and the library directory is writable, then fully quit and reopen the library so background jobs can retry. If the problem continues, open **Window → Background jobs** or **Main Menu → About → View Diagnostic Logs** to check messages and diagnostic logs.

Different formats may use different preview methods; for example, video may use a compatible playback version and audio first gets a waveform. A corrupt or unsupported source cannot be fixed by retrying alone.

A RAW file needs a clear preview generated on first open; seeing its existing thumbnail does not mean that full-resolution generation has finished. ARW brightness matching also depends on a readable embedded preview. See the [viewer guide](basics.en.md#raw-images).

## AI analysis fails or never starts

In **Settings → AI**, verify the API format, model, and key, test the connection, and enable **Analyze new assets automatically** if you want import-time analysis. The switch is off by default; audio, text, and formats outside the image/video/model registry are not supported.

Video AI needs a contact sheet and 3D AI needs a four-view sheet. Retry media generation in Background jobs before retrying AI. Failure notices include a short reason. Network, rate-limit, and timeout failures are usually retryable; authentication, permission, quota, and unsupported-format errors need a configuration or file fix. To re-analyze an asset that already has AI content, use **AI analysis**, not **Analyze unanalyzed assets**.

## Searches miss imported assets

Check active filter chips; Shift-selected values can intentionally narrow the result. Search remains within the current folder/collection scope, and hovering or focusing the `?` beside the field shows advanced syntax. Ignore rules affect browsing, search, and scanning; inspect **Library settings → Ignore rules**.

If the field reports a syntax error, the last valid results remain visible. Close any unfinished quotes or parentheses and fill missing conditions before the results update. In search, `tag:` matches part of a name and `tag=` matches a whole tag; bare names in a tag condition match whole tags by default. See [Search and filters](search-and-filters.en.md) for examples.

## A plugin will not enable

Open **Settings → Plugins** and check the plugin status and trust prompt. A library plugin needs trust on each device; a user-wide package is normally trusted automatically. Turn the plugin off and on again, or click **Reload**. If it still does not work, contact the plugin author with your Serpent version, operating system, and plugin name.

## Automation script or MCP will not work

For a script, open a library first and choose **More tools → Automation scripts**. For MCP, open **Settings → MCP**, ensure the service is enabled and started, and paste Serpent’s latest configuration into the client. The default address is `http://127.0.0.1:47342/mcp`. If you revoked a Token, add the client again and copy a new configuration. Connect only a local AI tool you trust.

## A library will not open

- **Unexpected interruption while running**: If the library's background process exits unexpectedly, Serpent tries to restart it and reopen the libraries that were open. Wait for recovery; if it fails or keeps happening, fully quit and reopen the app and check diagnostic logs. Check the outcome of an interrupted operation before retrying it.
- **Version compatibility**: Serpent maintains forward data compatibility. Opening an older library with a newer version will automatically run database migrations. Older app versions opening a library created by a newer version will also open it in writable mode permissively, rather than locking it into a read-only state. If prompted that the version is unsupported, update to the latest Serpent release.
- **"Library is already open" prompt**: The same library directory is already open in the current app instance, or was opened via different paths (e.g. network share path vs. mapped drive). Switch directly to the existing window.
- **Automatic recovery and rescue**: If you see a database corruption prompt, do not manually delete the `.serpent/` directory. Serpent includes rotating backup mechanisms and will automatically attempt to restore from the latest valid backup. In extreme corruption scenarios, it enters an automatic asset rescue workflow in the `Assets/` directory, preserving as many source files and metadata as possible.
- **Permissions and disk space**: Ensure the drive containing the library and temporary folders has sufficient read/write permissions and available storage.
- **Importing from archives**: When importing from ZIP / Eagle / Billfish, ensure the system temp folder and destination disk have adequate space for extraction and storage. Thumbnails and metadata will rebuild progressively in the background after extraction.

## Shortcuts do nothing

Shortcut handling follows focus and modal priority. Settings, the viewer, and menus take priority for keys such as `Esc`; close them and focus the canvas before retrying. If F2 does not work after a context menu closes, click the asset or folder to restore focus.

## Still stuck

You can view the current logs from **Main Menu → About → View Diagnostic Logs** (or click "Show Log File" in that dialog, or use **Main Menu → About → Show Log File in File Manager** to locate the file).

When reporting issues via GitHub Issues, please include: OS and version, Serpent version, library type, reproduction steps, error messages/codes, and sanitized diagnostic logs. Never attach an API key, full token, or unsanitized personal file paths.
