# 2026-08-23 真实 NAS 打开阻塞归因与 startup 门闩开发日志（Serpent-2cc492 续）

> 背景：上一会话（2026-08-22/23 性能 loop）因 API 限额中断，遗留三个未读取的
> 真实 NAS E2E 后台结果。本会话恢复上下文后完成归因与修复。

## 事故证据链（真实 NAS 生产库 E2E + 用户日志）

测试对象：`/Volumes/Share/Serpent/绘画资源库`（7164 个 linked 资产、
21,508 个 artifact 缩略图文件、30MB library.db，千兆 SMB）。

修正 `SERPENT_E2E_OPEN_LIBRARY_PATH` 后的 E2E 三次运行全部失败：
**打开库后 600 秒内没有任何 `.asset-card` 渲染**。E2E 专属日志
（temp userData/logs）给出完整时间线：

| 时刻 | 事件 |
|---|---|
| T+0.0s | worker.spawn/boot |
| T+1.1s | `library.open` 完成（open.stage 各阶段正常，v42 已迁移） |
| T+1.5s | `folder.list` 完成；此后 **59 秒无任何命令完成** |
| T+15s | 主进程侧请求开始超时（`WORKER_REQUEST_TIMEOUT`，超时=15s） |
| T+59s | `linked-folder.list` 完成（runMs=21,838）；startup 突发在 1 秒内全部排空 |
| 之后 | `worker.response.late` ×462——响应有效但已超时被丢弃 |

结论：Worker 被「开库后台对账」占满，渲染端首屏数据永远等不到；
late 响应丢弃策略让 UI 无法自愈。

## 归因实测

- **artifact 目录枚举成本**：`opendir` 异步流式枚举 21,508 条目 =
  **16.5 秒**（无任何 lstat）。SMB 目录元数据是海量小往返，与带宽无关，
  API 再怎么异步也压不下去。
- 对账链其余同步 SQL 步骤（ignored-cleanup ~2.8s、refresh 批次事务等）
  在同一窗口叠加。
- 生产库数据核查：7164 资产完好、availability 分布与事故前一致，无损伤。

## 修复（本会话工作区，待提交）

1. **startup 门闩**（`src/worker/index.ts`）：开库后台对账等待
   「首个浏览类命令（asset.search / folder.browse-entries）响应已投递 +
   在飞命令清零」后才启动；15 秒硬上限防无限推迟（Serpent-4bdd26 教训）。
   计数点在中央消息处理器：进入 +1、`postMessage` 之后 -1 并 settle。
2. **对账链重排**（`library-service.ts`）：`reconcileMissingArtifactFiles`
   （对首屏最无用、对 SMB 最昂贵）移到链尾，位于 managed refresh、
   备份、索引预热之后。
3. **扫描枚举改造**：names-only readdir（扁平目录里 Dirent 类型判定无价值，
   containment 检查不变）+ 每 4096 条让步事件循环 + 库关闭时提前退出。

## 验证

- typecheck ✓；改动文件 eslint 仅剩 HEAD 上既有的 4 个错误（非本次引入）
- **test:library-availability 门禁：197 passed**
- 定向回归九套件（thumbnails/linked-folders/trash-relink/database-recovery/
  schema-compatibility/library-watcher/relink-crash-recovery/
  library-export-import/eagle-open）：**273 passed + 2 skipped**
- 全量 `npm run test`：3975 passed / 12 failed——trash-relink ×1 一度为本
  改动引入（离线语义测试），该改动已按用户裁决整体回退后全绿；其余 11 个
  在 HEAD 上同样失败（migration-checksum ×1、video-exr ×4、
  large-library-mix ×1、real-media-bundle ×1 等 ffmpeg/OIIO 环境依赖与并行
  worktree 迁移收编遗留），与本改动无关。
- **真 NAS E2E（探针副本，第 5 轮）：PASSED** —— `first card after 139s`、
  `cards=100`。此前四轮全部 600s 无卡片。冷缓存首开 139s 构成 = 侧栏元数据
  与浏览查询的串行全表冷读（37.6s + 49.3s 等），宽限窗口保证其不再被丢弃；
  后续优化候选已记 benchmark.json（查询并行化/asset.search 先行/路径前缀缓存）。

## 附带发现与用户裁决

排查中确认「跨平台打开 linked 库全量标 missing」机制（生产库副本探针复现：
一次对账后 folder=offline、7164/7164 missing）。**用户裁决为链接库预期语义
（源目录仅 Windows 可达），按设计处理不修复**；相应可用性冻结修改已整体
回退，原始语义测试全绿（linked-folders + trash-relink：102 passed）。
详见 Serpent-133bdc（closed, wontfix-by-design）。

## 第二轮归因（门闩验证 E2E 暴露的叠加源）

带门闩的重跑暴露了另外两层，逐层修复：

1. **startup 缩略图风暴**：探针库空 artifacts 目录 + 全量失效 → 7164 个
   generate_thumbnail 任务对不可达的 E:\ 源逐个失败；SMB 上每个失败是
   一次 journal 写事务，持续数十分钟占据 Worker。修复：
   - startup 场景与开库对账共用同一个 startup-burst 门闩；
   - 入队 SQL 排除 offline linked 文件夹的资产（`NOT EXISTS …
     linked_folders.status='offline'`）与 availability='missing'（原有）——
   验证：第三轮 E2E 媒体失败从数千降到 1。
2. **SQLite on SMB 损坏**：两轮 10 分钟重写入会话中探针库两次出现
   SQLITE_CORRUPT（第二次发生在正常运行中）。生产库 quick_check ok 完好，
   但风险真实。立案 Serpent-29893e（P0 调研）。
3. **冷缓存首读物理成本 × 15s 超时丢弃**：实测 assets 表 7164 行首次读取
   ≈3.5s（暖缓存）/15-22s（冷缓存，每页一次往返）；侧栏元数据类命令
   （linked-folder.list 等 15s 档）在冷缓存下必然超时被丢弃 → 渲染端
   反复重试、最终呈现「空资源库」且无法自愈（DOM 快照证实：所有资产 0 项、
   尚无托管或链接文件夹，而 DB 完好）。修复：主进程 worker-client 增加
   「开库宽限窗口」——library.open 成功后 120s 内的请求超时放宽到 120s
   （取与原档位较大值），稳态语义不变。

## 教训

- 「性能优化必须在真实目标环境端到端验收」再次被验证：本地 20k fixture 上
  五轮 10/10 的滚动基准，完全没能暴露 SMB 目录元数据往返这个量级的成本。
- late 响应静默丢弃 + 无重试 = 慢环境下 UI 不可自愈；门闩从源头消除超时，
  但主进程侧重试策略仍是值得立案的后备韧性项。
