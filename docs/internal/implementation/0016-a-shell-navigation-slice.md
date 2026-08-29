# 0016-A 应用壳与导航信息架构

> 状态：实施完成（macOS 开发态自动化部分通过；人类验收与真实 Electron E2E 待收口）
> 建立：2026-07-17
> 需求来源：`mvp-ui-ux-requirements-backlog.md` REQ-SHELL-005、REQ-NAV-001–004
> 进度同步：`docs/internal/development/0015-0016-progress-sync.md`

## 范围

1. 左上角改为当前资源库名称下拉；移除 `S` 品牌字形。菜单至少：新建资源库、打开资源库、关闭资源库。
2. 顶部范围改为无边框可点击面包屑；不显示前缀“资源库 >”；托管文件夹按父链可跳转。
3. 工作区后退/前进：恢复此前浏览范围（文件夹/标签/合集/智能合集/回收站/全部/根目录）。
4. 普通托管文件夹与链接文件夹合并为同一“文件夹”树；链接用彩色链接图标，离线用红色断链图标 + title 说明。

## 明确不在本增量

- 导入/导出迁出浏览工具栏（后续）
- Eagle 维度过滤条（后续）
- 完整命令注册表 / i18n / 主题（0015）
- 文件夹卡片与文件操作（0017）
- 移除左侧标签枚举（0018）

## 产品假设（澄清队列未关闭时的实施默认）

- **历史栈**：记录浏览范围 identity，不记录滚动位置、搜索词或查看页；查看页不进历史。
- **资源库菜单**：复用现有 `create` / `open` / `close` 流程；暂无“最近资源库列表”API 则不伪造。
- **统一树**：链接文件夹作为根级条目与托管根文件夹并列；链接暂无子层级数据。

## 测试 seam

1. `buildManagedFolderBreadcrumbTrail` — 由 flat `ManagedFolderSummary[]` 生成祖先链。
2. `createWorkspaceNavHistory` — push / back / forward / canBack / canForward / clear。
3. `buildUnifiedDirectoryNavEntries` — 托管树 + 链接根级合并为可渲染条目。
