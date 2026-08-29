# 2026-08-16 Serpent-sa65 资源加载 benchmark 代码审查

- 审查基点：`78fa65724e97cd89e4d8b5fee1989bbc7907c074`
- 审查范围：`codex/serpent-sa65-benchmark` 相对基点的完整 diff
- 状态：独立审查完成；发现已逐项处理或保留为明确未验证项

## Standards

### 已处理

- 资源库可用性门禁已在当前工作树运行：
  `npm run test:library-availability`，9 个文件、189 个测试全部通过；
  结果已写入开发日志和 QA 报告。
- `getArtifactAbsolutePaths` 已改为批量逐项跳过缺失/不兼容 artifact，
  不再让一个陈旧 id 拖垮整个可见批次；Main 的批量路径协议仍保持
  `entries` 逐项返回。
- `serpent:e2e-browse-*` 诊断事件已由 `browseDiagnosticsEnabled` 守卫，
  生产滚动不再无条件分配诊断事件。
- `removeLocally` 已复用 `refreshHasMore`，不再用稀疏页数量启发式判断
  sentinel 是否还有数据。

### 保留项

- **[P2] benchmark 尚未接入常规 CI/mainline。** 10k APFS 夹具和真实
  Electron 解码依赖本机环境，因此 `verify:mainline` 不会自动执行；
  当前通过 `benchmark.md`、固定跳转序列和 PR/合并清单保留可复现证据。
  共享 runner 的固定夹具或 scheduled benchmark 仍是后续工程项。

## Spec

### 已处理

- **[P2] `layoutOnly` 空数组擦除布局。** `fetchBrowseLayout` 对缺少
  `layout` 返回 `null`，且已知 `total > 0` 时拒绝空布局；旧几何继续
  持有滚动条，避免万级资源库塌缩。
- **[P2] 快速跳转被旧 in-flight 页阻塞。** `ensureVisibleRange` 现在按
  连续缺页 run 选择最靠近视口中心的批次，只跳过已飞行 offset，并已补
  `browse-pagination` 定向测试。
- **[P2] 布局槽缺少 ready artifact。** 可见 layout slot 会进入
  `reportVisibleWindow`；`asset.thumbnail.ready` 更新真实 artifact map，
  摘要先到时卡片也使用该 id。map 限制为最近 512 项，资产集合变化时
  清空；没有生成 `__pending:` 卡或默认图标来伪造通过。

### 未关闭的规格/验收限制

- **[P2] layoutOnly 返回前的短窗口几何竞态。** `beginPage` 先发布首屏
  几何，完整 layout 异步落地前滚动条仍可能只反映局部高度。当前 E2E
  在完整几何就绪后开始跳转，尚无用户在该短窗口拖动滚动条的证据；需后续
  把初始 scroll geometry 与 `searchTotal` 解耦或补真实 E2E。
- **[P2] 冷源图生成不满足 500ms。** 删除 1,000 个真实缩略图 artifact
  的 APFS clone 压测最终 `7/10`，`p50=452.2ms`、`p95/max=786.7ms`；
  完成样本仍 `complete && naturalWidth > 0` 且无占位/默认图标。工单当前
  明确以已有真实缩略图文件的 warm 解码作为门槛，冷生成成本已单独记录，
  不能写成冷路径已通过。
- **[P3] 人类/平台证据缺失。** PERF-003 仍为「待人类验收」；Computer
  Use、packaged app 和 Windows 尚未执行。自动化 `10/10` 不能替代用户
  视觉验收，也不能将整单标记为 accepted。

## 处理后证据

- Warm Electron 固定十跳最终结果：`10/10`，逐次
  `159.8/150.5/151.1/150.8/161.0/145.7/160.6/169.0/132.6/145.9ms`，
  `p50=151.1ms`、`p95/max=169.0ms`；可见/解码数逐次相等，
  占位符/默认图标均为 `0`，请求波次 `0–1`，长任务计数均为 `0`。
- Worker 同 offset 冷生成：`30/30`，`369.8ms`，`81.1 thumbnails/s`。
- `npm run typecheck`、`npm run lint` 和 `npm run test:library-availability`
  均已在当前实现运行通过。
