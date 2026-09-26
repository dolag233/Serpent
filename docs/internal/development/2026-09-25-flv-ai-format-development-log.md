# FLV 与 AI 格式接入开发记录

> 日期：2026-09-25
> 状态：automated-verification pending
> 基线：`2d8a0a230de84eff90957e7a727f465cb339e97c`
> 合并基线：`origin/dev` at `8e141cc0`
> 最后更新：2026-09-26
> 规格参考：`docs/internal/implementation/0006-thumbnails-preview-format-decoding-vertical-slice.md`；格式研究：`docs/internal/research/2026-09-25-flv-ai-word-preview-feasibility.md`

## 范围与顺序

1. FLV：进入现有视频格式注册、ffprobe、poster、播放代理、格式过滤与协议 MIME 路径。
2. Adobe Illustrator `.ai`：只支持包含 PDF 兼容表示的文件，复用 PDF.js 页面查看和首屏缩略图；不宣称完整 Illustrator 原生格式支持。
3. DOCX 不在本次实现范围，单独 P2 工单 `Serpent-856bf3`，限定使用 docx-preview 且不支持旧式 DOC。

## 约束与证据

- 代码变更遵守 Worker 所有文件读写、Renderer 不接收路径、跨进程协议校验和临时文件清理原则。
- 当前工作区在开始前已有其他未提交改动；本记录只跟踪本格式增量，不纳入那些文件。
- 自动化测试、交叉审查、真实桌面旅程、Windows 和 packaged 证据尚未执行；完成后按实际命令与结果更新，不将未执行写成通过。

## 实施记录

- FLV 注册为视频格式并映射为 `video/x-flv`；视频筛选、Worker 分类、缩略图/媒体 job 入队和用于选择封面类型的 SQL 分支均包含 FLV。播放仍走已有非直放容器代理路径。
- 检查随仓库的 macOS arm64 FFmpeg：`resources/ffmpeg/darwin-arm64/ffmpeg -hide_banner -formats` 显示 FLV demuxer；`... -codecs` 显示 FLV1、VP6、H.263、H.264、AAC、MP3、Nellymoser 等解码器；`... -encoders` 显示 FLV1 编码器。该检查证明本机 bundle 能识别容器和常见编码并可创建 FLV fixture，不替代真实 FLV 文件的端到端播放验证；Windows bundle 未验证。
- AI 加入文档格式分类；Worker 仅扫描文件开头 1 KiB 识别 PDF 兼容头，之后由 PDF.js 验证并渲染；没有兼容头时预览解析返回 `UNSUPPORTED_FORMAT`，资产仍可管理并可外部打开。PDF-compatible 表示之外的 Illustrator 原生结构不在支持承诺内。
- DOCX P2 工单 `Serpent-856bf3` 已创建，明确只支持 `.docx` 并采用 docx-preview。
- 推送前同步：远端 `dev` 前进 7 个提交；rebase 保留了新抽出的 `singleDisplayArtifactJoin` 路径，并将 FLV 加入共享封面类型 SQL。资源库门禁、单测和 E2E 均在 rebase 后的最终代码上复跑通过。
- 新增自动化用例：视频/文档格式注册与 AI 分类单测；Illustrator PDF 兼容头、无兼容头及越界头单测；FLV poster 和代理播放/seek E2E；PDF 兼容 AI 文件的 PDF.js canvas 解码 E2E。
- `gpt-6-luna` 独立审查（Standards + Spec）：未发现生产代码缺陷。审查指出 AI E2E 样本是有效 PDF 内容配 `.ai` 后缀，已在测试中明确标为 synthetic routing fixture；它验证扩展名路由与 PDF.js 解码，不代表真实 Adobe 导出结构的完整兼容。审查提出 DOCX 工单属于范围外，但这项判断不成立：创建单独 P2 工单是本次用户明确要求的交付项。
- 静态检查（2026-09-26）：`git diff --check` 通过；定向 `npx eslint` 覆盖本次 Worker、shared、unit 和 E2E 文件，通过。`npm run typecheck` 被未改动的 `src/shared/text-encoding.ts` 阻断：缺少 `chardet` 声明且 `match` 参数隐式 any；`npm run lint` 被未改动的 `src/renderer/folder-inspector.tsx:42` 的 `react-hooks/set-state-in-effect` 错误阻断，另有既有 warnings。全仓门禁不能记为通过。
- 自动化验证（2026-09-26）：`npm run test:library-availability` 为 9 files / 229 tests passed；`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/media-formats.test.ts tests/unit/summary-media-type.test.ts tests/unit/illustrator-ai-format.test.ts` 为 3 files / 19 tests passed；`node scripts/run-e2e.mjs tests/e2e/media-video-playback.test.ts tests/e2e/document-preview.test.ts` 最终 5 passed，覆盖 FLV poster/代理播放与 seek、AI PDF.js canvas 解码。首次 E2E 因关闭查看器的旧按钮 locator 失败，改用应用现行 Escape 关闭行为后复跑通过。定向 ESLint 和 `git diff --check` 通过。
- **尚未验证**：真实 Adobe Illustrator 导出样本、真实桌面 Computer Use、Windows 和 packaged；AI E2E 使用合成路由 fixture，不能替代真实文件样本验收。全仓 typecheck/lint 的未改动文件阻断见上。
