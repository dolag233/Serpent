# 工作区标签页

> 日期：2026-09-12  
> 工单：`Serpent-738426`  
> 状态：功能候选，等待人类验收

## 用户目标

Serpent 顶部提供浏览器式工作区标签页。文件夹、合集、回收站、资产查看器、
标签管理、智能合集与插件侧栏页等工作区页面都可成为标签。普通导航只替换当前
标签内容；用户只有点击加号时才新增标签。

## 交互决策

1. 打开资源库时保留一个“所有资产”标签。加号在右侧新增并激活一个“所有资产”
   标签。
2. 点击侧栏、面包屑、前进/后退、进入查看器等导航继续使用当前标签自己的
   `WorkspaceNavHistory`，不会隐式新增标签。
3. 每个标签保留页面历史、搜索与筛选、排序、递归浏览开关、滚动位置和资产选择。
   每一条前进/后退历史还单独保存精确滚动偏移、滚动范围和相对进度；切换标签与
   前进/后退都在虚拟布局稳定后恢复，窗口尺寸改变时按相对进度回到同一位置。
4. 标签的关闭按钮和右键菜单都可关闭。右键菜单另有“关闭其他标签页”。
   关闭最后一个标签会复位同一标签到“所有资产”，避免出现
   无页面的工作区。
5. 文件夹标签右键菜单提供侧栏定位、复制名称、复制路径和在 Finder/文件浏览器
   中打开；合集标签提供侧栏定位和复制名称。侧栏定位只展开并聚焦对应行，不改变
   当前活动标签。
6. 标签会话属于当前打开的资源库。关闭或切换资源库时清回一个“所有资产”标签，
   防止把上一个资源库的实体 ID 带到新库。

## 架构

- `workspace-tabs.ts` 是无 React 依赖的标签状态模型。
- `use-workspace-tabs.ts` 负责保存/恢复标签上下文，并把现有导航历史引用切到
  活动标签。
- `WorkspaceTabs.tsx` 只负责标签栏交互和键盘可访问性。
- `workspace-tab-presentation.ts` 根据当前共享数据解析标题、图标与右键实体。
- 右键操作扩展既有 `ContextMenuDescriptor` / `AssetContextMenu`；文件系统
  操作继续走既有 Worker 命令，不向 Renderer 暴露路径能力。
- 侧栏定位扩展 `NavigationSidebar`：展开父级、滚动到行并聚焦，复用持久化的
  导航树折叠偏好。

## UI 约束

- 复用 `Icon`、`data-hover-tip`、`MenuSurface` 和既有主题 token。
- 标签栏使用连续文件夹页签轮廓：顶部与窗口边缘留空隙，上圆角与肩部用同一
  套较大曲线；非活动标签在同一底边上排列，活动标签以圆滑肩部与内容区相连；
  不显示彼此分离的卡片。
- 标签栏水平溢出时，鼠标滚轮与触控板两指滑动都横向平移标签条；活动标签在
  新增、切换和窗口缩放后保持可见。加号留在条带外侧，不随列表滚动。
- 标签支持 ArrowLeft/ArrowRight、Home/End；Delete 关闭当前聚焦标签；
  ContextMenu 或 Shift+F10 打开右键菜单。
- 不把状态模型、页面解释或内部术语写进用户界面。

## 验收矩阵

| 需求 | 实现 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| 仅加号新增；普通导航替换当前标签 | `WorkspaceTabs.tsx`、`workspace-tabs.ts`、`App.tsx` | `workspace-tabs-ui.test.tsx`、`workspace-tabs.test.ts`、`workspace-tabs.test.ts` E2E | Windows 开发态 Electron E2E 通过；Computer Use 已尝试但窗口激活受阻，packaged 未执行 |
| 标签独立保存页面、历史、搜索、选择与滚动 | `use-workspace-tabs.ts`、`workspace-nav-history.ts`、`workspace-scroll-position.ts`、`App.tsx` | 状态模型/滚动换算单测与 workspace-tabs E2E | E2E 验证标签切换和前进/后退均回到 73% 位置，并验证防抖搜索提交后选择仍恢复 |
| 关闭按钮与右键关闭 | `WorkspaceTabs.tsx`、`AssetContextMenu.tsx` | UI 单测与 workspace-tabs E2E | Windows 开发态 Electron E2E 通过 |
| 文件夹/合集对应右键操作与侧栏定位 | `workspace-tab-presentation.ts`、`AssetContextMenu.tsx`、`NavigationSidebar.tsx` | presentation/sidebar 单测与 workspace-tabs E2E | Windows 开发态 Electron E2E 通过；Finder、系统文件浏览器实际打开未点击 |
| 亮暗主题、窄/宽窗口与溢出 | `workspace-tabs.css`、`workspace-tab-strip-scroll.ts` | 静态 lint；组件键盘单测；滚轮映射单测与 UI 单测 | 临时预览已检查亮/暗、760/1300/1600px；滚轮横向滑动自动化已覆盖，macOS 真机两指手势未执行；Luna high 的独立 Computer Use 在首张截图后因目标窗口无法再次激活而未完成 |
