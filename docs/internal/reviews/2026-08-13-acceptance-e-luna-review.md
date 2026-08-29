# 2026-08-13：A–E 收口后的 Luna 独立审查

审查模型：`gpt-5.6-luna`
审查范围：当前工作树的 MCP、插件工具目录、框选回调及 Windows/打包风险
审查方式：只读静态审查；未修改代码、未提交；Windows、packaged 和真实 Computer Use 未执行。

## 发现与处置

### P1：插件 MCP 工具目录依赖 Desktop 活动资源库（已修复）

审查发现 `PluginMcpToolProvider.list()` / `isKnown()` 通过 `getLibraryId()` 回退当前 Desktop 资源库，导致无库或切库时 `tools/list` 变化，违反 ADR-0031 的静态目录和业务无状态要求。

修复：无参数 `list()` / `isKnown()` 改为从全部已注册 MCP 插件贡献生成静态目录；只有带显式 `libraryId` 的 `tools/call` 才按目标资源库验证活动插件实例；Provider 的直接调用增加暴露开关防线；Main 不再向 Provider 注入 Desktop 当前库解析器。

证据：`tests/unit/plugin-mcp.test.ts` 定向测试通过；`npm run typecheck` 通过。多库、无活动库、Windows/packaged 仍未执行。

### P2：未知工具的错误码可能被插件参数解析遮蔽（已修复）

审查发现 `call-tool.ts` 在确认工具命名空间前先解析 `libraryId`，未知工具可能错误返回 `MCP_LIBRARY_TARGET_REQUIRED`，而不是 `MCP_TOOL_NOT_FOUND`。

修复：先区分核心 Registry 工具、已知插件工具和未知工具；仅对已知插件工具解析显式 `libraryId`，并新增未知工具回归测试。

证据：`tests/unit/plugin-mcp.test.ts` 与 MCP 适配器定向回归通过。

### P2：框选回调的 Hook 依赖警告（已修复）

审查发现 `useAssetSelection` 的 `useCallback` 使用了未列入依赖数组的 `applyMarqueeBoxStyle`。

修复：将直接 DOM 样式写入器稳定为 `useCallback`，并把它纳入框选开始回调依赖；定向 ESLint 不再报告该 warning。

### Windows 原子配置写入风险（已主动修复）

审查范围还确认插件 MCP 暴露配置的普通 `rename(staging, destination)` 在 Windows 可能无法覆盖已有文件。现已改为复用 Main 统一的 `writeAtomicJsonFile` / `readAtomicJsonFile`，保留可恢复备份和瞬时锁重试策略。Windows 实机仍未验证。

### MCP 取消、History 原子性和 Windows 视频路径（保持未关闭）

以下不是本轮小修复，继续由既有 P1 工单跟踪：

- `Serpent-8b5b.11`：取消未贯穿 Worker，缺少 durable Job 查询/取消与断线恢复；
- `Serpent-5n4z.15`：文件副作用、History receipt 与 Undo/Redo transition 崩溃恢复未形成原子闭环；
- `Serpent-3xlr`：Windows FFmpeg `fontfile` 路径转义和视频 AI 实机验证未完成。

## 自动化证据

- MCP/框选相关 6 个单测文件：50 tests passed；
- `npm run typecheck`：通过；
- 定向 ESLint（本轮修改文件）：0 errors、0 warnings；
- `git diff --check`：通过。

结论：本轮审查发现的可局部修复问题已处理并有测试；当前项目仍不能宣称 Windows、packaged、Worker 崩溃恢复、持久 Job 或全量发布验收完成。
