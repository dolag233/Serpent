# 2026-07-19 External URL / active-context IPC 开发日志

工单：`Serpent-1pd`

## 问题

`openExternalUrl` 把 unauthorized sender / malformed request / rejected URL / shell failure 压成 `boolean`；`active-context` malformed 静默丢弃。Renderer 无法给出可操作原因，Main 也缺少不含敏感 URL/payload 的结构化失败日志。

## 方案

1. `src/shared/external-url.ts`：公开错误码 `unauthorized_sender | malformed_request | rejected_url | shell_failure`；`resolveOpenExternalUrlTarget` 纯校验；`parseOpenExternalUrlResult` 兼容旧 boolean。
2. Main `OPEN_EXTERNAL_URL_CHANNEL`：返回结构化结果；`logger.info/error` 只带 `code`（及 shell 异常序列化），不写 URL。
3. Main `ACTIVE_CONTEXT_CHANNEL`：`tryParseActiveContext`；失败记 `issuePaths`（仅 zod path，不含字段值）；unauthorized sender 同样记 code。
4. Preload / Renderer：按 code 映射 toast（拒绝链接 / 窗口未授权 / 系统浏览器失败）。

## 测试

```bash
node scripts/run-vitest-with-electron.mjs tests/unit/external-url-ipc.test.ts
# 5/5 passed
```

覆盖：URL 接受/拒绝、malformed vs rejected、结果解析与 legacy boolean、active-context issuePaths 不含 payload 值。

## Computer Use

未执行（本环境无桌面控制能力）；用户可见路径交 `SHELL-021` 人类验收。

## 人类验收

- `SHELL-021`：源链接打开失败可操作提示
