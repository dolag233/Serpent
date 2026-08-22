# MCP Agent 连接信息复制开发日志（2026-08-22）

## 背景

设置 → MCP 的客户端凭据行原来把“复制”实现为创建一个新的凭据副本，并把客户端配置写入剪贴板。这个结果不适合直接交给 Agent，也会让凭据列表不断出现难以理解的副本。

客户端凭据需要在创建后保持固定，重复复制不能让旧 Agent 失效。因此凭据文件继续保存 token 哈希用于认证，同时使用当前用户可访问的凭据 pepper 加密保存 token，复制时解密并重新生成连接文本；明文 token 不会进入 Renderer 或日志。

## 实现

- 新增 `copy-agent-connection` 设置请求；复制已有凭据时重新输出同一 credential 的固定 token，不轮换授权，也不创建副本行。
- 新增 Agent 连接信息文本：endpoint、Streamable HTTP、`Authorization: Bearer ...`、所选客户端配置，以及 `initialize`/`tools/list`、`libraryId` 和危险操作二次确认提示。
- MCP `initialize` 响应新增服务器使用说明，让支持 MCP instructions 的 Agent 在建立连接后自动获知工具发现、`libraryId` 和关键操作确认规则。
- 新建客户端时也复制同样的 Agent 连接信息；客户端配置仍保留为文本格式化器的独立输出。
- 中文/英文设置文案、用户自动化指南、MCP API 参考和内部验收清单同步更新。

## 验证

- `npm run typecheck`：通过。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/mcp-client-config.test.ts tests/unit/mcp-client-credentials.test.ts tests/unit/embedded-mcp-server.test.ts`：3 个文件、17 个测试通过。
- `git diff --check`：通过。

## 待人类验收

在真实桌面设置页创建一个 MCP 客户端，点击客户端行复制图标，将剪贴板内容发送给 Agent；确认 Agent 能按文本中的 endpoint、Bearer 授权和说明建立连接，并确认重复点击复制后原 token 仍然有效、列表中不增加副本。

## 2026-08-23 UI 跟进

- 客户端凭据区改用标准 `SettingsCard` 标题/说明/操作区结构。
- 将 Agent 交接说明放入设置卡片的灰色辅助文字，并明确复制文本后可直接粘贴给 Agent 操控 Serpent。
- 凭据改为独立条目卡片，避免名称、权限说明和操作按钮挤在同一条横带；窄窗口下操作区自动换行。
- `npm run typecheck`、MCP 设置页 ESLint 与 `git diff --check` 通过。
