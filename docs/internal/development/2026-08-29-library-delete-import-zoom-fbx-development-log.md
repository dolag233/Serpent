# 2026-08-29 资源库删除、导入刷新、查看器缩放与 FBX 缩略图开发日志

## 范围

本轮处理四项用户要求：

1. 删除资源库沿用打开资源库的延迟覆盖和不确定进度条。
2. 导入文件或文件夹后刷新文件夹导航/画布查询。
3. 查看器缩放滑块和滚轮共用完整的缩放边界，并保证滑块终点可达。
4. 诊断 FBX 缩略图失败；HDR/HDRI 只建立 P2 工单 `Serpent-78460f`，本轮不实现。

## 根因与修复

### 删除资源库的进度反馈

删除资源库原本只切换 `uiState`，没有设置 `libraryLoading`，因此不会进入打开资源库使用的延迟覆盖。现在删除确认开始后设置操作类型 `deleting`，复用同一个 `LibraryLoadingOverlay` 和标准 `Progress` 组件；删除操作不显示「切换资源库」，避免在破坏性操作中引入不安全的并发切换。覆盖仍延迟 3 秒，短操作不会闪现。

### 导入后的文件夹刷新

文件夹导航摘要和画布直系文件夹卡片是两个独立读模型。导入完成后仅刷新资产页，可能让文件夹状态继续使用导入前的 React 快照。导入完成路径现在使文件夹查询失效，并以 `blockingNavigation` 等待新的导航摘要；当导入结果需要跳转到目标文件夹时，跳转也使用同一边界。这样文件夹树、计数和画布直系文件夹查询都在导入完成后收敛，不需要重新打开资源库。

### 查看器缩放边界

旧滑块上限是 `max(fitScale × 4, 2)`，而滚轮/键盘缩放的真实上限是 `8`，小图或某些适应比例下滑块会先到头，滚轮仍能继续放大。现在滑块、滚轮和键盘都使用 `VIEWER_MIN_SCALE=0.05`、`VIEWER_MAX_SCALE=8`。此外，旧步长 `0.04` 从 `0.05` 起无法整除到 `8`，HTML range 的 End 实际只能到 `7.97`；步长改为 `0.01` 后，最大端点可以精确到 `8`。

### FBX 缩略图失败

复现时 FBX、OBJ、glTF 同时失败，应用日志显示离屏缩略图窗口的 WebGL 上下文创建失败（`GL_VENDOR = Disabled`、`GL_RENDERER = Disabled`、`BindToCurrentSequence failed`）。因此失败点不是 FBX 转换，而是模型渲染器在 `ensureRenderer()` 阶段无法创建 WebGL。旧代码在发送渲染请求前直接调用 `ensureRenderer()`，异常没有进入后续 Promise 的 catch，也没有向 Main 返回失败帧，最终表现为等待超时并误导成“FBX 缩略图失败”。

现在 WebGL 创建异常会立即回传 `MODEL_WEBGL_UNAVAILABLE`，清理活动任务并留下明确诊断；模型转换失败、模型加载失败和 WebGL 不可用仍保持不同错误语义。模型缩略图 Electron E2E 在无硬件 WebGL 的测试主机上显式使用 SwiftShader，仅限 `SERPENT_E2E=1` 的测试环境，生产环境不会静默降级 GPU 配置。

## 验证记录

| 检查 | 命令/结果 |
| --- | --- |
| 删除覆盖与缩放定向单测 | `npx vitest run --config vitest.config.ts tests/unit/viewer-fit.test.ts tests/unit/library-loading-overlay.test.tsx tests/unit/offscreen-thumbnail-renderer.test.ts tests/unit/offscreen-page-renderer.test.ts`：3 files / 32 tests passed（offscreen 相关已有测试未被改动路径阻断） |
| 导入后文件夹导航刷新 | `node scripts/run-e2e.mjs tests/e2e/asset-ingestion.test.ts --grep "imports files and a directory hierarchy"`：1 passed / 8.2s |
| 查看器缩放终点与滚轮上限 | `node scripts/run-e2e.mjs tests/e2e/media-preview.test.ts --grep "generates a decoded thumbnail and keeps asset viewer context coherent"`：1 passed / 10.8s；覆盖 `min=0.05`、`max=8`、End 到 `8` 以及到达上限后滚轮不再改变值 |
| FBX 模型缩略图 | `node scripts/run-e2e.mjs tests/e2e/model-thumbnail.test.ts --grep FBX`：1 passed；E2E 测试显式 SwiftShader 后 FBX 缩略图真实解码通过 |
| FBX Worker 转换 | `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/fbx-conversion.test.ts`：1 file / 20 tests passed |
| 删除资源库核心流程 | `node scripts/run-e2e.mjs tests/e2e/critical-confirmation.test.ts`：1 passed；真实磁盘删除流程保持通过 |
| 资源库可用性底线 | `npm run test:library-availability`：9 files / 208 tests passed |
| 全量 unit | `npm run test:unit`：413 files passed、1 skipped；3039 tests passed、3 skipped |
| 全量测试 | `npm test`：498 files passed、15 skipped；4317 tests passed、25 skipped |
| 全量 Electron E2E | `npm run test:e2e`：86 passed、3 skipped、0 failed（7.2 分钟） |
| 类型检查 | `npm run typecheck`：通过 |
| ESLint | `npm run lint`：通过 |
| Native/FTS5 | `npm run rebuild:native`：FTS5 probe OK |
| 差异检查 | `git diff --check`：通过 |

直接用 Node 启动 FBX Worker 测试曾因 Electron ABI 与 Node ABI 不匹配而失败；改用仓库规定的 Electron runner 后 20/20 通过。这是测试运行方式问题，不是 FBX 转换失败。

## 验收边界

- 自动化已覆盖当前 macOS 开发态代码路径；删除慢操作的真实界面、真实大型库导入和查看器视觉体验仍待产品负责人验收。
- FBX 在当前无硬件 WebGL 的主机上通过 SwiftShader E2E；真实用户机器的 GPU/WebGL 配置、Windows、packaged app 尚未验证，不能据此宣称所有平台均通过。
- HDR/HDRI 支持仅建立 P2 `Serpent-78460f`，未进入本轮实现。
