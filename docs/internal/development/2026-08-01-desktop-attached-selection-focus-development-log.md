# 2026-08-01 Desktop Attached MCP：Focus 与 Selection 开发日志

> 规格：`docs/internal/superpowers/specs/2026-07-31-desktop-attached-mcp-design.md`
> 计划：`docs/internal/superpowers/plans/2026-08-01-desktop-attached-selection-focus.md`
> 工单：`Serpent-lq5y.1`；父 Epic：`Serpent-lq5y`

## 状态

- 开始时间：2026-08-01
- 当前状态：implementing
- 当前范围：本机控制面、附着确认、Focus、Renderer 实际资产选中、stdio MCP 代理
- 尚未声明完成：真实 Computer Use、packaged、Windows、跨完整进程重启验证

## 已实现增量

- `src/shared/desktop-control.ts` 定义版本化、严格校验的本机控制协议、附着握手、Focus/Selection 工具参数与 Renderer 事件。
- `src/main/desktop-control-plane.ts` 使用本机 Unix domain socket（Windows 使用 named pipe 路径），写入当前 userData 的随机 nonce 元数据，按连接执行握手和长度受限 JSON 帧解析。
- `src/main/desktop-attached-mcp.ts` 将已附着会话绑定到当前 Desktop 的激活资源库和 Main-owned `AutomationExecutionJournal`；领域工具仍走 Registry/Gateway，Desktop-only 工具只走 UI 控制面。
- `src/renderer/use-desktop-automation-selection.ts` 复用现有选中数组、主资产和 selection anchor；Selection 不发 Worker 请求，不产生 `entity_version`、内容 `revision`、文件计划或 Undo Group。
- `scripts/run-mcp.mjs` 默认走附着代理；`--headless` 保留既有无界面 MCP 启动方式。
- `serpent_desktop_focus` 恢复并聚焦 Serpent 主窗口；`serpent_desktop_select_assets` 支持 `replace`、`add`、`remove`。

## 验证证据

2026-08-01 执行：

```text
npx vitest run tests/unit/desktop-automation-selection.test.ts
```

结果：1 个测试文件、4 个测试通过。

```text
npx vitest run tests/unit/desktop-automation-selection.test.ts tests/unit/desktop-control-plane.test.ts
```

受限沙箱首次运行因 Unix socket `EPERM` 未执行；在本机权限下重跑结果为 2 个测试文件、6 个测试通过。

```text
npm run typecheck
npm run lint
```

结果：均通过。

```text
node scripts/run-e2e.mjs tests/e2e/automation-mcp-attached-desktop.test.ts
```

结果：1 passed (8.5s)。测试启动真实 Electron Desktop，再通过 `scripts/run-mcp.mjs`
的 stdio 代理附着到同一 Main/Worker；`tools/list` 暴露 Focus/Selection，Focus 调用成功，
Selection 的 `replace` 调用使当前网格两张资产均出现原有 `aria-pressed="true"` 选中态。
该 E2E 使用 `SERPENT_E2E_DESKTOP_CONTROL=1` 和隔离 userData；正常既有
`automation-script-rating` E2E 也已回归通过（1 passed）。

随后在补充结果无绝对路径断言后重跑同一命令，结果为 `1 passed (7.5s)`。

`npm run verify:mainline` 的综合 E2E 在既有 `asset-ingestion`、`asset-pagination`、
`browsing-preferences`、`desktop-ingestion` 等路径出现约 30 秒 UI 等待超时；单独重跑
`node scripts/run-e2e.mjs tests/e2e/asset-ingestion.test.ts` 仍复现既有测试在
`getByRole('menuitem', { name: '导入文件' })` 等待超时（1 failed, 2 passed），而附着
MCP 定向 E2E 同时保持通过。该综合门禁未完成，不将其记为通过；失败目前只能归档为
与本增量无直接关联的既有 E2E/环境稳定性问题，后续需单独建立修复工单和根因证据。

## 已知边界

- Selection 事件只在附着会话绑定的当前资源库内生效；当前实现不自动改变 Desktop 的浏览范围。未加载到当前网格的 ID 不应被报告为“已可见”，需通过 E2E 与后续 reveal 设计继续收口。
- 默认附着启动器需要使用当前 Desktop 的 userData；headless 模式仍是指定资源库和 CI 的稳定入口。
- Windows named pipe、packaged 应用、本机真实窗口抢焦点和 Computer Use 尚未验证。
- 长路径 userData 下 macOS Unix socket 可能返回 `EINVAL`/`ENAMETOOLONG`；控制面已回退到
  `127.0.0.1` 的随机端口，并仍使用 userData 中的随机 nonce 完成附着鉴权。
