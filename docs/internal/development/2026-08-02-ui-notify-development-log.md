# 2026-08-02 脚本/MCP/插件 ui.notify

## 范围

`Serpent-99zs`：脚本、MCP、插件可向桌面用户发出冷静提示或阻塞弹窗。

## API

- Gateway / MCP：`ui.notify` / `serpent_ui_notify`
- Guest：`serpent.ui.notify({ severity, message, mode?, title? })`
- `severity`: `info` | `warning` | `error`
- `mode`: `toast`（默认，顶部条）| `dialog`（阻塞确认，遵守 0004 冷静标题）
- 能力 / 插件权限：`ui.notify`
- 无需绑定资源库即可调用

## 验证

```text
npx vitest run tests/unit/automation-command-gateway.test.ts
```

## 相关工单

- 回归测试（Composer 2.5）：`Serpent-l2tj`
- 全局插件不依赖开库：`Serpent-2qsq`
