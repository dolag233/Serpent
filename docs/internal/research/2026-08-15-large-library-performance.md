# 大型资源库性能测试基建

`Serpent-q3pg` 提供一套可重复、幂等的 10,000 资产混合资源库。生成器会创建真实的 `Assets/` 文件树，并直接写入当前 SQLite schema 的资产、revision、标签、合集、搜索索引和 Inspector 元数据。

## 生成测试库

```bash
npm run large-library:generate -- --output /tmp/serpent-large-library
```

默认数据集包含：

- 10,000 个资产：8,500 个图像、1,000 个视频、500 个文本/音频/3D/其他文件；
- 10 个根文件夹和 150 个子文件夹；
- 50 个带父子层级的合集；
- 每个资产至少两个 `ABCD-*` 标签、评分、描述和来源 URL；
- 固定可检索 token：`serpent-large-library-needle`，同时出现在标签和部分描述中。

manifest 保存在 `<library>/.serpent/large-library-fixture.json`。相同版本、种子和资产数量重复运行时直接复用；需要重建时显式传 `--reset`。可用 `--assets` 和 `--seed` 做较小或不同种子的数据集，例如：

```bash
npm run large-library:generate -- --output /tmp/serpent-large-library-small --assets 1000 --seed 20260815
```

## 运行基线

```bash
npm run test:perf:large-library -- /tmp/serpent-large-library
```

基线覆盖：打开资源库、切换文件夹、固定 token 搜索、Inspector 元数据/合集成员读取。结果由 Vitest 输出，搜索、文件夹切换和 Inspector 各自有 5 秒的宽松 sanity gate；具体目标预算见 `AGENTS.md` / `CLAUDE.md`。删除刷新基线暂不执行，因为 `Serpent-x710` 是用户明确排除的工单。

测试库只用于性能和查询回归，不代表媒体解码质量；要做真实预览验收仍需运行 Electron E2E，并检查图片 `naturalWidth > 0` 或视频非零元数据。

## 2026-08-15 收口变更

浏览导航现在可以复用已加载的侧栏状态：文件夹与回收站切换只请求当前页和计数，资源库/变更操作才刷新侧栏；合集导航也不再重复拉取标签、合集和智能合集列表。托管文件夹递归计数使用 `parent_folder_id` 自底向上聚合，不再对每个文件夹与所有候选文件夹做路径前缀两两比较。

搜索请求协调按搜索语义 lane 去重，而不是按资源库整体去重，以免当前页、全库计数和回收站计数的并行请求互相取消。删除后的刷新耗时仍不在本轮基线内（`Serpent-x710`）。
