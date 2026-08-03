# 2026-08-03 资产工作流与全局反馈 UX 开发记录

## 本轮范围

- 查看器打开或切换资产时的首帧自适应；
- 全局 info / warning / error 通知的层级与位置；
- 序列帧导入的尺寸一致性和批量设置；
- 多选资产加入合集时的数量提示；
- 回收站侧栏数量的即时同步；
- 修复文件夹切换时插件注册的左侧面板入口短暂消失。

## 后续反馈：移除无库创建面板的脚本入口

用户澄清：无资源库时的“创建资源库”面板不应提供“自动化脚本”按钮。该入口已从 `CreateDialog` 删除，脚本相关能力和已有资源库内的“更多工具 → 自动化脚本”入口不受影响。

工单：`Serpent-3drn`。

回归测试 `tests/e2e/automation-script-console.test.ts` 改为验证无库创建面板不包含脚本按钮，也不显示脚本对话框；原先通过无库面板直接打开脚本并创建资源库的路径随产品决定撤回。

## 关键根因与修复

### 查看器首帧自适应

`AssetSummary.width/height` 是缩略图尺寸，不是源媒体尺寸，不能用于首帧 Fit。最终保留查看器自身的源图测量流程，只将已解码图片的同步测量从 `useEffect` 提前到 `useLayoutEffect`，使图片在浏览器绘制首帧前完成 Fit。实现位于 `src/renderer/zoomable-preview-image.tsx`。

### 全局通知层级与位置

通知原先挂在画布容器内，会受设置面板等局部 stacking context 影响而被盖住。`WorkspaceNoticeBanner` 现在通过 `createPortal(..., document.body)` 挂载，并使用固定定位和全局层级。位置为：

```css
top: calc(var(--shell-toolbar-height) + 20px);
```

因此通知位于应用顶栏下方的工作区空白带，同时仍显示在设置面板、查看器和其他局部覆盖层之上。实现位于 `src/renderer/App.tsx` 和 `src/renderer/styles.css`。

### 插件左侧面板入口闪烁

文件夹切换时 `busy` 会短暂变为 true。`App` 原先把 `Boolean(library) && !busy` 传给 `usePluginSidebarViews`，hook 在 `enabled=false` 时立即返回空数组，导致 `NavigationSidebar` 卸载所有 `sidebar.entries` 的插件入口。内容加载状态不应影响库级壳层贡献。

修复为仅由资源库是否打开决定插件侧栏入口是否可用：

- 新增 `isPluginSidebarViewsEnabled(libraryId)`；
- 文件夹切换期间保留已加载的插件入口；
- 仍在资源库关闭时隐藏插件入口；
- 插件贡献刷新仍由原有 `onContributionsChanged` 路径负责。

相关实现：`src/renderer/plugin-sidebar-views.tsx`、`src/renderer/App.tsx`。

## 回归测试

新增 `tests/unit/plugin-sidebar-views.test.ts`，覆盖：

1. 资源库打开且文件夹切换加载中时，插件入口仍可用；
2. 没有打开资源库时，插件入口不可用。

诊断阶段先运行了红灯测试，确认原实现会在加载态返回 false；修复后同一测试转绿。

## 验证记录

| 检查 | 命令 / 操作 | 结果 |
| --- | --- | --- |
| 插件侧栏回归 | `npx vitest run --config vitest.config.ts tests/unit/plugin-sidebar-views.test.ts` | 1 个文件、2 个测试通过；修复前同一测试 1 个失败。 |
| ESLint | `npm run lint` | 通过；仅有 Babel 对超大 Worker 文件的提示，无 lint error。 |
| TypeScript | `npm run typecheck` | 通过，包含主工程和 extension 配置。 |
| 用户验收 | 通知位置 | 用户确认通过。 |
| 用户验收 | 查看器首帧、回收站侧栏同步、侧栏数量与主内容同步 | 用户确认通过。 |

本轮按用户要求不再进行 Computer Use 验收；插件侧栏入口修复以定向回归测试和调用链诊断为证据。
