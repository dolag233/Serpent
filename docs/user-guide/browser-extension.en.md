# Browser extension

Save web images or videos into a Serpent library with **context-menu saving** and **drag-and-drop saving**. Supports Chrome / Edge (Chromium) and Firefox.

Media is downloaded by the **browser** (with cookies and the page Referer) and uploaded to the local Serpent app, bypassing most hotlink protections. Keep Serpent running with a library open — the extension connects to `127.0.0.1` only; there is no remote server.

## Installation

> The extension is not on a browser store yet; install it manually. All install files are downloaded from the [extension releases page](https://github.com/dolag233/Serpent-Extension/releases/latest) — pick the file for your browser.

### Chrome / Edge

1. Download `serpent-extension-<version>.zip` from the [releases page](https://github.com/dolag233/Serpent-Extension/releases/latest) and extract it to a fixed folder (e.g. `Documents/Serpent-extension`). The folder must directly contain `manifest.json`.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and enable Developer mode (top-right).
3. Click “Load unpacked” and select the extracted folder.

### Firefox

1. Download `serpent-extension-firefox-<version>-signed.xpi` from the [releases page](https://github.com/dolag233/Serpent-Extension/releases/latest).
2. Open `about:addons` → gear icon → “Install Add-on From File…” → select the downloaded `.xpi`.
3. The extension stays installed across Firefox restarts, like a store install.

### Updating

- **Chrome / Edge**: download the new zip from the releases page, extract over the old folder, then click Refresh on the extension card in `chrome://extensions` (or remove and reload).
- **Firefox**: download the new `.xpi` from the releases page and repeat the install steps; it replaces the old version.

## Usage

1. Start Serpent and open a library.
2. The extension toolbar icon turns **colored** when connected and stays **gray** when not.
3. **Context-menu save**: right-click an image or video on a web page → “Save to Serpent” → choose a target folder (recent saves/browses → separator → root → top-level folders; subfolders expand level by level).
4. **Drag-and-drop save**: drag an image and a tree-shaped save menu opens — hover `›` on a folder with children to enter its level, `‹` to go back, release outside the panel or press `Esc` to cancel.
5. A “Saving to Serpent” bubble shows progress on the page.

### Options page

Right-click the extension icon → Options to toggle:

- Notifications (system notification for save results)
- Focus Serpent after saving
- Reveal the saved asset in the library
- The drag-and-drop tree menu on web images/videos

## Troubleshooting

**“Cannot connect to Serpent”**

Make sure Serpent is running with a library open. Gray icon = disconnected; colored = connected.

**“forbidden origin” (403) when saving**

Older extension builds hit this (the server only allowed Chrome extension origins). Update to 0.1.1 or newer — Firefox’s `moz-extension://` origins are now accepted.

**The saved image is not visible in the library**

Check the “Reveal in library” option in the extension options page, and confirm the target folder you chose.

**Firefox says “This add-on could not be installed because it appears to be corrupt” / “not verified”**

You installed an unsigned zip. Use the **`-signed.xpi`** file from the releases page.

**Does the extension access all websites? Is it safe?**

The extension requests “access to all websites” — required to save images/videos from any page. It only connects to the local Serpent app (`127.0.0.1`, fixed ports) and never sends data to remote servers. The code is open source (MIT).

## Privacy

- The extension does not collect or upload any personal data.
- Saves are initiated by you; media files are uploaded directly to your local Serpent app.
- The only stored record (recently used folders) lives in the browser’s local `storage`.
