# 2026-08-21 媒体代理策略与回归测试修复

## 产品行为

- GIF 始终使用原生图片预览，不再因为动画帧数创建 `generate_webm_proxy` 任务。
- 视频保持 source-first：只有原视频在查看器中真实播放失败后才请求代理。
- 视频代理统一为 H.264/AAC MP4；没有可用 H.264 编码器或 H.264 编码失败时记录失败，不回退 VP9/WebM。
- 数据库中的 `webm_proxy` artifact/job kind 为历史兼容名称，实际成功产物的 MIME 和扩展名为 `video/mp4` / `.mp4`。

## 实现与测试修复

- H.264 编码能力探针改用临时 PPM 单帧输入，避免依赖随包 FFmpeg 未启用的 `lavfi/avdevice`。
- 大型媒体单测的合成视频夹具改用测试环境中的 `ffmpeg`；没有夹具 FFmpeg 时只跳过该夹具测试，不把产品随包二进制误当作 `lavfi` 生成器。
- 修复 macOS `/var` 与 `/private/var` 的真实路径断言、DialogShell 键盘事件 fixture 缺少 `nativeEvent` 的问题。
- 同步 GIF、H.264-only 失败语义、预览渲染注释、ADR、垂直切片说明和人类验收清单。

## 当次验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，主工程与 extension 配置均通过 |
| `npm run test:library-availability` | 9 个文件、189 个测试通过 |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts tests/worker/thumbnails.test.ts --reporter=dot` | 2 个文件、107 个测试通过 |
| `npm run test` | 454 个文件通过、12 个跳过；3941 个测试通过、19 个跳过 |
| 相关单元回归（asset-card-hover-preview、video-proxy-encoder、large-library-mix） | 3 个文件、31 个测试通过 |
| `npm run lint` | 仓库已有 5 个错误、1 个警告；未发现本次变更新增 lint 错误。既有错误位于 `session-log.ts`、`library-service.ts`，既有警告位于 `App.tsx`。 |

Windows、当前 HEAD 的 packaged 媒体播放和真实窗口人工验收仍待具备对应环境后执行。
