# 内嵌文件元数据（EXIF / ID3）开发日志

## 范围

工单 `Serpent-2b47e8` 对应 GitHub issue #47。第一阶段读取文件自身携带的
EXIF/IPTC/XMP、ID3 和容器标签，将其作为当前 revision 的派生
`extracted_metadata` 产物，在 Inspector 中展示，并并入已有 `meta:` 全文搜索。
文件仍是权威来源，不写回源文件，也不增加结构化筛选、地图/GPS 专用界面或外部
sidecar。

结构化筛选已单独记录为后续工单 `Serpent-381155`，并依赖本工单完成。

## 实现

- `src/worker/raw-image-metadata.ts` 保留有界 allow-list，并扩展标题、描述、方向和
  GPS 数值；EXIF 任务覆盖 JPEG、PNG、GIF、TIFF、WebP、AVIF 以及现有 RAW 扩展名。
- `src/worker/embedded-metadata.ts` 统一归一化 ffprobe 标签，限制字符串和自定义标签
  数量，生成可搜索文本，避免任意源字段跨进程进入 Renderer。
- `probeVideoAsset` 从 `format.tags` 和音/视频流 `tags` 读取标题、艺术家、专辑、曲目、
  流派、作曲者、日期、评论、版权和有界自定义字段；音频识别补充 AIFF/AC3。
- `asset_search_index.metadata_text` 继续复用既有 FTS 列。派生词带当前 revision 标记，
  普通索引同步会保留同一 revision 的词，revision 变化时自动丢弃旧词，避免过期命中。
- Inspector 复用现有技术元数据区域：图片显示标题、描述、GPS、相机字段；音视频按
  ARW 风格的字段/值行显示标准标签和自定义字段。音频技术摘要保留码率、采样率和
  声道信息，省略对用户帮助不大的编解码器名称；封面是否存在直接由缩略图表达，
  不再单独占一行。字段/值行复用 Inspector 的 UI 字体、正常字重和描述输入框字号，
  中文元数据不再挤在小号等宽技术行中。结构化筛选留待后续工单。

## 验证

- `npm run typecheck`：通过。
- 定向单测：
  `npx vitest run tests/unit/raw-image-metadata.test.ts tests/unit/video-metadata-format.test.ts tests/unit/embedded-metadata.test.ts`：18 项通过。
- 定向 ESLint：涉及文件通过。
- Worker 定向回归：`node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/video-exr.test.ts`，68 项通过。
- 资源库底线：此前完成的一次 `npm run test:library-availability` 为 9 个文件、228
  项通过、1 项跳过；补充旧版本 artifact 重新解析判定后再次启动的同一套件被用户中止，
  因此当前 HEAD 的这项证据仍需补跑。
- `npm run lint`：0 个错误，5 个既有 React Hook 警告。
- `npm run test:unit`：515 项通过、1 项既有失败；失败来自未改动的
  `theme-css-tokens.test.ts` 对 `App.tsx` 中示例颜色字面量的检查。
- 早先直接用 Node 运行 Worker 测试时遇到 Electron ABI/文件锁；改用仓库提供的 Electron
  runner 后已完成上述验证。

## 待验收

需要在真实 Serpent 应用中确认：音视频 Inspector 标签布局、图片 EXIF/GPS 显示、
`meta:` 搜索命中和 revision 变更后旧标签消失。Computer Use 由独立 agent/人工执行。
