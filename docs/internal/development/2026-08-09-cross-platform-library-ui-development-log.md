# 2026-08-09 跨平台资源库与壳层收口开发日志

## 范围

- 修复跨平台 ZIP 资源库导入时的源文件时间戳漂移：导入器在打开库前按数据库 revision 的 `modified_at` 恢复同尺寸托管资产的 mtime，避免首次对账误判为外部修改并使已有缩略图失效；普通文件夹复制则保留源文件 mtime，仍让真实内容变更进入正常对账。
- 新建文件夹、合集、智能合集后直接进入新对象。
- 标签管理和插件侧边栏不显示仅对资产网格有效的卡片缩放/视图工具。
- macOS 原生菜单使用与 Windows 自绘主菜单相同的命令清单（文件、编辑、资源库、窗口、关于、设置），由 Main 通过受限 IPC 转发给 Renderer。
- ZIP 导出默认名在 Main 侧增加 Worker 名称兜底：即使 Renderer 未带 `libraryName`，也按 `libraryId` 查询当前资源库名称，不再直接显示固定的 `serpent-library-export.zip`。
- 左侧托管文件夹拖到回收站补齐 `NavigationSidebar → App → useFolderDragDropHandlers` 回调链；删除当前浏览范围后回退资源库根目录，其余范围只静默刷新。
- 资源卡片缩略图就绪事件携带 Worker 已解析的 `width` / `height` / `durationMs`，让导入期间先加载卡片、后完成视频 metadata 时网格立即按真实比例重排，不再把竖视频锁在横向默认框里。
- 视频 AI 联系表的 FFmpeg `drawtext` 字体路径经过 filtergraph 专用转义：Windows 盘符冒号、反斜杠和引号不再被 FFmpeg 当作滤镜语法；保留时间戳 `%{pts\\:hms}` 转义。
- 用户验收：侧栏文件夹拖回收站、ZIP 导入缩略图比例通过；Windows 视频 AI 的首次单批复验后来被撤回（7 个视频仅 4 个生成 AI 分析），详见下方补偿修复记录。
- 新增 P1 工单 `Serpent-o5j3`：导入资源库已选择 ZIP 与目标保存路径后，创建本地资源库窗口仍停留在前景；应在选择完成后关闭或切换到导入进度界面。
- `Serpent-o5j3` 实现：无资源库起始页的自动打开资源库 effect 现在会在 ZIP 选择/校验/导入进度期间保持让位；导入完成事件与 `activateImportedLibrary()` 之间也保留 activation guard，直到新库真正写入当前状态后才清理进度，不会在原生选择器或导入进度之上重新挂载创建资源库窗口。
- 自动 AI 入队补齐视频与模型的媒体就绪边界：Main 监听 Worker 的 `asset.ai-input.ready` 重新入队；联系表就绪触发视频，模型缩略图就绪触发模型；模型扩展名复用共享格式注册表，避免导入后因队列时序竞态漏分析。
- `Serpent-o5j3` 导入窗口修复此前通过；视频/模型自动 AI 的首次验收已撤回：用户一次导入 7 个视频仅有 4 个生成 AI 分析。数据库证据显示其中 3 个已有 ready contact sheet 但没有 `ai.video.analysis` job，期间 Worker 重启导致一次性 `asset.ai-input.ready` 事件丢失。
- 修复：打开/恢复资源库时增加幂等的自动 AI 补偿扫描；Worker 只为已具备 AI 输入且尚未分析/入队的资产创建任务，仍在生成联系表的资产继续由 ready 事件触发。打开资源库不因 AI 配置/供应商失败而阻塞。

## 证据

- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/library-zip.test.ts`：29 tests passed；新增断言确认导入后资产 mtime 与 revision 记录一致。
- 使用隔离测试 ZIP 做临时 Electron worker 导入检查：1 test passed；导入后读取到 24 项资产、至少 20 项保持 `thumbnailStatus=ready`，且没有触发 `open.refresh-managed-assets` 诊断（临时测试文件已删除）。
- `npx vitest run tests/unit/application-menu.test.ts tests/unit/main-menu-items.test.ts`：9 tests passed。
- `npx vitest run tests/unit/library-export-name.test.ts tests/unit/protocol.test.ts`：78 tests passed；补充中文资源库名称的 `.zip` 默认名断言。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts`：Vitest 文件报告 46 tests passed；命令最终返回 1，Windows Electron wrapper 收尾时额外报告 `PostQueuedCompletionStatus: (6) 句柄无效`，因此记为“断言通过、进程收尾异常”，不是完整绿灯。覆盖 Windows filter path 转义与视频 thumbnail 事件尺寸回传。
- `npx eslint src/renderer/App.tsx src/shared/protocol/responses.ts src/shared/library-api.ts src/worker/index.ts src/worker/library-service.ts tests/worker/video-exr.test.ts`：通过。
- `npm run typecheck`：通过（Renderer/Main 与 extension 两套 TypeScript 配置均通过）；先前两处拖拽参数错误已由回调接线消除。
- `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/ai-completion.test.ts -t "enqueues video analysis|reconciles every ready video input" --reporter=dot`：2 tests passed；覆盖联系表就绪视频入队及无资产 ID 的资源库打开补偿扫描幂等性。

## 未验证

- Windows/macOS 真机 UI 与 packaged app 尚未在本回合执行；macOS 原生菜单需在 macOS 上人工确认菜单显示、语言同步及各命令实际行为。
- 隔离测试 ZIP 已确认包含相对 artifact 路径和 ready artifact 文件；已在当前 Electron worker 完整导入 581 MB 样本，但 Windows packaged 与 macOS 真机仍待人工验收。
- 竖视频卡片与 Windows 视频 AI 端到端人工复验尚未执行；当前修复需要在 Windows packaged/真实视频和已配置的 AI 端点上确认。
