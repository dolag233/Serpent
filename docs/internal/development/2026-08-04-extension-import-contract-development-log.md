# EXT-002 扩展保存与普通导入契约对齐

## 范围

工单：`Serpent-u9yv`（EXT-002）。目标是让浏览器扩展的 URL 保存和浏览器上传保存进入与桌面普通导入相同的导入内核，不再维护一套 extension 专用的落盘、查重、冲突和恢复旁路。

## 实现

- URL 下载仍在扩展边界执行独立的 HTTP 安全检查：协议、凭据、DNS/重定向、响应状态、Content-Type、大小、魔数和扩展名校验。
- 下载完成后只保留一个临时源文件，随后调用 `saveAssetFromFile`。
- 浏览器上传路径继续执行本地文件、MIME 和魔数校验，然后将临时源文件交给 `prepareOrExecuteImport`。
- 两条扩展路径现在共同使用 `prepareImport` / `resolveImport`，因此共享：
  - 目标路径规范化；
  - 库级重复内容跳过；
  - 同名内容保留两份时的自动改名；
  - file operation journal、写入 lease、回滚和启动恢复；
  - `sourcePageUrl` 元数据写入；
  - 导入完成后的资产变更通知。
- 扩展边界仍保留“重复默认跳过、同名不同内容默认保留两份”的既有产品决策；交互层若需要用户选择，继续使用普通导入的 conflict plan/resolve 协议。

## 回归测试

`tests/worker/extension-save.test.ts` 新增了浏览器上传的契约回归：同内容不同文件名返回原资产且不产生重复，不同内容同名自动保留两份，并分别验证来源页面元数据。

本次证据：

- `npx vitest run --config vitest.config.ts tests/worker/extension-save.test.ts`：55/55 通过；
- `npx eslint src/worker/library-service.ts tests/worker/extension-save.test.ts`：通过；
- `npm run typecheck`：通过；
- `git diff --check`：通过。

测试过程中仅修复了本机 `better-sqlite3` 的 Node ABI（依赖环境问题），没有修改依赖版本或提交生成物。

## 尚未宣称完成的证据

代码和 Worker 自动化证据已具备，但 EXT-002 仍保留“待人类验收”：需要在真实扩展中分别验证 URL 下载与防盗链上传、同内容重复、同名不同内容、目标文件夹和与普通导入的行为一致性。packaged/Windows 矩阵也尚未执行。
