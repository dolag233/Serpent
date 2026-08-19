# 安装

最新安装包见 [Serpent Releases](https://github.com/dolag233/Serpent/releases)。

## 系统要求

- macOS：Apple Silicon（arm64）或 Intel（x64），macOS 11 或更高版本
- Windows：64 位 Windows 10 或 Windows 11
- 应用本身约需 500 MB；资源库数据另占空间

Windows 安装包和版本说明以 [Serpent Releases](https://github.com/dolag233/Serpent/releases) 为准。

## macOS

1. 下载对应架构的 `Serpent-<版本>-arm64.dmg` 或 x64 安装包。
2. 打开 DMG，将 Serpent 拖到「应用程序」。

当前开发版可能未签名公证，首次打开时右键应用选择「打开」并确认。若系统仍阻止，可以在终端清除隔离属性：

```bash
xattr -cr /Applications/Serpent.app
```

卸载只需将应用移入废纸篓；资源库位于创建时选择的位置，不会因删除应用而删除。

## Windows

1. 下载 `Serpent-<版本> Setup.exe` 或发布页提供的 Windows 安装包。
2. 运行安装程序并按提示完成。

未签名开发包可能触发 SmartScreen，请核对来源后选择「更多信息 → 仍要运行」。通过系统「设置 → 应用」卸载。

## 浏览器扩展

从[扩展发布页](https://github.com/dolag233/Serpent-Extension/releases)下载浏览器扩展（Chrome / Edge / Firefox），安装与使用见[浏览器扩展](browser-extension.md)。

## 升级

macOS 用新 DMG 替换应用，Windows 运行新版安装程序覆盖安装。资源库目录和用户配置独立于应用安装目录，通常会保留；升级前建议备份资源库。跨版本迁移和平台差异请以发布说明为准。
