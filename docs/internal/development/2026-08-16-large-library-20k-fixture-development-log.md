# 2026-08-16 20k 可解码大型资源库 fixture

关联工单：`Serpent-3kfe.1`（父 epic `Serpent-3kfe`）。输出目录只通过环境变量 / CLI 传入，不把本机路径写进提交文件。代码已随 `70b8bb6e` 快进到 `dev`。

## 变更与四列证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 20k 配比：视频 5%，3D/文本/音频/不支持各 1%，余量归图片 | `tests/worker/large-library-mix.ts` | `tests/unit/large-library-mix.test.ts` 对 20_000 计数与逐项 kind | 生成器跑完后核对 manifest 计数字段 |
| 图片非纯色、可被 sharp 解码 | `tests/worker/large-library-media.ts` `createComplexImageBytes` | 单测断言 jpeg 尺寸、通道方差、两张不相等 | 20k 生成后抽查 `Assets/` 下 jpg/png/webp |
| 视频为真实短片而非空容器 | `createUniqueVideoFile`（bundled ffmpeg + `testsrc2`） | 单测写临时 mp4，断言 `ftyp` 且体积 > 1KB | 视频桶由 48 条独特 clip 复制，避免 1000 次全量编码 |
| 3D / 文本 / WAV / 不支持扩展不在产品注册表 | mix 扩展名 + media bytes | 单测对照 `media-formats` / audio / text 注册表 | 不支持扩展：xyz/max/c4d/blend/uasset/pak |
| 生成器默认 20k、version 2 | `scripts/generate-large-library.mjs`、`large-library-fixture.ts` | `large-library-fixture-generator.test.ts`（需 `SERPENT_LARGE_LIBRARY_OUTPUT`） | 本机 APFS 生成；路径不进 git |
| Worker 查询基线套件更名为 20k | `tests/worker/large-library-performance.test.ts` | `npm run test:perf:large-library -- <path>` | JSON 基线写入本日志下方；未达产品 UI 预算不得写“通过” |

## 未执行

- 真实 Electron 打开 20k 库的预览/查看器/切文件夹计时（`Serpent-3kfe` 后续）
- Windows
- Computer Use

## 本机 Worker 基线（2026-08-16）

命令：`npm run large-library:generate -- --output <local-apfs-path> --assets 20000 --reset`（约 38s），随后 `npm run test:perf:large-library -- <local-apfs-path>`。路径只在本地命令里，不进测试文件。

```json
{"suite":"large-library-20k","assets":20000,"startupMs":474.7,"folderSwitchMs":0.9,"searchMs":16.3,"inspectorMs":0.1,"deleteRefreshMs":null,"deleteRefreshNote":"Not exercised by this baseline; Serpent-x710 is explicitly excluded."}
```

这是 Library Worker 查询耗时，不是主窗口壳 / 缩略图解码 / 查看器的产品预算。生成库含 20,000 个真实文件：jpg/png/webp 各约 6,067，mp4 1,000（48 条独特 clip 复制），wav/obj/stl/gltf/文本/不支持扩展按配比。
