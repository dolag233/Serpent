# 切片 0009 QA 报告：云端 AI 自动分类（BYOK）

> 状态：QA 不完整 / Spec 未通过
> 日期：2026-07-13

## 测试对象

- 分支：`codex/slice-002-asset-ingestion`
- 原始固定范围：`8dc2470...cdc2247`
- 本轮对象：2026-07-13 共享未提交 working tree
- 环境：macOS arm64，Node 24.15.0，Electron 43.1.0
- 所有供应商响应由 mock `fetch` 生成；未使用真实 OpenAI/Gemini/Anthropic 账户或 API Key。

## 阶段自动化证据

| Gate | 结果 |
| --- | --- |
| Unit | **139/139 通过**（含队列 scheduler/abort runtime） |
| Worker | **408/408 通过** |
| 三供应商 adapter / AI 写入 / queue 状态测试 | 包含在上述通过结果中，均为 mock 证据 |
| Lint / typecheck | 通过 |
| 全量 Electron E2E | **10/10 通过** |
| package / verify / packaged E2E | 通过；packaged startup/import **1/1** |

阶段数字只证明当前共享工作区的一次测试结果，不能单独支持 MVP 或本切片验收。

## 验收矩阵

| 场景 | 结果 |
| --- | --- |
| safeStorage 密文落盘，配置响应不返回已存 Key | 自动化/静态通过 |
| OpenAI/Gemini/Anthropic 请求形状与结构化解析 | mock 契约通过；真实端点未验证 |
| 认证/权限/额度/限流/网络/超时/无效响应分类 | mock 自动化通过 |
| re-analysis 原子替换启用的 AI 字段/标签，不删除人工层 | Worker 自动化通过 |
| 托管与链接资产导入后自动入队 | Worker/Main 自动化与静态证据通过 |
| 超过 20 项后自动继续排空 | scheduler unit 通过 |
| 临时失败指数退避并最多重试两次 | scheduler/Worker unit 通过 |
| pause/cancel 中止活动 fetch | AbortSignal unit/adapter mock 通过 |
| pause/cancel 后迟到结果不写入 | transaction guard Worker 测试通过 |
| Worker shutdown 中止活动 AI 请求 | 静态实现存在；未做真实长请求进程 QA |
| 用户看到具体安全错误，同时 `serpent.log` 有完整去敏原因链 | 自动化通过：保留失败分类、供应商类型、HTTP 状态和系统错误码；Key、Bearer 与 URL 查询凭据被遮蔽 |
| 完整队列计数、暂停/继续/取消/重试/范围/清空 UI | **未实现/未验证** |
| 默认同供应商最大并发 2 | **未实现，当前顺序消费** |
| 图片使用缩略图而非源文件上传 | **不符合规格，当前读取源文件** |
| macOS packaged app 真实供应商图片/视频分析 | **未执行** |
| Windows safeStorage、代理、防火墙、取消和打包行为 | **未执行；无 runner** |

## 数据与费用人工 QA 缺口

- 未验证首次免责声明、更新 Key、自动分析开关和实际上传提示在真实交互中的完整性。
- 未使用真实供应商检查失败日志；mock/单元证据已覆盖 HTTP 状态与底层系统错误的去敏保留。
- 未在真实大图、EXR/TGA 或长视频联系表上验证请求大小、供应商格式接受度、超时和费用风险。
- 未测试供应商在线模型 ID 漂移、账户地区限制、代理网络、429 `Retry-After` 或服务端 5xx。
- 未验证关闭资源库时 running job 的真实网络中止；当前明确覆盖的是 pause/cancel/Worker shutdown 的机制。

## 最终结论

**不通过验收。** 队列自排空、退避、取消中止、写入 guard、错误分类、去敏持久日志和 BYOK 主安全边界已有良好的自动化证据，但用户可用的完整队列 UI、并发要求、图片输入策略、真实供应商与 Windows QA 尚未完成。切片保持 **部分实现 / fixing**。
