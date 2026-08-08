# Installation


## 系统要求

- macOS：Apple Silicon（arm64）或 Intel（x64）macOS 11+；约 500 MB 磁盘空间（不含资源库数据）
- Windows：64 位 Windows 10 或 11；约 500 MB 磁盘空间

资源库数据另占磁盘（取决于资产数量）。Windows 验证仍在进行中，见[构建与打包](../developer/build-packaging.md)。


1. Download `Serpent-<version>-arm64.dmg`
2. Open the dmg and drag Serpent into Applications

The current build is unsigned and not notarized, so macOS shows "cannot verify the developer" on first launch. Right-click the app → Open; later launches work normally. You can also clear the quarantine attribute:

```bash
xattr -cr /Applications/Serpent.app
```

To uninstall, drag Serpent to the Trash. Library data lives where you created it — deleting the app does not touch it.

## Windows

1. Download `Serpent-<version> Setup.exe`
2. Run the installer and follow the prompts

Unsigned builds show a SmartScreen warning on first run — choose "More info → Run anyway". Uninstall through Settings → Apps.

> Windows packaging and installation is still being validated. See [build & packaging](../developer/build-packaging.en.md).

## Browser extension

The extension ships inside the app (not via a store). After installing the app:

1. Open Chrome or Edge and go to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select the extension directory:
   - macOS: `Serpent.app/Contents/Resources/extension`
   - Windows: `resources/extension` in the install directory

The extension icon appears in the toolbar. Right-click any web image or video to save it to Serpent, or drag it in directly.

## Upgrading

- macOS: download the new dmg and replace the app; data is unaffected
- Windows: run the new Setup.exe over the old install; data is kept

Serpent is fully compatible with older library data — old libraries open as-is after an upgrade.
