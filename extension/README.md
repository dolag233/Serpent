# Serpent Chromium 扩展

该扩展支持在 Chrome、Edge 等 Chromium 浏览器中右键网页图片或视频，并将媒体保存到正在运行的 Serpent 桌面应用。

媒体由**浏览器侧下载**（携带 Cookie 与页面 Referer），再上传到本机 Serpent，可绕过多数防盗链限制。**不需要配对码**：只要 Serpent 在运行且已打开资源库，扩展即可连接（本机 127.0.0.1）。

## 构建

在 Serpent 项目根目录运行：

```bash
npm run extension:build
```

可安装产物生成在 `dist/extension/`。该目录包含编译后的 JavaScript、Manifest 和 PNG 图标；不要直接加载源码目录 `extension/`。

## 手动安装

1. 先完成上述构建。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择 `dist/extension/`。

## 使用

1. 启动 Serpent 并打开一个资源库。
2. 扩展工具栏图标在已连接时会变为彩色；未连接时保持灰色。
3. 在网页图片或视频上右键，选择「保存到 Serpent」，再选择「根目录」或目标文件夹。
4. Pinterest、Behance、Google 图片等会拦截浏览器原生右键菜单的站点，扩展会改为显示 Serpent 浮层菜单；普通站点仍使用浏览器原生右键菜单。

扩展会通知保存请求已接收、Serpent 未运行、浏览器下载失败，或桌面应用给出的具体拒绝原因。最近使用过的文件夹会排在子菜单前面。Serpent 客户端会对扩展保存执行与本地导入相同的内容查重。MVP 不会自动启动桌面应用。

桌面应用内打开「设置 → 常规」可查看安装说明（无需配对）。正式发布前安装文案会再改写（工单 `Serpent-999o`）。
