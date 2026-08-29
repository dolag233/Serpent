# 浏览器扩展拖拽保存覆盖开发日志（2026-08-09）

## 背景

工单 `Serpent-h8qt` 收敛浏览器扩展拖拽保存与右键保存的媒体识别差异。原实现只依赖 `dragstart` 的坐标命中，因此链接、点击遮罩、懒加载容器、CSS 背景图和部分视频拖拽场景无法进入保存树；浏览器直接打开本地图片时也不会注入内容脚本。

## 实现

- `extension/media-target.ts`
  - 新增拖拽专用解析顺序：事件 composed path/元素结构 → `text/uri-list`、`text/html`、`text/plain` 拖拽数据 → 原有坐标命中兜底。
  - 补充常见懒加载属性（`data-lazy-src`、`data-original-src`、`data-image-url` 等）和 `file://` 媒体 URL 识别。
  - 本地文件媒体保留源元素，供页面内上传使用；HTTP(S) 目标继续走原有浏览器凭据下载链路。
- `extension/content-script.ts` / `extension/radial-menu.ts`
  - 拖拽幽灵优先使用实际源元素。
  - 本地图片在页面内绘制为 PNG，限制 32 MiB，通过运行时消息交给后台上传；不把本地路径发送给桌面端。
- 本地文件页的扩展原生右键菜单也转发到同一页面内上传路径，避免开启文件访问权限后出现“能看到菜单但不能保存”。
- `extension/background.ts` / `extension/save-client.ts`
  - 增加本地二进制上传消息和大小校验；上传时省略远程 URL 元数据并显式标记本地文件。
- `src/main/extension-server.ts` / `src/main/index.ts`
  - `/save-upload` 在显式本地文件标记下允许缺少远程 URL 元数据，仍保留远程上传的 HTTP(S) 校验。
- `extension/manifest.json`
  - 内容脚本匹配 `file:///*`；用户仍需在扩展详情开启“允许访问文件网址”。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npx vitest run --config vitest.config.ts tests/unit/extension-media-target.test.ts tests/unit/extension-client.test.ts tests/unit/extension-message.test.ts` | 通过；71 个扩展相关测试通过 |
| `npm run extension:build` | 通过，`dist/extension/` 可加载 |
| 真实 Chrome/Edge 重载后拖拽 | 待人类验收（见 EXT-012）；当前浏览器旧扩展包不能作为新代码证据 |
