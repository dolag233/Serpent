# 2026-08-01：脚本 / MCP 收口（开发态编码侧）

## 范围

`codex/plugin-runtime-management`：收口 Automation 脚本与 MCP（含 Desktop 附着浏览），不加宽插件，不处理产品化 like/过滤 UI。

## 本回合落地

1. **跨文件夹 reveal E2E**：`tests/e2e/automation-mcp-attached-desktop.test.ts` 在同范围 viewer/过滤/选中路径之后，将两资产分别移入不同托管文件夹，打开文件夹 A 后 `serpent_desktop_reveal_asset` 目标在 B，断言 `status: "switched-folder"`、网格选中与 `get_state`。
2. **Reveal 根因修复**：`chooseFolder` 内 `clearAssetSelection` → `onSelectionCleared` 会清掉 `pendingRevealRef`，导致跨文件夹 reveal 只切范围不选中。改为在 `switch-folder` 路径于 `chooseFolder` 返回后直接应用选中与 focus。
3. **文档对齐**：`docs/manual/scripts/development.md` 与 `docs/skills/serpent-automation/SKILL.md` 列出完整 `serpent_desktop_*` 工具面，并说明 `scripts/mcp-session.mjs` 长连接；`package.json` 增加 `mcp:session`。
4. **工单卫生**：关闭 `Serpent-lq5y.1` / `Serpent-lq5y.2`（开发态编码 AC）；`y51c.3/.8/.9/.10` 保留，因 packaged（`media:verify`）、Windows、Computer Use 仍为验证缺口。

## 验证

- **Computer Use：已通过**（2026-08-01 产品负责人确认）。

## 明确仍未完成

- `npm run package`（darwin-arm64 媒体 artifact 未晋升）
- Windows
- 跨分页/深列表 reveal fixture
- 插件 Epic `Serpent-upsn` 加宽（产品顺序：脚本收口后再推进）

## 测试

```bash
npx vitest run tests/unit/desktop-browse-reveal.test.ts tests/unit/desktop-browse-control.test.ts tests/unit/desktop-browse-discovery.test.ts tests/unit/desktop-control-mcp.test.ts tests/unit/automation-worker-adapter.test.ts
# 14 passed

node scripts/run-e2e.mjs tests/e2e/automation-mcp-attached-desktop.test.ts
# 1 passed（含跨文件夹 switched-folder）
```

未跑全量 `verify:mainline`。
