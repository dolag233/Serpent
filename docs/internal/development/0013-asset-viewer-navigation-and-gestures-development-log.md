# 0013 资产查看页面导航与手势体验开发日志

> 日期：2026-07-14
>
> 当前范围：P0「从深滚动位置进入查看页面发生错位」热修
>
> 完整切片状态：仍在 backlog；本日志不代表其余查看器 UX 已完成

## 用户可见问题

在资产画布向下滚动较深后双击资产，查看页面有很高概率整体向上偏移，严重时主要内容完全离开中央工作区。该问题直接阻断核心浏览旅程，按 P0 处理。

## 诊断证据

先在 `tests/e2e/asset-pagination.test.ts` 增加稳定复现：连续加载 73 个资产，滚动到底部，双击 `asset-072.txt`，比较查看器与中央画布四条边。

修复前连续复现得到：

- 进入查看器前 `scrollTop = 10712`；
- 查看器出现后画布 `scrollTop = 10673`；
- 画布顶部 `y = 44`，查看器顶部 `y = -10629`；
- 两者差值恰好为 `10673px`；
- 查看器的定位父元素是滚动容器 `.workspace-canvas.is-viewing`，且没有额外 transform。

这证明错位不是图片尺寸、异步解码或缩放状态引起，而是绝对定位查看器仍处在有滚动偏移的内容坐标系中。

## 修复

- 将 `AssetPreviewModal` 从 `.workspace-canvas` 内部移到 `.workspace` 直接子级，使查看器覆盖非滚动的中央工作区坐标系。
- 给 `.workspace` 建立 `position: relative` 定位上下文。
- 打开查看器时记录画布 `scrollLeft/scrollTop`；返回时先恢复精确滚动位置，再用 `preventScroll` 将焦点交还原资产。
- 更新媒体预览架构回归，明确查看器必须位于 `.workspace > .workspace-viewer`，不得重新嵌回滚动画布。

## 自动化验证

- P0 回归在修复前稳定红两次，修复后覆盖平铺/瀑布流、96/320 卡片尺寸及 25%/50%/底部共 12 个组合。
- 相关 Electron E2E：`asset-pagination`、`media-preview`、`media-video-playback`、`browsing-preferences`，共 6/6 通过。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：874 passed，1 skipped。
- `npm run verify:mainline`：完整通过；搜索性能 4/4、Electron E2E 42/42。

## 真实应用验收

使用 Computer Use 操作真实 Electron 开发应用：

1. 打开含 142 项资产的真实资源库并进入「所有资产」；
2. 连续向下滚动至第 100 项附近；
3. 双击深层图片 `257547cdc2a02d349d02db6bb5018b4d.jpg`；
4. 查看页面完整覆盖中央工作区，图片成功解码且没有向上漂移；
5. 返回后仍处于原深层位置，原资产保持选中并可见。

截图证据：

- [深滚动后查看页面位置正确](../qa/evidence/0013-viewer-offset/01-deep-scroll-viewer-fixed.jpeg)
- [返回后恢复原滚动位置与资产选择](../qa/evidence/0013-viewer-offset/02-return-scroll-restored.jpeg)

## 范围边界

本次只验收 P0 位置正确性。首次 fit、工具栏/返回语义、平移、缩放灵敏度、范围切换退出、视频播放器体验等仍按 0013 完整规格排期，不能借本次热修宣称完成。
