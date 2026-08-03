# 插件平台运行时管理与交互内核开发日志

## 状态

- 日期：2026-08-02
- 实现提交：`02ead45`（文档与 beads 证据更新另行提交）
- 范围：`Serpent-7nah`、`Serpent-gtih`、`Serpent-upsn.10`–`Serpent-upsn.13`
- 状态：核心编码、定向测试、插件 Electron E2E 与独立双轴审查已完成；全量测试仍有既有 schema/迁移/性能基线失败；切片保持有条件通过，未标记 accepted
- UI 视觉组件标准化不在本阶段范围内，继续由 `Serpent-7nah.2` 跟踪

## 本阶段决定

- `Contribution Context` 只服务菜单/工具栏等 UI 条件；插件功能仍使用完整 Domain API。
- `Invocation Context` 在命令触发时冻结，异步执行期间不重新猜测选择或焦点。
- 全局实例和资源库实例都只有 `setup(context)` / `dispose(reason)`；不增加 `openLibrary` 回调。
- 全局插件跨库操作必须通过 `serpent.forLibrary(libraryId)` 显式选择目标；Host 不把全局运行时 sentinel 当作资源库。
- 非受限插件自行探测 GPU、VRAM、CPU、内存并管理模型/外部 Worker；Host 不新增通用硬件信息或推理调度接口。
- 不维护旧插件协议兼容层，仓内 fixture、Schema、测试和文档按新契约直接迁移。

## 已落地的实现面

- 生命周期：global/library 实例创建、激活、`setup`、`dispose`、停用、崩溃清理和按实例撤销贡献。
- 上下文：有界摘要 Contribution Context、单调 revision、冻结 Invocation Context、表达式求值、条件缓存和旧 revision 失效；完整资产 ID 不随 UI Context 传递。
- 菜单：菜单树、子菜单、语义分组、`before`/`after`/`first`/`last` 定位、隐藏/置灰/checked、多选资产入口和条件上下文。
- 生命周期：setup context 提供 scope、`AbortSignal` 与可逆序释放的 `subscriptions`；Contribution 仍由 manifest 声明，不引入动态 Registrar。
- 内容写回：`asset.content.stage`、`asset.content.replace-batch`、统一 revision 预检、一次确认、staging 限额、恢复 journal 和统一变更通知。
- Job：owner 绑定 plugin instance/scope/library、进度、逐项结果、取消/恢复契约、checkpoint 字段和 Standard/Trusted 两条运行时桥接。
- 设置：字段级诊断、非法值局部回退、select 默认值回退以及未声明旧值保留但不参与渲染。
- 协议：控制面与可选事件面分层；未知非关键事件记录并忽略，未知控制/关键消息按实例隔离；Job completion/progress 做实例归属校验。
- 贡献隔离：同一用户级插件在多个资源库激活时按 `pluginInstanceId` 隔离注册和撤销。

## 证据矩阵（实时）

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| global/library 统一生命周期与 dispose 清理 | `src/main/plugin-activation-coordinator.ts`、`src/main/plugin-runtime-supervisor.ts`、`src/main/plugin-trusted-runtime-supervisor.ts` | `node scripts/run-vitest-with-electron.mjs run` 定向集合：21 files / 271 passed；含 setup 回调登记竞态回归 | 4 条隔离 Electron E2E 通过；packaged、Windows、Computer Use 未执行 |
| UI-only Context、条件与多选菜单 | `src/plugins/plugin-context.ts`、`src/renderer/plugin-contribution-context.ts`、`src/renderer/AssetContextMenu.tsx` | 定向集合覆盖 Context 表达式、browse/viewer 传播、revision 取消、菜单条件、单/多/混合选择：21 files / 271 passed | 当前 E2E 验证贡献列表、设置页和重启恢复；无选择/混合/Viewer 全矩阵尚未逐项跑完；packaged、Windows、Computer Use 未执行 |
| 批量内容替换与冲突拒绝 | `src/shared/content-replace.ts`、`src/worker/library-service.ts`、`src/shared/protocol/requests.ts` | 定向集合含 Gateway/计划审批/Worker：21 files / 271 passed；另 `media-binaries.test.ts` 12 passed | 大文件 staging、journal 恢复由 Worker 测试覆盖；packaged、Windows 未执行 |
| Job owner、进度、取消和 checkpoint | `src/plugins/plugin-jobs.ts`、`src/main/plugin-job-scheduler.ts`、`src/worker/plugin-job-repository.ts` | 定向集合含 Job repository、scheduler、Standard/Trusted（含 `forLibrary` 控制方法）/protocol：21 files / 271 passed | 任务中心和完整跨进程取消/暂停恢复/重启旅程未执行；packaged、Windows 未执行 |
| 设置字段级容错 | `src/main/plugin-settings-store.ts`、`src/renderer/plugin-host-settings-fields.tsx` | 定向集合 21 files / 271 passed；设置/菜单 E2E 通过 | 隔离 E2E 覆盖 toggle、select、hover、iframe、最近库恢复；packaged、Windows、Computer Use 未执行 |
| 协议未知事件故障域 | `src/shared/plugin-*-runtime-protocol.ts`、两个 runtime supervisor | 定向集合 21 files / 271 passed，含未知非关键事件、控制面隔离和实例归属校验 | packaged/真实崩溃重启、Windows 未执行 |

## 当前验证记录

### 2026-08-04 条件菜单真实右键回归

- `tests/fixtures/plugins/unrestricted-settings-probe/serpent-plugin.json` 增加了单选可见、双选可见的 `when` 条件。
- `tests/e2e/plugin-unrestricted-settings-pages.test.ts` 在安装并启用插件后实际导入资产、打开资产右键菜单，验证单选命令出现；条件为 false 的子项被过滤后，空的父级子菜单也不渲染。
- `node scripts/run-e2e-isolated.mjs tests/e2e/plugin-unrestricted-settings-pages.test.ts`：1 passed（6.1s）。
- 这只补齐了开发态单选右键路径；无选择、多选、混合媒体、Viewer、packaged、Windows 与 Computer Use 仍未执行。

### 2026-08-04 多选资产的条件二级菜单回归

- `tests/e2e/plugin-unrestricted-settings-pages.test.ts` 现在导入两张不同资产，先验证单选条件菜单和空父级隐藏，再用 macOS `Meta` / Windows `Control` 多选打开右键菜单。
- 多选路径实际展开 `Probe processing`，验证 `selection.assetCount == 2` 的 `Write nested selection` child 出现；这覆盖了 Host 不应把 `menus.asset` 误判成单选专用，以及 child 条件改变时父级菜单树同步更新。
- `node scripts/run-e2e-isolated.mjs tests/e2e/plugin-unrestricted-settings-pages.test.ts`：1 passed（7.5s）。无选择、混合媒体、Viewer、packaged、Windows 与 Computer Use 仍未执行。

### 2026-08-04 扩展/MIME 条件、置灰和 checked 回归

- 探测插件新增 `selection.extensions intersects ['png']`、`enablement` 和 `checked` 条件；真实单选菜单验证 PNG 项出现且 `aria-checked=true`。
- 同一资产集合切换到多选后，PNG 项仍可见但 `aria-disabled=true`、`aria-checked=false`，同时二级菜单 child 按 `selection.assetCount == 2` 出现。
- 这补齐了开发态菜单的扩展过滤、禁用和选中态证据；无选择、混合媒体、Viewer、packaged、Windows 与 Computer Use 仍未执行。

- `npm run typecheck`：通过（主 TypeScript 与 extension TypeScript）。
- 变更相关文件定向 ESLint：通过；`git diff --check`：通过。
- `node scripts/run-vitest-with-electron.mjs run` 定向插件集合：21 files，271 passed。
- `node scripts/run-e2e-isolated.mjs tests/e2e/plugin-management.test.ts tests/e2e/plugin-standard-host-activation.test.ts tests/e2e/plugin-trusted-host-activation.test.ts tests/e2e/plugin-unrestricted-settings-pages.test.ts`：4 passed（16.8s）；构建基于当前工作树，使用隔离 `SERPENT_E2E_USER_DATA_PATH`。
- `npm run test`：307 files 中 298 passed、3 skipped、6 failed；2,699 tests 中 2,677 passed、8 skipped、14 failed。失败均集中在既有 Worker schema 断言与迁移 fixture：期望 `user_version` 27、当前 28，历史 v23/v13/v8 migration 重放时 `plugin_derived_fields` 已存在，以及 100k 搜索性能用例超过既有 5 秒门槛；本阶段插件定向路径无失败。
- `npm run lint` 全量仍有仓库既有问题（123 errors、1 warning），主要为旧的 React effect、类型导入、fixture globals 等；不能记为全仓 lint 通过。
- 两轮独立审查：Standards / Spec 均无阻断项；App 上下文内联、文档缺失、setup context、Trusted dispose、global Job pause、Context 体积和 first/last 缺口已处理或记录为明确偏离。
- `packaged`、Windows、Computer Use 未执行，不纳入通过结论。

## 明确未纳入

- 插件 UI primitives、toggle/dropdown/slider 的最终视觉规范；主线设计系统稳定后再做。
- Host 通用 GPU/VRAM/CPU/内存信息接口、跨插件共享模型 Worker、Host 推理并发调度器。
- 旧插件协议兼容适配层。

## 后续验证顺序

1. 补任务中心展示、完整跨进程 Job 取消/暂停恢复与完整重启恢复证据。
2. 由主 agent 统一运行大功能测试；不把局部测试结果写成切片已验收。
3. 后台、隔离 `SERPENT_E2E_USER_DATA_PATH` 运行相关 Electron E2E；当前四条插件 E2E 已通过。
4. 继续补任务中心、完整 Job 重启和平台证据；本切片 QA 与审查报告见 `docs/qa/0024-script-plugin-platform-qa-report.md`、`docs/reviews/0024-script-plugin-platform-code-review.md`。
