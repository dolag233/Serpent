# 浏览器扩展

把网页图片或视频保存到 Serpent 资源库，支持**右键保存**和**拖拽保存**。支持 Chrome / Edge（Chromium）与 Firefox。

媒体由**浏览器侧下载**（携带 Cookie 与页面 Referer）再上传到本机 Serpent，可绕过多数防盗链限制。只要 Serpent 在运行且已打开资源库，扩展即可连接（本机 `127.0.0.1`），无远程服务器。

## 安装

> 扩展尚未上架浏览器商店，需要手动安装。所有安装文件在[扩展发布页](https://github.com/dolag233/Serpent-Extension/releases/latest)下载，按浏览器选择对应文件。

### Chrome / Edge

1. 到[扩展发布页](https://github.com/dolag233/Serpent-Extension/releases/latest)下载 `serpent-extension-<版本>.zip`，解压到固定文件夹（例如「文档/Serpent-extension」），文件夹内需直接包含 `manifest.json`。
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压出的文件夹。

### Firefox

1. 到[扩展发布页](https://github.com/dolag233/Serpent-Extension/releases/latest)下载 `serpent-extension-firefox-<版本>-signed.xpi`。
2. 打开 `about:addons` → 齿轮图标 →「从文件安装附加组件…」→ 选择下载的 `.xpi`。
3. 安装后**重启 Firefox 仍然生效**，与商店安装一致。

### 更新

- **Chrome / Edge**：到发布页下载新版本 zip → 解压覆盖 → 在 `chrome://extensions` 扩展卡片上点「刷新」（或移除后重新加载）。
- **Firefox**：到发布页下载新版本 `.xpi` → 重复安装步骤，覆盖旧版本。

## 使用

1. 启动 Serpent 并打开一个资源库。
2. 扩展工具栏图标在已连接时会变为**彩色**；未连接时保持**灰色**。
3. **右键保存**：在网页图片或视频上右键 →「保存到 Serpent」→ 选择目标文件夹（最近保存/浏览 → 分割线 → 全部一级目录，子文件夹可逐级展开）。
4. **拖拽保存**：拖拽图片时自动展开树状保存菜单——悬停有子文件夹的目录右侧 `›` 进入下一级；左侧 `‹` 返回；面板外松开或 `Esc` 退出。
5. 保存过程中页面会出现「正在保存到 Serpent」气泡反馈。

### 选项页

右键扩展图标 → 选项，可开关：

- 通知（保存结果系统通知）
- 保存后聚焦 Serpent 应用
- 保存后在资源库中显示该资产
- 拖拽网页图片/视频时的树状保存菜单

## 常见问题

**保存时提示「无法连接 Serpent」**

确认 Serpent 桌面应用已启动并打开了资源库。扩展图标变灰 = 未连接；变彩 = 已连接。

**保存时提示「forbidden origin」（403）**

旧版扩展会遇到此问题（服务器只放行 Chrome 扩展来源）。更新到 0.1.1 及以上版本即可（已支持 Firefox 的 `moz-extension://` 来源）。

**保存后库里没看到图片**

检查选项页「保存后在资源库中显示该资产」是否开启，并确认保存时选择的目标文件夹。

**Firefox 安装时提示「此附加组件无法安装，因为它未通过验证」**

说明安装的是未签名的 zip。请使用发布页中的 **`-signed.xpi`** 文件。

**扩展能访问所有网站吗？安全吗？**

扩展请求了「访问所有网站」权限，这是保存任意网页图片/视频所必需的。扩展只连接本机 Serpent（`127.0.0.1` 固定端口），不向任何远程服务器发送数据。代码开源（MIT）。

## 隐私

- 扩展不收集、不上传任何个人数据。
- 保存动作由你主动发起；媒体文件直接上传到你本机的 Serpent 应用。
- 仅保存的记录（最近使用的文件夹）存放在浏览器本地 `storage` 中。
