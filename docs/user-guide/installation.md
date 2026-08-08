# 安装

## macOS

1. 下载 `Serpent-<版本>-arm64.dmg`
2. 打开 dmg，把 Serpent 拖入「应用程序」

当前版本未签名公证，首次打开会提示"无法验证开发者"。右键点击应用 → 打开，之后可正常使用。也可以用终端清除隔离属性：

```bash
xattr -cr /Applications/Serpent.app
```

卸载：把 Serpent 拖入废纸篓。资源库数据在创建时选择的位置，删除应用不影响数据。

## Windows

1. 下载 `Serpent-Setup-<版本>.exe`
2. 运行安装，按提示完成

未签名版本首次运行会显示 SmartScreen 警告，选择「更多信息 → 仍要运行」。卸载通过系统「应用和功能」。

> Windows 打包与安装流程仍在验证中，见[构建与打包](../developer/build-packaging.md)。

## 浏览器扩展

扩展不通过商店上架，随应用分发。安装应用后：

1. 打开 Chrome 或 Edge，访问 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择扩展目录：
   - macOS：`Serpent.app/Contents/Resources/extension`
   - Windows：安装目录 `resources/extension`

加载后工具栏出现扩展图标。在网页图片或视频上右键可保存到 Serpent，也可以直接拖拽导入。

## 升级

- macOS：下载新版 dmg 替换应用，数据不受影响
- Windows：运行新版 Setup.exe 覆盖安装，数据保留

Serpent 承诺完全兼容旧版本数据，升级后旧库可直接打开使用。
