# RAW/ARW 预览与 Inspector 相机元信息 QA 报告

## 范围

- 工单：`Serpent-a6f74d`
- 分支：`dev`
- 基线：`84770f5`
- 当前提交：工作树待本地提交
- 环境：Windows 开发工作树，Node 24.x
- 结论：自动化实现证据通过；真实 RAW、Electron 查看器、packaged 和 Windows 人工旅程尚未执行，保持待人类验收

## 需求追踪

| 需求 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| RAW 不再因 OCIO 显示变换失败 | `src/worker/library-service.ts` RAW OIIO 路由 | `tests/worker/video-exr.test.ts` RAW 路由断言（4 项 RAW 用例） | mock OIIO 已覆盖；真实 ARW/RAW 未执行 |
| 卡片缩略图与查看器图像分离，且重复打开不重复生成 | `src/worker/library-service.ts` `viewer_image` + 单飞 | `tests/worker/video-exr.test.ts` RAW 并发查看器用例 | 真实 ARW Electron E2E 通过；日志重复生成根因已修复 |
| 缩略图可供 Inspector 使用 | `src/worker/library-service.ts` thumbnail artifact | `tests/worker/video-exr.test.ts` PNG artifact 断言；真实 E2E | 真实 ARW 卡片缩略图解码通过 |
| 相机元数据受控提取并持久化 | `src/worker/raw-image-metadata.ts`、`library-service.ts` | `tests/unit/raw-image-metadata.test.ts`（2 项）、`tests/worker/video-exr.test.ts` | IPC/协议路径由现有 extracted-metadata 接口承载；真实相机样本未执行 |
| Inspector 在描述/作者/来源之后以低调技术栏显示目标字段，并将 RAW 作者回填既有作者输入 | `src/renderer/InspectorPanel.tsx`、`raw-image-metadata-format.ts` | `tests/unit/raw-image-metadata.test.ts`（字段格式化）；`tests/e2e/raw-image-preview.test.ts`（技术栏与作者输入） | 真实窗口视觉验收未执行 |

## 命令记录

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过；`tsc --noEmit` 与 extension 配置均退出 0 |
| `npx vitest run --config vitest.config.ts tests/unit/raw-image-metadata.test.ts tests/unit/media-formats.test.ts tests/unit/video-metadata-format.test.ts` | 通过；3 个文件、19 项通过 |
| `npm run test:library-availability` | 通过；9 个文件、198 项通过、1 项跳过；Electron ABI 检查与 FTS5 均通过 |
| `npm run lint` | 未全绿；既有 `src/main/session-log.ts` 1 项、`src/worker/library-service.ts` 4 项错误及 `App.tsx` 1 项既有 warning；本次修改文件（排除该既有大文件）定向 ESLint 通过 |
| `node scripts/run-e2e-isolated.mjs tests/e2e/media-preview.test.ts` | 未通过；3 项中 2 项失败、1 项跳过：既有色卡预览等待超时、视频查看页关闭按钮被内容层拦截；未包含真实 RAW 样本，不作为 RAW 解码证据 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts tests/unit/raw-image-metadata.test.ts tests/unit/media-formats.test.ts` | 47/51 Worker 用例通过；4 个既有媒体组件自动修复/探测节流用例失败，RAW 用例（含并发查看器）通过 |
| `$env:SERPENT_REAL_RAW_TEST_FILE='E:\\Media\\Images\\Photos\\2026\\2026-02-09\\ZKH09734.ARW'; node scripts/run-e2e-isolated.mjs tests/e2e/raw-image-preview.test.ts` | 通过；1 项真实 Electron E2E，包含导入、缩略图解码、Inspector 技术栏、作者回填和查看器图像解码 |

## 未执行与风险

- 真实 ARW 已完成开发态 Electron 导入 → 缩略图 → Inspector → 查看器旅程；仍需人工
  视觉确认全尺寸图像的细节与色彩是否符合预期。
- packaged、Windows 打包产物和人工视觉验收未执行。
- mock spawn 只证明参数和 artifact 状态，不替代真实 OIIO 二进制证据。
- `npm run test:library-availability` 的 Electron ABI 与 FTS5 probe 通过。

## 人工验收入口

见 [`human-acceptance-checklist.md`](human-acceptance-checklist.md) 中
`RAW-INSPECTOR-001 / Serpent-a6f74d`。该条目保持“待人类验收”，不能由自动化结果改为
“人类验收通过”。
