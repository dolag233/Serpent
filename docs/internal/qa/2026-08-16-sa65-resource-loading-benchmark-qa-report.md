# 2026-08-16 Serpent-sa65 资源加载 benchmark QA

- 分支：`codex/serpent-sa65-benchmark`
- 基线：`78fa65724e97cd89e4d8b5fee1989bbc7907c074`
- 结论：自动化门槛通过；待独立审查、packaged/Windows 和人类验收

## 自动化

- 夹具：本地 APFS v3，10,000 assets，`images-only`，真实缩略图文件已预热。
- Worker：`npm run test:perf:large-library -- <image-only-v3>`；
  `startup=300.2ms`、folder `1.1ms`、search `10.6ms`、layout `33.2ms`、
  Inspector `0.2ms`。
- 当前 HEAD 队列优化后 Worker 重测：`startup=296.9ms`、folder `0.9ms`、
  search `8.4ms`、layout `28.7ms`、Inspector `0.2ms`。
- Electron：`SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS=5000 npm run test:e2e:large-library-benchmark -- <image-only-v3>`；
  当前 HEAD 重建后 `10/10`，每次跳转 `22–24` 张可见卡片，实际解码数与
  可见数相等，`p50=165.9ms`、`p95=212.9ms`、`max=212.9ms`，占位符
  `0`，默认图标 `0`，长任务计数 `0`。
- 当前基线与优化后结果均使用固定跳转序列；优化后未引入 500 ms 门槛回归。
- 同一实现第二次 Electron 跑分仍为 `10/10`，`p50=265.6ms`、
  `p95/max=318.6ms`，可见/解码数相等且占位符/默认图标为 `0`。
- 冷 Worker 视口生成（三次独立运行）：每次
  `requested=30 processed=30 completed=30`，耗时
  `380.0/368.7/376.3ms`（p50 `376.3ms`、max `380.0ms`），吞吐
  `78.9/81.4/79.7 thumbnails/s`。测试先清除隔离 APFS clone 中目标
  缩略图，避免 warm fixture 使 enqueue 结果为 `0`。
- 混合媒体诊断：`4/10` 的严格 image-only 断言通过，失败样本是视频/非图片
  没有图片 `<img>`，不能把该 fixture 当作全图片解码门槛。
- 独立审查后的最终 warm rerun：`159.8, 150.5, 151.1, 150.8, 161.0,
  145.7, 160.6, 169.0, 132.6, 145.9ms`；`10/10`，`p50=151.1ms`、
  `p95/max=169.0ms`，可见/解码数逐次相等，占位符/默认图标均为 `0`，
  请求波次 `0–1`，长任务计数 `0`。
- 冷压力路径（固定跳转目的地删除 1,000 个真实 thumbnail artifact、
  source 文件保留）最终为 `7/10`，逐次
  `194.1/623.7/443.4/786.7/464.3/566.6/447.6/417.0/287.5/452.2ms`，
  `p50=452.2ms`、`p95/max=786.7ms`。该路径的完成样本仍真实解码且无
  占位/默认图标；它测量首次源图生成，不作为本工单 warm-thumbnail gate
  的通过/失败依据。相同 offset `8200` 的 Worker 直接生成 `30/30`、
  `369.8ms`、`81.1 thumbnails/s`。
- 资源库可用性门禁：`npm run test:library-availability`，9 个文件、
  189 个测试全部通过。

## 真实 Electron / Computer Use

Electron benchmark 已通过真实 Chromium/Electron 渲染和图片解码断言
（`complete && naturalWidth > 0`）。

Computer Use 逐步视觉验收尚未执行；因此不声明 UI 人类验收通过。

## 未执行

- packaged app / 完整退出重启恢复；
- Windows；
- 8K 缩略图首次生成路径；
- 用户本人对第四档卡片随机跳转的视觉验收。
