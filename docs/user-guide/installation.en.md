# Installation

## Requirements

- macOS: Apple Silicon (arm64) or Intel (x64), macOS 11 or newer
- Windows: 64-bit Windows 10 or Windows 11
- The app uses about 500 MB; library data needs additional space

Windows packaging and installation evidence can vary by release. See [build and packaging](../developer/build-packaging.en.md) and [project status](../internal/project-status.md).

## macOS

1. Download the matching `Serpent-<version>-arm64.dmg` or x64 package.
2. Open the DMG and drag Serpent to Applications.

Unsigned development builds may trigger Gatekeeper. Verify the source, then right-click the app, choose Open, and confirm. If it is still blocked, clear quarantine from Terminal:

```bash
xattr -cr /Applications/Serpent.app
```

To uninstall, move the app to the Trash. Libraries live where you created them and are not removed with the app.

## Windows

1. Download `Serpent-<version> Setup.exe` or the Windows package attached to the release.
2. Run the installer and follow the prompts.

Unsigned development builds may trigger SmartScreen. Verify the source, then choose **More info → Run anyway**. Uninstall from **Settings → Apps**. Installer, update, and full-quit behavior are release-specific and must follow the current QA evidence.

## Browser extension

The extension ships with the source/package rather than through a store. For a development checkout, open `chrome://extensions` in Chrome or Edge, enable Developer mode, choose **Load unpacked**, and select:

- macOS: `Serpent.app/Contents/Resources/extension`
- Windows: `resources/extension` inside the install directory

The extension can save a web image or video from its context menu or by drag-and-drop. See [Plugins, scripts, and MCP](extensions.en.md) for extension behavior.

## Upgrading

Replace the macOS app with the new DMG, or run the new Windows installer over the existing install. Libraries and user configuration live outside the application install directory and normally remain; back up a library before upgrading. For migrations and release-specific caveats, use project status and release notes.
