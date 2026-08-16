# 2026-08-16 大型资源库夹具 v3

关联：`Serpent-q3pg`（原 10k 格式规格，已关闭但 gif/tiff 与多视频容器未落地）、`Serpent-3kfe.1`（20k 配比）、`Serpent-sa65`（10k / 第四档 / 0.5s 预览解码，夹具是前置不是该工单本身）。配比不改：20k，视频 5%，3D/文本/音频/不支持各 1%，余量图片。

工单未写像素尺寸。本轮按用户补充：图片长边 1% 8K / 3% 4K / 30% 2K / 60% 1K；1+3+30+60=94%，余 6% 归入 1K。口径是游戏美术贴图边长（1024/2048/4096/8192），不是视频 UHD。

「尺寸池」：每种「格式 × 比例 × 分辨率」只 sharp 编码一次，再 `copyFileSync` 到成千上万个资产路径。20k 库不必逐张编码；磁盘上仍是完整文件（8K 副本照样占空间）。

## 变更与四列证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 图片格式含 jpg/png/webp/gif/tiff | `tests/worker/large-library-mix.ts` `IMAGE_EXTENSIONS` | `tests/unit/large-library-mix.test.ts` 对照产品注册表 | 4K/8K 仅 jpg/webp，避免 GIF/TIFF 爆炸 |
| 视频格式含 mp4/webm/mov | `VIDEO_EXTENSIONS` + `createUniqueVideoFile` | 单测编码 mp4（`ftyp`）与 webm（体积 > 1KB） | 本机 ffmpeg；mov 与 mp4 同属 libx264 |
| 1/3/30/余量 → 8K/4K/2K/1K | `sizeBucketForIndex` + `IMAGE_SIZE_LONG_EDGE` | 20k 图桶计数 182 / 546 / 5460 / 12012 | 未跑满 20k 生成；旧库需 `--reset` |
| 非纯色、可压缩的噪声马赛克 | `createComplexImageBytes`：8 块 200×200 噪声砖铺满 | 1K jpeg 方差 > 80、体积 > 20KB、两张不相等 | 不是逐像素独立噪声 |
| 瀑布流可先用宽高 | fixture 写入 `revision_artifacts` `extracted_metadata` | 定向单测不打开完整库 | 完整 20k 生成未在本会话执行 |
| manifest version 3 | `LARGE_LIBRARY_FIXTURE_VERSION = 3` | 生成器测试仍要求 env 路径 | v1/v2 目录必须 `--reset` |

## 未执行

- 完整 `npm run large-library:generate -- --assets 20000 --reset`（8K 副本会明显增大磁盘占用）
- `npm run test:perf:large-library`
- `Serpent-sa65` 的真实 Electron 0.5s 解码 benchmark（本变更只升级夹具）
- Windows / packaged / Computer Use
