# Troubleshooting

## macOS Gatekeeper / Windows SmartScreen

Development builds may be unsigned. Verify the package source first, then choose **Open** on macOS or **More info → Run anyway** on Windows. Do not bypass security prompts for an unknown package.

## Thumbnails or previews fail

Serpent generates previews for many image, RAW, video, audio, and 3D formats. Confirm that the source is readable and the library directory is writable, then fully quit and reopen the library so background jobs can retry. If the problem continues, open **Window → Background jobs** and diagnostics for the message.

Different formats may use different preview methods; for example, video may use a compatible playback version and audio first gets a waveform. A corrupt or unsupported source cannot be fixed by retrying alone.

## AI analysis fails or never starts

In **Settings → AI**, verify the API format, model, and key, test the connection, and enable **Analyze new assets automatically** if you want import-time analysis. The switch is off by default; audio, text, and formats outside the image/video/model registry are not supported.

Video AI needs a contact sheet and 3D AI needs a four-view sheet. Retry media generation in Background jobs before retrying AI. Failure notices include a short reason. Network, rate-limit, and timeout failures are usually retryable; authentication, permission, quota, and unsupported-format errors need a configuration or file fix. To re-analyze an asset that already has AI content, use **AI analysis**, not **Analyze unanalyzed assets**.

## Searches miss imported assets

Check active filter chips; Shift-selected values can intentionally narrow the result. Search remains within the current folder/collection scope, and hovering or focusing the `?` beside the field shows advanced syntax. Ignore rules affect browsing, search, and scanning; inspect **Library settings → Ignore rules**.

## A plugin will not enable

Open **Settings → Plugins** and check the plugin status and trust prompt. A library plugin needs trust on each device; a user-wide package is normally trusted automatically. Turn the plugin off and on again, or click **Reload**. If it still does not work, contact the plugin author with your Serpent version, operating system, and plugin name.

## Automation script or MCP will not work

For a script, open a library first and choose **More tools → Automation scripts**. For MCP, open **Settings → MCP**, ensure the service is enabled and started, and paste Serpent’s latest configuration into the client. The default address is `http://127.0.0.1:47342/mcp`. If you revoked a Token, add the client again and copy a new configuration. Connect only a local AI tool you trust.

## A library will not open

- “Read-only” can mean the library was created by a newer build, the directory is not writable, or a migration is still in progress. Back up the directory and retry with the current build.
- For “corrupt”, keep the original directory and include `.serpent/` plus logs when contacting the developers.
- For ZIP imports, ensure both the temporary extraction location and destination are writable. Thumbnails, proxies, and AI temporary artifacts are rebuilt in the background.

## Shortcuts do nothing

Shortcut handling follows focus and modal priority. Settings, the viewer, and menus take priority for keys such as `Esc`; close them and focus the canvas before retrying. If F2 does not work after a context menu closes, click the asset or folder to restore focus.

## Still stuck

Open a GitHub Issue with your OS/version, Serpent version, library type, reproducible steps, error text/code, and relevant `.serpent/` logs. Never attach an API key, full token, or unsanitized personal paths.
