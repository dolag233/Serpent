# 2026-08-01 插件设置 IA 与列表样式

## 范围

设置中心插件管理 UI：侧栏「插件设置」、卡片信息层级、非受限默认不启用、刷新/设置/卸载图标操作、MCP 声明即暴露。

## 行为

1. **设置 → 插件**：安装与启用管理；卡片标题为 `名称 - v版本`；来源为文件夹/GitHub 图标；权限为圆圈感叹号 hover；无「已/未启用」文案、无受限模式标注；非受限为偏黄警告色 + 警告图标文案；空列表仅「暂未安装插件」。操作区为刷新 → 设置 → 垃圾桶卸载 → 启用开关。
2. **设置 → 插件设置**（侧栏分类列表最后一项，可展开，不换行）：列出有 `settings.sections` / `settings.pages` 的插件；点选后进入详情。
3. **非受限包**：首次无 Resolution 记录时 `resolve` 返回 `disabled/user-disabled`；用户可见文案统一为「非受限模式」（wire 仍为 `unrestricted`）。
4. **MCP**：`commands[].mcp.export`（及顶层兼容声明）在插件激活后默认出现在 MCP tools/list，可直接 tools/call；设置页不再提供暴露开关。

## 文档

- `docs/plugin-development-guide.md`：非受限命名与默认不启用；设置入口。
- `docs/qa/human-acceptance-checklist.md`：`PLUGIN-001`、`PLUGIN-031`。

## 验证

```text
npx vitest run tests/unit/plugin-package-manager.test.ts \
  tests/unit/plugin-settings-nav.test.ts \
  tests/unit/plugin-mcp.test.ts \
  tests/unit/plugin-manager-response-parse.test.ts
```

未执行：真实 Electron UI、packaged、Windows、Computer Use。
