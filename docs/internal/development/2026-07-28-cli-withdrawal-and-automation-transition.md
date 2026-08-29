# 2026-07-28：撤回 CLI 基础层并转向脚本化 + MCP

## 决定

产品负责人明确撤回此前的通用 CLI 方向，转而优先实施：

- Desktop 自动化中心中的受控 JS/TS Console 与保存脚本；
- 本地 stdio MCP；
- 两者共享的 `Automation Command Gateway`。

CLI 不再是当前产品入口，也不保留为本阶段兼容层。未来若重新讨论无界面脚本启动器或
通用 CLI，必须单独提出 ADR，不得从旧代码恢复。

## 撤回范围

精确反向应用提交 `753129b922211c84984ef7b5be7c39a7ada64c74`
（`feat: add read-only CLI foundation`），撤回：

- `src/cli/`、CLI Vite 配置、`npm run cli*` 与 CLI 启动脚本；
- CLI 专用 Registry、只读 Worker 打开模式和只读执行器；
- CLI 参数/Worker 测试、CLI 人类验收项和对应开发日志；
- 该提交为了 CLI 抽出的搜索表达式、资源引用、协议错误和 Worker 分发改动。

`docs/internal/implementation/0011-agent-native-cli-vertical-slice.md` 保留为明确标记“已撤回”的
历史记录，不再是实现依据。

## 当前替代架构

- [ADR-0025](../adr/0025-automation-core-script-runtime-and-mcp.md) 定义 Gateway、脚本沙箱、
  MCP、授权与写入计划的边界。
- [0023 框架规格](../implementation/0023-automation-scripting-mcp-framework.md) 定义分阶段交付、
  测试接缝与排除范围。
- `Serpent-y51c.2` 实现只读 Registry/Gateway；`Serpent-y51c.3` 先完成沙箱原型门禁。

## 验证

- `git diff --exit-code 753129b^ -- <所有被撤回的源文件、构建文件与测试>`：通过，证明
  回退范围的工作树内容与该提交前完全一致。
- `git diff --check`：通过。

完整类型检查与自动化测试将在并行中的 Gateway / 沙箱实现合入后，以最终工作树统一执行，
避免把中途并发写入误报为回归结果。

## 工单迁移

- 原 `Serpent-bb56`（CLI/脚本化）与 `Serpent-bb56.3`（CLI 分发）已 supersede 到
  `Serpent-y51c` / `Serpent-y51c.10`。
- `Serpent-bb56.2` 已重命名并移入自动化 epic，保留跨进程写租约、变更序号和 detached Job
  的通用依赖；它不再实现 CLI。
- 旧 `Serpent-bb56.1` 关闭记录追加了撤回说明，不得当作当前实现或验收证据。
