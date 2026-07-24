# Serpent Chromium 扩展

该扩展支持在 Chrome、Edge 等 Chromium 浏览器中右键网页图片或视频，并将保存请求发送给正在运行的 Serpent 桌面应用。

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

## 首次配对

1. 在 Serpent 桌面应用中点击「浏览器扩展」，复制配对码。
2. 在浏览器扩展详情页打开「扩展程序选项」，粘贴并保存配对码。
3. 配对码轮换后，旧码立即失效；再次执行以上步骤即可恢复连接。
4. 启动 Serpent 并打开一个资源库。
5. 扩展工具栏图标在已连接时会变为彩色；未连接或未配对时保持灰色。
6. 在网页图片或视频上右键，选择「保存到 Serpent」，再选择「根目录」或目标文件夹。
7. Pinterest、Behance、Google 图片等会拦截浏览器原生右键菜单的站点，扩展会改为显示 Serpent 浮层菜单；普通站点仍使用浏览器原生右键菜单。

扩展会通知保存请求已接收、Serpent 未运行，或桌面应用给出的具体拒绝原因。最近使用过的文件夹会排在子菜单前面；没有最近记录时按文件夹名称排序。Serpent 客户端会对扩展保存执行与本地导入相同的内容查重：库内已有相同内容的资产时不会重复入库。MVP 不会自动启动桌面应用。
