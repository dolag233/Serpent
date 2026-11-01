# 大型真实库性能增量 QA（未完成总体验收）

日期：2026-11-01。分支 `dolag_dev`，测试基线 `77aede48` 加工作区未提交改动。Windows 开发态、隐藏离屏 Electron；未打包。真实媒体和目录均为用户授权的只读输入，测试库与 userData 隔离并清理，未进行资产删除。

| 需求条目 | 实现位置 | 自动化测试与当次结果 | 人工 / 平台证据 |
| --- | --- | --- | --- |
| 隐藏性能测试仍须真实产生帧，并测到实际解码 | `src/main/index.ts:2280`；`tests/e2e/perf-bench-helpers.ts:230`、`:266`、`:300` | `tests/e2e/navigation-profile.test.ts:1075` 断言帧样本；`tests/e2e/linked-real-performance-profile.test.ts:146`、`:164` 断言视口图片解码与帧样本，最近一次 1 passed（29.3 秒），首趟滚动帧 p95 60.6 ms、再次同向 41.3 ms | 仅离屏 Windows；真实显示器 Computer Use 未执行 |
| 真实大型目录首次链接时减少重复数据库读取与更新，同时保持搜索和重启后数据正确 | `src/worker/library-service.ts:19799`、`:19816`、`:19846` | `tests/worker/linked-folders.test.ts:83`：40 passed，检查初始搜索行、FTS 命中及 `closeAll` 后新 service 打开；`tests/e2e/linked-real-performance-profile.test.ts:44`：真实 15,473 文件链接 E2E 1 passed，根节点出现从优化前 11.6–12.5 秒降至 7.2–8.8 秒；`npm run test:library-availability`：236 passed、1 skipped | 原目录文件数前后均为 15,473；真实桌面、macOS、packaged 与用户验收未执行。清单 PERF-007 待人类验收 |
| 同一视频 revision 的 poster 与 metadata 探测合并，revision 更换后不复用旧结果，Inspector 仍能更新 | `src/worker/library-service.ts:28692`、`:28714`、`:34541` | `tests/worker/video-exr.test.ts:283`、`:339`、`:404`：75 passed，mock 中同一 revision ffprobe 2 次变 1 次，且取消后立即重探测；`tests/e2e/media-preview.test.ts:847` 生成真实视频并完整退出重启修复预览，1 passed；5 个真实 MP4 的只读 CLI 抽样中两种 probe 预热后均约 30–48 ms | 真实 MP4 的应用端 poster 时延、更多编码格式、packaged 与 macOS 未验证 |
| 真实图片目录滚动跟手 | 尚未实现优化；当前仅有测量接缝 | `tests/e2e/linked-real-performance-profile.test.ts:158`、`:167`、`:182`：282 文件目录首次正向滚动 p95 60.6 ms、1 个长任务、browse 1/1/1；反向 p95 39.7 ms、再次正向 p95 41.3 ms，均 0 长任务、browse 0/0/0。图片元素/URL 绑定计数不能当作网络请求数 | **未通过性能目标**；首次摘要页提交是首要嫌疑，CPU 样本仍是无法可靠映射到源码的打包名称；待生产修复与真实桌面复验 |
| 20,000 资产混合媒体回归基线 | `tests/worker/large-library-performance.test.ts:145`、`:294`、`:384`，当前产品代码作为被测对象 | 夹具生成 1 passed（73.82 秒）；基线 3 passed（15.19 秒）。Worker 打开 11.1 ms、搜索 18.0 ms、后续摘要页 12.1 ms、完整对账约 3363.7 ms；删除刷新未测 | 仅合成 Worker 口径，不能代替真实媒体 Electron 旅程。约 28.57 GiB 临时夹具清理被自动审批审查拒绝，磁盘洁净未通过 |

运行命令及前后数据详见[开发日志](../development/2026-11-01-large-library-performance-profile.md)。`npm run typecheck` 与本次改动文件定向 ESLint 均通过。一次普通 `npx vitest` 误用系统 Node，原生模块 ABI 不符；改用项目的 Electron 测试入口后视频 75/75、链接目录 40/40 通过。`media-video-playback.test.ts` 在 Windows 按原有条件跳过，不能算通过，已改跑上述跨平台视频预览 E2E。

[独立 Standards/Spec 审查](../reviews/2026-11-01-large-library-performance-profile-review.md)已完成，无阻断项；取消竞态和相应测试已补齐。整体性能问题仍有图片滚动、资源库关闭/切换、文件夹变更刷新、删除后布局、代理和色卡任务等缺口，因此本报告结论为**部分完成，未验收**。
