# 设置中心：分类侧栏与偏好收敛

> 工单：`Serpent-cr8h`
>
> 状态：qa / 待人类验收
>
> 开始时间：2026-07-23
>
> 基线：`f59914e`
>
> 当前提交：当前 `HEAD`

## 目标

把现有单列「通用设置」重构为带左侧分类导航、右侧可滚动内容区的设置中心。保留已有偏好的持久化语义，并将已经存在、适合普通用户调整的项目按以下信息架构收敛：

- 常规：界面语言；
- 外观：主题、强调色、层级投影；
- 浏览：默认布局、卡片字段与预览角标；
- AI：AI 来源标识，以及进入完整 AI 配置的入口；
- 安全与导入：硬盘删除确认、已记住的导入冲突选择。

不把仅用于内部诊断、尚未形成稳定产品语义的实现细节伪装成用户设置。侧栏宽度、文件夹展开状态等直接操控且已自动保存的工作区状态继续留在原交互中。

## 设计决定

- 采用深色参考图中的「导航轨 + 内容画布」关系，但使用 Serpent 现有主题 token，确保亮暗主题与 Windows/macOS 一致。
- 分类切换不打开嵌套对话框；AI 分类内的「配置 AI」使用既有受保护的 AI 配置对话框，避免复制 Key、测试连接及模型列表状态机。
- 当前分类数量可完整显示在一屏内，首版不加入只会筛分类名称的伪搜索；当设置项扩展到需要搜索时，再以逐设置项匹配实现。
- 工具栏中的「AI 设置」先进入设置中心的 AI 分类；分类内再按需打开既有 Key/模型配置对话框，设置入口不再分散。

## 验证计划

- 给分类信息架构纯函数增加 unit 测试；
- 执行定向 lint、typecheck 和相关 unit 测试；
- 本环境如无可调用的桌面 Computer Use，明确记录为未执行并进入人类验收队列。

## 自动化记录

- `npm run typecheck`：通过。
- `npm exec vitest run tests/unit/app-settings-sections.test.ts tests/unit/toolbar-commands.test.ts tests/unit/dialog-escape-stack.test.ts tests/unit/ai-ui-preferences.test.ts tests/unit/disk-delete-confirm-preferences.test.ts tests/unit/import-conflict-preferences.test.ts tests/unit/canvas-preferences.test.ts tests/unit/theme-preferences.test.ts tests/unit/accent-preferences.test.ts tests/unit/shadow-preferences.test.ts`：10 files / 82 tests 通过。
- 新增设置中心模块及其单测的定向 ESLint：通过；全仓 `npm run lint` 仍有 9 error / 2 warnings，涉及既有的 `AiConfigDialog.tsx`、`App.tsx`、`ScopeBreadcrumbs.tsx`、`library-service.ts` 等，不将其归因于本增量。
- `git diff --check`：通过。

## 人工 UX 证据

Computer Use skill 已检查，但当前会话未提供可调用的 `node_repl` / Computer Use runtime，无法真实操作 Electron 或截取截图。设置中心不标记 accepted，已交由 SETTINGS-003 人类验收。

## 四列可追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 分类侧栏与右侧内容区 | `AppSettingsDialog.tsx`、`AppSettingsNavigation.tsx`、`styles.css` | `app-settings-sections.test.ts` | SETTINGS-003 待人类验收 |
| 已有应用偏好按用户语义收敛 | `AppSettingsPages.tsx`；现有 preferences/provider 模块 | 相关 preferences 8 个 unit suites | SETTINGS-003 待人类验收 |
| AI 设置入口收敛到设置中心 | `App.tsx`、`AppSettingsPages.tsx`、`toolbar-commands.ts` | `toolbar-commands.test.ts` | SETTINGS-003 待人类验收 |

## 独立复审

- Standards（Terra）：未发现 P1/P2；检查 React 生命周期、入口、i18n、Escape、ARIA tab 与窄屏/主题 CSS。保留缺口为 Renderer 级交互测试和真实桌面检查。
- Spec（Terra）：未发现 P1/P2；确认设置中心覆盖用户要求、保留现有存储语义，AI 配置经受保护的既有窗口继续处理。保留同样的交互和视觉验收缺口。

完整审查与 QA 结论分别见 `docs/reviews/2026-07-23-settings-center-code-review.md` 和 `docs/qa/2026-07-23-settings-center-qa-report.md`。
