# Serpent

开源（MIT）、跨平台（macOS / Windows）的数字资产管理软件，面向游戏美术、影视后期、平面/UI/品牌设计师。

导入、浏览、搜索、标签、合集、3D 模型预览（FBX/OBJ/GLB 等）、HDRI 环境光与 PBR 渲染。数据保存在本地资源库，无云端依赖。

- 英文版：[README.en.md](README.en.md)
- 使用手册：[docs/user-guide/](docs/user-guide/README.md)
- 开发者文档：[docs/developer/](docs/developer/README.md)

## 安装

正式发布尚未开始（GitHub Releases 暂无可下载安装包）。当前安装包由 `npm run make` 本地生成，或向项目维护者获取。

**macOS**：下载 `Serpent-<版本>-arm64.dmg`，拖入「应用程序」。首次打开时 macOS 会提示"无法验证开发者"，右键点击应用 → 打开（仅首次），或运行：

```bash
xattr -cr /Applications/Serpent.app
```

**Windows**：运行 `Serpent-<版本> Setup.exe`。未签名版本首次运行会显示 SmartScreen 警告，选择「更多信息 → 仍要运行」。

**浏览器扩展**：不通过商店上架，随应用分发。安装后打开 `chrome://extensions`，开启开发者模式，加载已解压的扩展：

- macOS：`Serpent.app/Contents/Resources/extension`
- Windows：安装目录 `resources/extension`

## 本地构建

要求 Node.js 24.15.0（见 `.nvmrc`）。原生开发目标为 macOS arm64 与 Windows x64。不要在 SMB/NAS 挂载目录上构建。

```bash
npm ci --registry=https://registry.npmjs.org
npm run rebuild:native   # 对齐 better-sqlite3 与 Electron ABI（校验 FTS5）
npm start
```

常用命令：

```bash
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # 单元 + Worker 集成测试
npm run test:e2e         # Playwright E2E
npm run package          # 打包到 out/Serpent-<platform>-<arch>/
npm run make             # 按平台生成安装包（macOS dmg / Windows zip；Windows 安装器用 Inno Setup 构建）
```

完整的构建、打包、发布流程见[开发者文档](docs/developer/build-packaging.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用手册](docs/user-guide/README.md) | 安装、导入、浏览、搜索、标签、合集、3D 查看、故障排查 |
| [开发者文档](docs/developer/README.md) | 环境搭建、构建打包、架构、测试 |
| [扩展作者手册](docs/manual/README.md) | 插件 / 脚本 / MCP |
| [产品简报](docs/product-brief.md) | 产品愿景与 MVP 边界 |

## 许可证

MIT。内置媒体组件与资产遵循各自许可（FFmpeg LGPL、OpenImageIO、ufbx MIT、Poly Haven CC0），见各 `resources/` 目录的 LICENSE 文件。
