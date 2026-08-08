# 插件资产内容原地替换开发日志

> 日期：2026-08-01  
> 工单：`Serpent-pn7k`（已认领，未关闭）  
> 状态：开发态实现与定向自动化验证

## 需求

通过 Automation Gateway 按 `assetId` 原地替换托管资产文件字节。插件和脚本只传稳定资产 ID 与有界 base64 数据，不接触绝对磁盘路径；文件写入前需要 Execution Plan 确认，完成后创建 `origin: 'replace'` 修订、失效旧衍生物并重新入队支持的缩略图。

## 四列追溯

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| `content.write` 权限与 Gateway descriptor | `src/plugins/plugin-manifest.ts`；`src/automation/command-registry.ts`；`src/plugins/plugin-permission-capabilities.ts` | `tests/unit/automation-command-gateway.test.ts`；`tests/unit/plugin-runtime-utility-protocol.test.ts` | 开发态定向验证；真实 Electron/packaged/Windows/Computer Use 未执行 |
| `asset.content.replace` 计划审批与 opaque proof | `src/main/automation-file-plan-approval.ts`；`src/main/index.ts`；`src/worker/library-service.ts` | `tests/unit/automation-file-plan-approval.test.ts` | 待人类验收：`PLUGIN-033`；桌面确认对话框未由 Computer Use 验证 |
| 托管文件原子替换、修订和缩略图入队 | `src/worker/library-service.ts`；`src/worker/index.ts`；`src/shared/protocol/{requests,responses}.ts` | `tests/worker/asset-metadata-revision.test.ts` | 当前开发态 Worker 测试；媒体实际解码、完整重启和平台矩阵未执行 |
| 标准 Guest SDK `serpent.assets.replaceContent` | `src/scripting/quickjs-sandbox-prototype.ts`；`src/shared/automation-script-api.ts`；`src/automation/command-registry.ts`；`src/plugins/plugin-sdk.ts` | `tests/unit/quickjs-sandbox-prototype.test.ts` | 标准 Host 接缝已覆盖；真实插件安装/信任旅程未执行 |

## 重要实现决定

- 输入使用最多约 32 MiB 解码字节的 base64 上限；Worker 仍执行严格 base64 格式和解码后大小校验。
- 文件名和扩展名保持资产现有值；`mimeHint` 仅停留在 Gateway 输入契约中，MVP 不据此重分类或改名。
- 只允许 managed、available、未回收资产；linked、missing、trashed 资产拒绝写入。
- 使用临时文件写入、`fsync` 和同目录 `rename`；旧修订的 `revision_artifacts` 统一失效，新修订固定使用 `origin: 'replace'`。
- 缩略图支持由现有 `LibraryService.supportsThumbnail` 判断，队列复用 `enqueueThumbnailJobs`。

## 验证

实际执行：

```bash
npx tsc --noEmit
npx vitest run tests/unit/automation-command-gateway.test.ts tests/unit/automation-file-plan-approval.test.ts tests/unit/quickjs-sandbox-prototype.test.ts tests/unit/plugin-runtime-utility-protocol.test.ts
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/asset-metadata-revision.test.ts
```

结果：`tsc` 通过；4 个 Gateway 单元测试文件共 70 个测试通过；Electron ABI Worker 测试文件共 2 个测试通过。直接使用 Node ABI 运行 Worker 测试会因 `better-sqlite3` 的 Electron/Node ABI 差异失败，因此按仓库脚本使用 Electron ABI 执行。

未执行完整 `npm test`、`test:e2e`、`verify:mainline`、packaged、Windows 和 Computer Use。MCP 工具仍保持 `public: false`；大文件分块/流式 staging 尚未实现；`content.read` 尚未实现。

## 人类验收

新增 `PLUGIN-033`，保持“待人类验收”状态。
