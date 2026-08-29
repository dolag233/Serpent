# 2026-08-15 文档同步开发日志

## 范围

- 工单：`Serpent-6kcv`（同步用户与扩展文档到当前功能）。
- 对照当前源码、用户更新后的 `docs/assets/ui` 截图和现有产品/开发文档，重写用户指南中易过时的安装、基础操作、扩展、排障页面。
- 新增搜索与过滤指南，记录高级搜索语法、字段别名、过滤维度、AND/OR 规则和 Shift 多选行为。
- 新增 AI 分析中英文指南，覆盖 BYOK 配置、五种 API 格式、图像/视频/3D 输入边界、自动/手动分析、队列、重试、AI 与人工内容分层以及隐私成本提示。
- 扩充插件、自动化脚本和 MCP 的安装、信任、运行模式、卸载数据、限制、loopback HTTP 连接、credential 撤销和权限模式说明。
- 同步产品简报、脚本/插件手册、MCP 入口说明、AI 领域模型和验收清单中已确认的术语；历史切片保留为历史证据并在入口处标注当前实现提示。
- 将用户更新的截图接入文档，移除已删除的旧截图引用，并扩充搜索帮助 tooltip 以保持 UI 与文档一致。

## 当前实现核对要点

- 搜索解析器支持空格 AND、`|` OR、前缀 `-` 排除、引号短语和字段别名；过滤器不同维度 AND、同维度多值 OR，颜色/标签/评分/格式/形状预设支持 Shift 多选。
- 插件分为 restricted QuickJS 和 unrestricted Node UtilityProcess；Safe Mode 只暂停 unrestricted。资源库插件首次启用需要设备信任，全局插件自动信任，卸载不会自动清理插件数据。
- MCP 为桌面内嵌的 loopback Streamable HTTP 服务，默认 `127.0.0.1:47342/mcp`；库级调用显式传 `libraryId`，插件 MCP 工具只在 Full Access 且逐项暴露后可见。
- AI MVP 为云端 BYOK，不提供本地模型；自动分析开关默认关闭。图像可直接处理源图，视频使用联系表，3D 使用四视图，音频和文本不支持。

## 验证

- Markdown 图片引用扫描：`NO_BROKEN_IMAGE_REFS`。
- 用户指南、手册、产品简报和资产 README 的本地链接扫描：`NO_BROKEN_USER_DOC_LINKS`。
- `git diff --check`：通过（仅有 Git 的行尾转换提示，无 whitespace error）。
- 本次是文档、截图引用和 i18n 提示同步，未运行完整测试套件；Windows/macOS packaged 与真实外部 AI 服务仍需按验收清单由人工验证。

## 已知限制

- 当前 Renderer 对多选 AI 全部失败仍可能显示更醒目的失败提示，不能在文档中承诺所有失败都为非阻断 warning。
- 视频/模型的自动分析依赖派生输入就绪事件；应用在事件窗口重启时可能需要从后台任务面板重试，跨平台与 packaged 证据仍以验收清单为准。
- `docs/internal/implementation` 中部分切片是历史设计，旧的 Label、stdio MCP、旧供应商列表等内容仅作为迁移证据，不是用户操作指南。
