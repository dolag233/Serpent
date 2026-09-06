# 2026-09-06 官方插件社区目录

设置 → 插件 → 打开插件社区：Host 从 `https://github.com/dolag233/Serpent-Plugin-Pool` 的 `catalog.v1.json` 拉目录，按钉死的 GitHub Release ZIP + sha256 安装。失败用缓存并标明未更新。社区通道禁止 zipball。官方/已认证 badge 与中英文展示名来自目录，已装插件简介跟随软件语言。本地文件夹/ZIP 与粘贴 GitHub URL 保留为高级安装。不预装插件。

点社区卡片进入详情：先显示作者（目录 `author`，缺省为 GitHub owner）、版本、仓库链接、运行模式、平台与简介，再渲染 README。中文优先 `README.zh-CN.md` → `README.zh.md` → `README.md`；英文优先 `README.en.md` → `README.md`。README 从钉死 tag 的 raw 地址拉取并落磁盘缓存；Markdown 解析成 AST 再 React 渲染，不注入 HTML；远程图片显示为外链按钮。

MediaConverter Release 资产名改为 `com.dolag.serpent.media-converter-<ver>-any.zip`。
