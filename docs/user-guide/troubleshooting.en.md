# Troubleshooting

## macOS Gatekeeper / Windows SmartScreen

Development builds may be unsigned. Verify the package source first, then choose **Open** on macOS or **More info → Run anyway** on Windows. Do not bypass security prompts for an unknown package.

## Thumbnails or previews fail

Serpent generates derived previews for many image, RAW, video, audio, and 3D formats. Confirm that the source is readable and the library directory is writable, then fully quit and reopen the library so background jobs can retry. Video needs the bundled FFmpeg; FBX also needs the ufbx conversion component. Open **Window → Background jobs** and diagnostics for a typed error.

Some limits are intentional: video playback may use a compatible proxy; SVG is rendered from its source in the viewer; EXR/PSD/RAW use OIIO; audio first gets a waveform. A corrupt or unsupported source cannot be fixed by retrying alone.

## AI analysis fails or never starts

In **Settings → AI**, verify the API format, model, and key, test the connection, and enable **Analyze new assets automatically** if you want import-time analysis. The switch is off by default; audio, text, and formats outside the image/video/model registry are not supported.

Video AI needs a contact sheet and 3D AI needs a four-view sheet. Retry media generation in Background jobs before retrying AI. Failure notices include a short reason. Network, rate-limit, and timeout failures are usually retryable; authentication, permission, quota, and unsupported-format errors need a configuration or file fix. To re-analyze an asset that already has AI content, use **AI analysis**, not **Analyze unanalyzed assets**.

## Searches miss imported assets

Check active filter chips; Shift-selected values can intentionally narrow the result. Search remains within the current folder/collection scope, and hovering or focusing the `?` beside the field shows advanced syntax. Ignore rules affect browsing, search, and scanning; inspect **Library settings → Ignore rules**.

## A plugin will not enable

Open **Settings → Plugins** and inspect its package status, permissions, and trust prompt. A library plugin needs trust on each device; a user-wide package is normally trusted automatically. Safe Mode pauses unrestricted plugins. A changed permission or source needs confirmation again. Verify that a local ZIP contains `serpent-plugin.json` and a built entry, with no traversal or symlink entries.

## MCP will not connect

In **Settings → MCP**, ensure the service is enabled and started. The default endpoint is `http://127.0.0.1:47342/mcp`. Stop the service before changing the port. Creating a new configuration creates a new credential; the old token is not shown again. Library-scoped calls need an explicit `libraryId`. MCP does not use stdio, an npm launcher, or a public address; after revoking a credential, copy a new configuration.

## A library will not open

- “Read-only” can mean the library was created by a newer build, the directory is not writable, or a migration is still in progress. Back up the directory and retry with the current build.
- For “corrupt”, keep the original directory and include `.serpent/` plus logs when contacting the developers.
- For ZIP imports, ensure both the temporary extraction location and destination are writable. Thumbnails, proxies, and AI temporary artifacts are rebuilt in the background.

## Shortcuts do nothing

Shortcut handling follows focus and modal priority. Settings, the viewer, and menus take priority for keys such as `Esc`; close them and focus the canvas before retrying. If F2 does not work after a context menu closes, click the asset or folder to restore focus.

## Still stuck

Open a GitHub Issue with your OS/version, Serpent version, library type, reproducible steps, error text/code, and relevant `.serpent/` logs. Never attach an API key, full token, or unsanitized personal paths.
