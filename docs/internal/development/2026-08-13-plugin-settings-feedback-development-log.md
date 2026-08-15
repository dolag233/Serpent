# 插件设置与任务进度反馈修复开发记录

日期：2026-08-13

## 范围

- 将自动更新从每个 GitHub 插件卡片上的单插件偏好提升为「设置 → 插件」总览卡中的设备级开关。
- 保留旧设备状态的兼容迁移：历史上已经明确打开过任一插件自动更新时，迁移后不静默关闭。
- 将插件任务活动卡调整为紧凑的 Activity/Progress 层级：身份与状态、当前阶段、完成数量和百分比分开显示。
- 对实时阶段文案复用既有错误脱敏逻辑，避免把 `spawn` 等阶段后的本机绝对路径显示到 Renderer。

## 根因与实现

旧 UI 把自动更新偏好和插件 ID、来源指纹绑定，因此设置页只能在每张 GitHub 插件卡片内展示开关；现在由 `PluginPackageManager` 持久化 `autoUpdateAll`，IPC 提供全局读写请求，设置总览卡统一控制。关闭全局策略时清除旧的单插件偏好，避免旧策略在后台重新生效。

旧任务卡把同一份“完成数 · 百分比”同时传给 Progress 的 label 和 value，造成两个重复的进度摘要；同时阶段消息直接展示了插件 Host 的技术路径。现在数量和百分比分别进入对应的 Progress 槽位，状态通过状态点和状态文本表达，阶段消息先经过路径脱敏。

## 第二轮反馈修复

- 移除设置页中的「信任」/「不信任」按钮和资源库打开后的自动信任弹窗；未信任插件保持关闭，不再显示非受限模式的持久警告。
- 启用资源库插件时才弹出一次确认，确认内容包含插件名称、运行模式和声明权限；确认后先记录设备信任，再保存启用的资源库解析。
- 将插件 Job Activity 改为 CSS Grid：插件信息与操作区分列，进度条横跨整行；窄窗时回退为单列，避免进度轨道收缩在左侧。

## 验证证据

- `npm run typecheck`：通过。
- 定向 ESLint（本次修改的 Main/Renderer/Shared 与相关测试）：通过。
- `npx vitest run --config vitest.config.ts tests/unit/plugin-job-display.test.ts tests/unit/plugin-package-manager.test.ts tests/unit/plugin-package-ipc.test.ts tests/unit/plugin-manager-response-parse.test.ts`：4 个文件、52 个测试通过。
- `node scripts/run-e2e.mjs tests/e2e/plugin-management.test.ts`：1 个 Electron E2E 通过（6.3s），覆盖设置页全局开关存在、插件卡片不再有自动更新开关、两个安装入口、无效 GitHub 地址提示、返回和本地插件安装流程。
- 第二轮回归：`tests/unit/plugin-trust-prompt.test.ts`、`tests/unit/dialog-escape-stack.test.ts`、`tests/unit/plugin-job-display.test.ts`、`tests/unit/plugin-package-ipc.test.ts` 共 35 tests 通过；`node scripts/run-e2e.mjs tests/e2e/plugin-management.test.ts tests/e2e/plugin-trusted-host-activation.test.ts` 最终 2/2 通过，覆盖 toggle 风险确认、权限文案、无信任按钮、受限/非受限插件启用。

## 第三轮反馈修复

- 成功完成的插件 Job 不再进入活动卡的 30 秒保留窗口；失败、取消和中断仍保留短暂入口，便于用户查看原因。
- 活动卡标题只显示插件名称（从插件 ID 的本地段生成用户可读回退名），移除技术性的插件 ID、handler、处理中状态和完成数；百分比作为唯一可见进度摘要，阶段说明使用辅助字号。
- 插件媒体提供器写入缩略图时，Worker 使用 Sharp 探测图片宽高并写入 `revision_artifacts`；`getCurrentArtifact` 和缩略图完成事件都保留这些尺寸，主界面在内容替换与缩略图完成两个阶段都能刷新文件大小、分辨率等摘要。
- 普通图片缩略图现在持久化源文件宽高，而不是最长边限制为 512px 的 WebP 缩略图宽高；插件将图片从小尺寸替换成更大尺寸时，资产卡能显示真实分辨率变化。

## 第三轮验证证据

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm exec vitest run tests/unit/plugin-job-display.test.ts tests/unit/plugin-job-activity.test.ts tests/worker/thumbnails.test.ts`：3 个文件、60 个测试通过；覆盖插件名称/进度展示、成功 Job 立即消失、插件缩略图尺寸写入、资产摘要读取以及内容替换后的源尺寸刷新。
- 测试前执行 `npm rebuild better-sqlite3` 恢复当前 Node ABI；仅影响本地 `node_modules`，未产生源码变更。

## 第三轮未验证边界

- 真实 Electron E2E 未进入插件页面：`plugin-job-recovery` 与 `plugin-management` 都在创建资源库后的设置按钮上被仍显示的创建流程对话框拦截（按钮 disabled，backdrop 截获点击），因此本轮 Job 活动卡和资产元信息路径未验证；这不是本轮代码路径的通过证据。
- 尚未执行真实 Electron Computer Use 视觉验收；窄窗、亮/暗主题和不同插件名称的视觉结果仍需人工复核。
- Windows 原生插件任务 UI、Windows 打包应用和 Windows native media 产物未执行。

## 未验证边界

- 当前环境未执行 Windows 原生选择器、Windows 打包应用和 Windows 路径下的插件任务视觉验收。
- 未执行真实 GitHub 网络更新；手动更新/自动更新的网络行为仍需真实 Release 环境验收。
- 真实桌面视觉验收（亮/暗主题、窄窗、长插件 ID、长阶段文案）仍需人工检查。
