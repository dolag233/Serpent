# 真实实例卡顿与 FBX 解析生命周期

- 工单：`Serpent-f8b568`；相关 `Serpent-df0ec0`、`Serpent-3kfe`。
- 分支/基线：维护者工作分支 / `ebb7f9be`，保留所有前轮未提交修改。
- 状态：本轮实现、相关自动化和单一独立双轴审查已收尾；等待用户验收，未提交或推送。
- 环境：Windows，本机 Node 24.14.0、Electron 43.1.0；未切换或下载运行时，不外推到其他平台。
- 范围：已确认的 FBX 解析阻塞、运行时高水位保留、局部容量失败误升全局冷却，以及查看器重复解析。用户当前整个 Renderer 内存的所有保留者尚未确定。

## 现场与只读复现

用户重新报告当前资源库非常卡顿。先通过只读进程、会话日志和只读 SQLite 连接检查，未操作前台或修改真实库。当前开发实例运行约 13 小时，主 Renderer 私有约 6,145 MiB，Library Worker 约 2,270 MiB，离屏 Renderer 约 84 MiB；系统仍有约 26 GiB 可用。大占用本身不能证明系统内存耗尽，也没有取得原实例 Renderer 堆快照。

库中 15,434 项资产，包含 1,054 个 FBX 和 7,051 个 PNG。缩略图任务 10,412 排队、0 运行；其中同一个 FBX 被领取 64 次，同波 PNG 被冷却重排 39 次。日志持续记录 `out of memory packing result`，间隔进入最高约五分钟的进程级媒体冷却。其他 AI 网络探测也曾占用调度 lane，属于额外候选，不在本轮扩散实施。

只读解析一个 241,398,032 字节的真实 FBX，使用当前已安装 ufbx 资源和独立 Node 子进程；不创建输出文件、不打开库写连接：

| 阶段 | 耗时 | WASM 线性内存 MiB | RSS MiB |
| --- | ---: | ---: | ---: |
| 模块加载及输入读取 | — | 64 | 287 |
| `_serpent_parse` 返回 `code: oom` | 2,010 ms | 1,691.5625 | 1,879 |
| `_serpent_free_out` 与输入/选项 `_free` 后 | — | 1,691.5625 | 1,879 |

子进程正常退出，未留下磁盘产物。原实现在常驻 Library Worker 缓存模块，因此上述高水位不会随着单任务的 `_free` 回落；同步 parse 也会占住该事件循环。没有把 2,010 ms 当成所有资产的平均延迟。

另外用同一文件、当前 Three.js FBXLoader 在独立 Node 做仅解析探针；图片加载使用无解码桩，不包含真实纹理解码/WebGL成本。探针在内存载入上游源码的副本，并仅附加清除模块变量的诊断函数；没有修改依赖文件或产品代码：

| 阶段 | JS used MiB | RSS MiB |
| --- | ---: | ---: |
| 解析前 | 7 | 523 |
| 解析后（7,857 ms） | 2,180 | 2,913 |
| dispose 场景、释放调用方输入及场景引用、诊断 GC 后 | 959 | 1,516 |
| 清除模块级 `fbxTree` / `connections` / `sceneGraph` 后再次诊断 GC | 7 | 199 |

这证明了上游模块根保留和大文件同步解析机制，**不能替代原实例的堆快照，也不能将其全部 6 GiB 直接归因于 FBX**。诊断 GC 不进入产品或性能正常窗口。该子进程亦正常退出、无磁盘产物。

## 根因链与修复边界

1. ufbx 自身具有固定 WASM 地址空间；bridge `oom` 是这次单次转换的容量失败。转换器原来只识别 `limits`，把其他 JSON 错误统归 `FBX_NOT_FBX`，丢失了类别。
2. 模型任务虽然写入失败 artifact，但其 reason 被包入通用异常。通用资源 regex 识别到 `out of memory` 后重排当前任务并启动整个 Worker 的媒体冷却，取消了失败终态，又影响其他输入及其他库。相同输入反复占据队首。
3. 常驻 WASM singleton 保留扩容高水位，`_free` 只释放模块内部的分配。同步解析还阻塞数据库/目录/浏览请求的宿主线程。
4. 查看器对转换器的任意失败自动执行 FBXLoader 回退，造成容量失败后在主 Renderer 再同步解析一次，并触发上游模块根保留。

本轮将解析放入 Library Worker 所有的串行、单任务 worker thread；成功、失败和取消都先确认线程退出，再结算和允许下一任务。主 Worker 不再持有 WASM 模块。保留转换 single-flight，不新增文件大小、三角数或墙钟产品上限，不放大现有 WASM 技术上限。

容量失败继续使用既有 `FBX_LIMIT_EXCEEDED`，通过明确的输入容量异常边界与 host 资源压力分开。线程错误经过有界 `code` / `errno` 校验传递；转换器用 `FBX_RESOURCE_EXHAUSTED` 保留真正 host 压力，模型任务将其交回原有共享冷却。资源不足时停止查看器的自动 FBXLoader 重试，其他兼容回退保留；复用既有错误映射和界面，并提供 host 不足的中英文结果文案。原始技术原因仍供诊断，不依赖把错误码拼到文字里触发 regex。

真实 Electron 又稳定揭示了 single-flight 生命周期交错：可见区域重调度取消旧解析时，旧线程尚在退出，新的同资产调用会加入其已取消 entry，从而收到 `All FBX conversion waiters cancelled`，被误写成模型加载失败。现在只复用未取消 entry；新意图替换旧 entry，旧 finally 按身份比较，不会删除新意图；底层线程队列仍先等旧线程退出。可控 deferred 单测覆盖旧取消、新请求、迟到旧拒绝和第三个请求的正确共享。

不修改第三方源代码、不新增 GC、不缩小 UI 缓存凑内存结果。修复不宣称让原本超过转换器容量的模型成功显示。降低 bridge 组装峰值是另一项编译产物工作，本轮没有改 C bridge 或重建 WASM。

## 自动化与真实输入最终记录

| 检查 | 当次命令/范围 | 结果 |
| --- | --- | --- |
| 直接相关 unit | `npm exec -- vitest run`，media-concurrency、fbx-conversion-failure、fbx-convert-command、fbx-wasm-loader、3d-viewer-loader-registry、3d-viewer-error-messages 六文件 | 36 passed / 3.81 秒 |
| 新错误码运行时校验 | `npm exec -- vitest run tests/unit/protocol.test.ts -t 'model[ .]convert-fbx'` | 3 passed / 123 skipped；未称协议全套通过 |
| 实际转换和任务状态 | `node scripts/run-vitest-with-electron.mjs run tests/worker/fbx-conversion.test.ts tests/worker/model-capacity-isolation.test.ts --disableConsoleIntercept` | 23 passed / 12.76 秒 |
| 既有 FFmpeg host 退避 | `node scripts/run-vitest-with-electron.mjs run tests/worker/video-exr.test.ts -t 'backs off and requeues a native FFmpeg memory failure' --disableConsoleIntercept` | 1 passed / 84 skipped；是故障注入，不是刻意耗尽本机内存 |
| 资源库底线 | `npm run test:library-availability`，最终 service 分支修改后完整执行 | 9 文件，240 passed / 1 skipped，127.63 秒；前轮第一次完整执行也为 240 passed / 1 skipped |
| 大库基线 | 隔离生成标准 mixed 20k，再 `node scripts/run-large-library-performance.mjs` | 3 passed / 15.21 秒；生成 1 passed / 69.76 秒，根目录已清理 |
| 隐藏 Windows Electron | `node scripts/run-e2e.mjs tests/e2e/fbx-capacity-recovery.test.ts tests/e2e/model-viewer.test.ts -g 'capacity failure|opens an FBX model through' --reporter=line` | 最终重新构建，2 passed / 14.4 秒 |
| 定向 ESLint | 本轮产品与直接测试共 23 文件 | exit 0；巨型 service 的 Babel 提示不作为错误 |
| 类型 | `npm run typecheck` | 仍只有另一路 CLIP 的 4 项既有错误；扩展 tsc 因 `&&` 未执行，不写全仓绿 |

大库基线在错误分类阶段测量，后续线程/错误码的增量不涉及其 SQL 路径；该基线未执行真实大 FBX 解码，不能用它宣称解析性能达标。其当次 startup 10.8 ms、folder switch 0.5 ms、search 17.9 ms、layout 118.1 ms；reconciliation 3,304.7 ms，事件循环 lag p95/max 0.8/82.8 ms，viewer resolve p95 2.5 ms。数字属于 Worker API 夹具，不是当前用户库或 UI 帧率。

最终真实 FBX 旅程：复制导入只读源的 241,398,032 字节模型与一张需派生预览的 PNG，正常后台处理并自然经历可见区域抢占。共 31 次浏览调用，其中 30 个采样前任务仍为 running；延迟 p50 2.7 ms、p95 3.3 ms、max 3.5 ms。模型最终 `FBX_LIMIT_EXCEEDED`，累计领取 2 次（抢占和最终容量失败），进入失败终态后打开查看器、返回浏览，仍保持 2 次；这不同于一次都不被抢占的 Worker 夹具，其明确断言 1 次失败。

PNG 实际满足 `complete && naturalWidth > 0`，Worker 另对同/异库产物做 Sharp 原始像素解码。源请求监听先通过带 revision 的真实 PNG fetch 正向验证，再断言 FBX source fallback 为 0；错误面板实际包含容量不足的本地化文案。普通 FBX 则通过真实转换、GLTF/WebGL 显示和几何统计，保留原功能路径。真实源 SHA-256 前后一致，原文件未修改。

最终采样 Tab 私有 243 MiB，Library Worker 所在 Utility 约 840 MiB（另一个网络 Utility 12 MiB），Browser 401 MiB。正常窗口没有强制 GC。**这是新 profile 的短旅程，不能与运行约十三小时的原实例作直接因果倍数对比，也不证明全部长期内存问题已解决。**

最终实际构建：Worker SHA-256 `4418c90975f32f50d2ae7f06c0974f1a9f14bebe2bcbe6a253b6019196bd563d`；主 Renderer JS SHA-256 `82786f5b92239c604bc1c9b9413b2d6ad24a1768b64215f3afb50c6acbe8e5bf`。packaged/macOS、原库完整滚动历史和人工前台验收均未执行。

最终 `git diff --check` exit 0；25 个本轮代码/文档文件增量与当前状态、QA、工单的 4 个新增块扫描盘符/家目录/UNC、已知本机身份/库名和常见凭据前缀，0 命中。它不是提交级全仓扫描。精确检查本轮 FBX fixture/output 前缀 0 个、该工作区 Electron 进程 0 个；前轮拒绝目录和归属不明的产物未删除。

## 失败与审查收敛

- 新 Worker 夹具首版只按 assetId 找任务，误读到生成缩略图后新增的 metadata queued；改为精确 `generate_thumbnail`。这是测试选择器错误，不称产品 RED 或 flaky。
- CJS 引导代码编辑 lint header 时意外在尾部追加文字，导致当时 FBX 回归 18/21 失败；修正后 `node --check`、实际转换 21 项、最终两文件 23 项和 Electron 都重新通过。不能把坏引导稿当成稳定实现。
- 真实 Electron 两次稳定复现上述取消 single-flight entry 复用错误，已补实现和可控回归；没有通过重试忽略。随后测试的“领取必须为 1”断言忽略了正常抢占，改为失败终态前后领取计数不再增长；另一处正向监听探针缺少必需 revision token，导致 HTTP 400，补正确 URL 后验证。这两项是测量规格修正，产品构建未改来规避断言。
- 独立 Luna 同时审查 Standards 与 Spec，指出只传错误文字会丢 ENOMEM/errno；已增加完整注入链回归、显式 host 错误码、双语文案及 Zod 边界测试。增量复核无剩余确定阻断，不等于人工 accepted。见对应审查记录。
- Renderer agent 曾误用 `npm run test:unit -- <files>`，实际启动全 unit，约十秒后中止；观察到 automation-script-ipc 1 项、clip-canvas-preview 3 项失败，未调查关闭，也不把整套写绿。runner 已退出，可确认的两文件 fixture 前缀及创建窗口未见残留；由于其他测试路径未记录，不能保证未完成 suite 的所有潜在产物逐项核清。未知归属未删除。

## 进程与磁盘

用户明确授权直接结束当前工作区的开发实例，后续无需反复询问退出。身份校验后请求正常关闭、等待七秒，未退出再结束该实例及其子树。没有终止其他项目/应用。之后的 Electron 验证使用隔离 userData 和隐藏窗口，原文件只读，测试输出按所有者生命周期清理。

前轮六个失败目录的精确删除被自动审批拒绝；本轮未重试它们，也不让测试扫除旧目录。新增测试根使用独立前缀，不复用真实库或这些旧目录。

## 验收追溯

| 需求 | 实现 | 自动化 | 人工/平台证据 |
| --- | --- | --- | --- |
| 单个模型容量失败不冻结其他媒体或库 | `fbx/converter.ts:143`、`library-service.ts:24745`、`media-resource-guard.ts:16` | `model-capacity-isolation.test.ts:23`、分类与完整 host 注入 `:85` | 原实例只读现场与同一输入隐藏 Windows Electron；原库整段历史未复测 |
| 解析完成/失败/取消后线程退出，宿主不被同步 parse 占住 | `fbx/wasm-loader.ts:59`、`serialized-parse-queue.ts:81`、`:250` | `fbx-wasm-loader.test.ts:206` 起 7 项；实际 FBX 转换、Electron 31 个浏览采样 | 当前构建隐藏 Windows Electron 通过；packaged/macOS 未执行 |
| 新请求不复用已取消意图 | `fbx/convert-command.ts:68` | `fbx-convert-command.test.ts:20`，旧拒绝/新共享受控交错 | 同一真实 FBX 先前稳定失败，修复后自然抢占后收敛 |
| 资源失败不在主界面再次解析，文案正确 | `loader-registry.ts:195`、`viewer-surface.tsx:357`、既有错误映射与 catalog | loader 单测、错误码/协议单测、`fbx-capacity-recovery.test.ts` 实际文案与源请求监听 | 隐藏 Windows Electron 通过；前台按用户要求未执行，`FBX-QUEUE-038` / `FBX-VIEWER-039` 待用户确认 |

整体浏览卡顿与 Renderer 长期内存调查继续保留；本轮结束后只汇报已验证范围，不以这一增量关闭总体性能目标。
