# 插件 Guest 契约反馈收口开发日志

## 状态

- 日期：2026-08-02
- 工单：`Serpent-qln6`
- 范围：Guest storage 返回形状、分页边界、命令选择上下文和失败诊断
- 状态：编码完成；定向单测与相关 Electron E2E 通过；packaged、Windows、Computer Use 未执行

## 采纳的反馈

1. Guest API 不再把 Host storage IPC envelope 暴露给插件。restricted QuickJS 和 unrestricted Trusted Host 都统一投影为公开契约：
   `get` 返回值或 `null`，`set` 返回 `void`，`delete` 返回布尔值，`listKeys` 返回键数组；`data.getDirectory` 仍保留 `{ path, scope }`。
2. 命令 invocation context 省略空的 `assetIds`、`folderIds`、`collectionIds`，避免插件把空数组误判为存在选择。
3. 插件命令失败通过管理桥返回 `failureCode` 和经过长度限制/路径脱敏的 `message`，不再只剩笼统的 `operation-failed`。
4. 将分页最大值和权限边界写进插件发布文档，并用测试固定 `limit = 200` 合法、`limit = 201` 拒绝以及缺失 input-capture `sessionId` 拒绝。

## 未采纳或拆分处理的反馈

- 不放宽 `limit` 到 256；Host 的公共 Gateway 上限是 200，插件应分页处理。
- 压缩链路在「计划/确认/批量替换」阶段失败是独立问题，另由 `Serpent-h1gg` 追踪；本次不把 storage 竞态和写回链路混在一起。
- `panel.last-error`、panel `sessionId`/scope 的中转方案属于插件自定义 UI 状态诊断，不改变 Host 的核心命令错误契约，后续单独处理。

## 变更位置

- `src/scripting/plugin-storage-result.ts`：集中定义 Host storage envelope 到 Guest 公开值的投影。
- `src/scripting/quickjs-sandbox-prototype.ts`、`src/scripting/plugin-trusted-host.ts`：restricted/trusted 两条运行时桥接使用同一投影。
- `src/plugins/plugin-sdk.ts`：补齐 storage 方法和公开返回类型。
- `src/main/plugin-activation-coordinator.ts`：省略空选择 ID 数组。
- `src/main/plugin-package-ipc.ts`：透传插件命令失败诊断。
- `docs/manual/plugins/api-reference.md`、`docs/manual/plugins/development.md`：更新发布契约。

## 验证记录

- `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/unit/plugin-storage-result.test.ts tests/unit/plugin-standard-host-probe-fixture.test.ts tests/unit/plugin-trusted-host-probe-fixture.test.ts tests/unit/plugin-activation-coordinator.test.ts tests/unit/plugin-package-ipc.test.ts tests/unit/plugin-runtime-utility-protocol.test.ts tests/unit/automation-command-gateway.test.ts tests/unit/plugin-contract.test.ts`：8 files，102 tests passed。
- `node scripts/run-e2e.mjs tests/e2e/plugin-standard-host-activation.test.ts tests/e2e/plugin-trusted-host-activation.test.ts tests/e2e/plugin-job-recovery.test.ts`：3 tests passed（8.7s），覆盖 restricted/trusted storage 和完整 Electron 进程重启后的 job 恢复。
- 定向 ESLint：本次新增/修改文件未发现新增规则问题；`quickjs-sandbox-prototype.ts` 仍有工作树既有的 `import()` type annotation 与未使用符号问题，未混入本次修复。
- `git diff --check`：通过。

## Luna 交叉审查收口

- 四条 Luna 轨道分别审查了脚本/Automation、MCP、插件运行时/契约和跨模块回归。
- 确认并修复 MCP 插件工具 `tools/list` schema 与运行时约束不一致：三个上下文数组现在都声明 `minItems: 1`，并新增 parser/schema 对照测试。
- 确认并修复生成 SDK 声明落后于 Guest runtime：补齐 assets、library、folders、tags、collections、smartCollections、linkedFolders、files、trash、palettes、ui 方法，以及完整的命令 Invocation Context。
- 脚本错误被统一压成 `INTERNAL_ERROR`/`HOST_COMMAND_FAILED` 的问题需要先定义稳定错误码映射，已保留为后续设计项，没有用临时错误码掩盖它。

本轮新增验证：定向 MCP/插件契约 ESLint 通过；5 个相关 unit test files、46 tests 通过。
