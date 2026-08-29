# 0032 阶段 D.7：远程资源库元数据本地快照缓存开发日志

日期：2026-08-26
工单：`Serpent-08a344`
范围：远程（SMB/挂载）资源库的 SQLite 元数据读取加速；本地资源库路径不改变。

## 结论摘要

D.7 已在 Worker 中落地一个用户目录级、可丢弃的 SQLite 元数据快照缓存：远程库仍由远端
可写数据库作为唯一真相源，普通读取在已验证快照命中后走本机只读连接，写入、事务、锁/租约、
PRAGMA 和无法证明为只读的 SQL 始终走远端。快照由 SQLite Online Backup API 生成，临时文件、
manifest 和 quick-check 均经过校验后才可被读取。

这不是“可写的离线资源库”模式：远端不可写时不会把本地旧快照伪装成可写资源库。当前打开
代次以窄化后的 `browse_change_sequence` 加 `size/mtime` 指纹做后台校验，跨重开仍以持久化
游标作为语义 freshness key，以避免 SQLite journal/checkpoint 的普通文件维护把每次重开都
误判为冷缓存。若远端只是在校验期间暂时不可达，最后一份已验证快照会保持只读可浏览；若
下一次开库时资源库路径或数据库暂时不可用，则只在 manifest、身份、schema 和 `quick_check`
都通过时打开为明确的只读 degraded snapshot，写操作仍被拒绝。快照使用不可变 generation
文件、单一 manifest 指针和有界 SHA-256/size 校验；发布、最终状态门禁、回滚和跨 cache key
预算清理由同一目录级跨进程锁串行化；catalog allowlist 之外的表不会读本地副本。

## 实现与四列可追溯

| 需求条目 | 实现位置（file:line） | 自动化测试（test:line） | 人工/平台证据 |
| --- | --- | --- | --- |
| 用户目录隔离的缓存键与 manifest，不把绝对库路径写入缓存文件名或事件 | `src/worker/network-metadata-cache.ts:174-273`；`src/main/index.ts:5907-5910` | `tests/unit/network-metadata-cache.test.ts:94-192` | macOS 开发态 Worker/主进程路径接线已执行；Windows、打包安装版未执行 |
| Online Backup 一致性快照、临时文件清理、只读校验、`quick_check(1)` 和 generation manifest 轮换 | `src/worker/network-metadata-cache.ts:603-757` | `tests/unit/network-metadata-cache.test.ts:94-192,227-436`；`tests/worker/network-metadata-cache.test.ts:119-182` | 当前 Electron ABI 下创建、关闭、重新打开测试通过；真实 SMB/NAS 断线/半连接未执行 |
| 用户缓存预算与旧 generation 淘汰，且不删除本次刚发布的 cache key | `src/worker/network-metadata-cache.ts:743-846` | `tests/unit/network-metadata-cache.test.ts:194-259`；定向 Worker 测试随快照发布运行 | 512 MiB 默认预算；跨进程占用时删除失败按 best-effort 留待下一轮；发布和清理共用目录锁 |
| 发布、最终状态门禁、generation 接管、回滚与全目录 prune 的跨进程互斥 | `src/worker/network-metadata-cache.ts:338-472,759-843`；`src/worker/library-service.ts:25230-25280` | `tests/unit/network-metadata-cache.test.ts:282-436`；`tests/worker/network-metadata-cache.test.ts:300-360` | 同进程双实例已证明等待、token-safe cleanup 和指针接管校验；独立 Worker 终止恢复、Windows 行为和真实多机并发未执行 |
| 命中缓存后 SELECT/EXPLAIN/只读 CTE 走快照；数据变更 CTE、写入、事务、volatile/未知表和歧义 SQL 走远端 | `src/worker/network-metadata-cache.ts:1009-1288`；`src/worker/library-service.ts:24998-25099` | `tests/unit/network-metadata-cache.test.ts:438-536`；`tests/worker/network-metadata-cache.test.ts:119-182` | Worker 读写分离通过；尚未做人类窗口操作检查 |
| 远端写入仍为唯一真相，命中缓存后 rename 等写操作对远端可见，并使读快照失效 | `src/worker/library-service.ts:39909-40079`；`src/worker/library-service.ts:40332-40341` | `tests/worker/network-metadata-cache.test.ts:119-182` | 测试用独立只读主库连接复核远端 `library.display_name`；多机真实并发未执行 |
| 窄化 browse cursor、跨重开 freshness、size/mtime 检测和 backup 前后竞态复核 | `src/worker/library-service.ts:24946-25283` | `tests/worker/network-metadata-cache.test.ts:224-360` | 合成外部 writer 推进 browse sequence 后可观察 stale→refreshed；真实他机写入未执行 |
| 资源库路径缺失时只读打开最后一份合法快照；校验失败不降级为伪造可写库 | `src/worker/library-service.ts:25321-25400`；`src/worker/library-service.ts:39909-40079` | `tests/worker/network-metadata-cache.test.ts:184-222` | 隔离临时库已证明 mount-missing 的 read-only/search/write-rejection；真实断线恢复和人类窗口未执行 |
| 缓存失效不污染新 open generation；关闭时快照和远端连接按现有生命周期释放 | `src/worker/library-service.ts:39909-40079`；`src/worker/library-service.ts:42050-42139` | `tests/worker/network-metadata-cache.test.ts:119-360`；`tests/e2e/library-lifecycle.test.ts:18-239` | 隔离 macOS Electron 开库/关闭/完整重启 3/3 通过（10.8s）；Windows、packaged、Computer Use 未执行 |
| 忽略规则与序列帧改变只推进窄 browse cursor，且不篡改已发布 v45 checksum | `src/worker/library-service.ts:2569-2617`；`src/worker/library-service.ts:3210-3217` | `tests/worker/migration-checksum-snapshot.test.ts:67-78`；`tests/worker/network-metadata-cache.test.ts:362-387` | schema v46/v47 migration checksum golden 与 ignore cursor 行为通过；既有 v45 真实升级矩阵仍未在 Windows/SMB 执行 |

## 性能基准

测试：`tests/worker/network-metadata-cache.test.ts` 的合成对照。它给每次远端主库语句注入
4ms 有界延迟，用来证明路由是否真的绕过主库；这不是 NAS/SMB 吞吐或用户实测的替代品。

最近一次 Electron Worker 定向运行输出：

```text
NETWORK_METADATA_CACHE_PERF_JSON {"remoteBrowseStatements":2,"cachedBrowseStatements":0,"remoteElapsedMs":20.5,"cachedElapsedMs":8.5,"syntheticPrimaryDelayMs":4}
```

稳定的结构性指标是远端浏览触发 2 条 browse 查询，而命中本地快照后为 0 条；墙钟数字受
本机调度影响，只作为本次运行记录，不能外推真实网络收益。

### 20k 真实资源库基准

命令：

```bash
npm run test:perf:large-library -- "${SERPENT_20K_FIXTURE}/library-20k"
```

该命令在当前 macOS arm64 本地 APFS 20k 夹具上完整通过 3/3。夹具 manifest 目标为 20,000
资产，但当前数据库实际可见资产为 19,965（既有 fixture drift，未修改夹具）；本次只把目标数
作为基线标签，同时如实记录 live count。

```text
NETWORK_METADATA_CACHE_20K_PERF_JSON {"targetAssets":20000,"liveAssets":19965,"snapshotBuildMs":3986.5,"remoteOpenMs":3,"cachedOpenMs":576.1,"remoteBrowseP50Ms":9.3,"remoteBrowseP95Ms":10.6,"remoteBrowseMaxMs":10.6,"cachedBrowseP50Ms":9.1,"cachedBrowseP95Ms":9.5,"cachedBrowseMaxMs":9.5,"remoteBrowseStatements":[2,2,2,2,2,2,2],"cachedBrowseStatements":[0,0,0,0,0,0,0],"cachedHit":true,"rssBeforeMiB":314,"rssAfterRemoteMiB":371.3,"rssAfterCachedMiB":373.3}
```

本地 APFS 没有 SMB 往返延迟，因此这次墙钟 p50 不能被解释为网络加速：9.1ms 与 9.3ms
只是同机对照。可证明的 D.7 结果是 20k 夹具上命中缓存时 browse 主库查询从每次 2 条降为
0 条，快照生成耗时 3.99s，热开库耗时 576.1ms；本次缓存重开相对远端对照的 RSS 增量为
2.0MiB，不能替代长期泄漏测试。真实 SMB/NAS 的首屏与二次打开收益仍需独立测量。

## 验证记录

| 命令 | 当次结果 |
| --- | --- |
| `node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/migration-checksum-snapshot.test.ts tests/unit/network-metadata-cache.test.ts tests/worker/network-metadata-cache.test.ts --reporter=verbose` | 3 files passed；22 tests passed；包含上述合成性能 JSON、generation prune、保守 SQL fallback、source-state unavailable、backup barrier、afterPublish 回滚/并发 publication lock、generation handoff 校验与 ignore cursor |
| `npm run test` | 482 files passed；15 files skipped；3 个文件中的 4 个既有环境失败：macOS `/private` 路径断言 2 项、ffmpeg `lavfi` 输入格式 1 项、packaged `better_sqlite3.node` 校验 1 项；D7 定向与 Worker/availability 门禁均独立通过 |
| `npm run test:library-availability` | 9 files passed；207 tests passed |
| `npm run test:worker` | 86 files passed；14 files skipped；1,245 tests passed；22 skipped |
| `npm run test:perf:large-library -- "${SERPENT_20K_FIXTURE}/library-20k"` | 3 tests passed；包含 20k network cache 对照、完整对账 viewer 响应性和历史导航基线 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过；仅有既存 Babel “library-service.ts 超过 500KB”提示 |
| `git diff --check` | 通过 |
| `node scripts/run-e2e.mjs tests/e2e/library-lifecycle.test.ts` | 3 passed，10.8s；当前 HEAD 构建、隔离 userData |

## 缓存与离线边界

- 缓存只存远端 SQLite 元数据的本地只读派生副本；不会把快照回写远端，也不改变 schema。
- 首次打开没有有效快照时仍立即使用远端主库，后台生成快照；生成失败只退化为远端读取。
- `browse_change_sequence` 推进（含 v46 ignore 规则和 v47 序列帧 trigger）、当前代次文件指纹变化、快照损坏/身份不符或 backup 期间远端
  变化时，当前读快照停止服务；如果远端仍可访问就继续以远端主库为准，后台重建失败不会覆盖
  最后一份已验证快照。后台 refresh 发现远端状态暂时不可读时，保留最后一份快照并发出 `offline`
  状态，而不是先清空可见目录。
- 下一次开库若资源库目录或数据库路径不可用，Worker 只尝试 `loadLatest`：manifest、库身份、
  schema、只读打开和 `quick_check(1)` 全部通过才进入明确的 `readOnly + networkStorage` degraded
  状态。该状态只允许浏览/搜索等本地快照读操作，rename/导入/删除等写操作会被拒绝；不提供
  假的远端写成功语义，恢复挂载后需要重新连接远端真相库。
- 已有 Main 预览镜像缓存仍是独立能力，不与本 D.7 的 SQLite 元数据快照混用；源文件打开也需
  重新验证远端可用性。

## 尚未验证与审查

当前证据覆盖 macOS arm64 开发态、合成 network storage override、可控 backup 中途 writer、
source-state unavailable、隔离 Electron，以及本地 APFS 20k 夹具的真实 Worker/SQLite 对照。
真实 SMB/NAS（含多机同时写、断线恢复、WAL/rollback journal 组合）、Windows、packaged、100k
资源库网络基准和人类视觉验收仍未执行，因此
`Serpent-08a344` 不在本阶段关闭，0032 整体也不能标记完成。

本阶段只安排一次完整改动后的 Luna High 双轴代码审查，不对每个小修复重复开审查。初审未发现
P0，但发现 7 项 P1：manifest 轮换、非 cache-first、未知表快照、首次 ignore 物化、取消时
连接所有权、竞态测试证据和文档隐私/证据一致性。已分别改为不可变 generation + manifest
pointer、cache-first + 后台校验、catalog allowlist、打开时预热 ignore 文本、取消时 finally
关闭未接管连接、可控 backup/source-state 测试，并统一文档路径与最终结果。最终 follow-up
又发现 manifest 回滚缺少跨进程锁的 P1；已改为目录级独占锁，锁拥有者记录支持进程存活检查和
陈旧锁回收，并增加 afterPublish 回滚、并发 publication lock 和 generation handoff 测试。最终
Luna High follow-up：P0=0、P1=0（no P1），确认接管校验、锁内 prune、token cleanup 和一次
竞态重试成立。保留两项 P2/未验证边界：真实独立 Worker 进程终止后的 stale-lock、Windows
目录锁/rename 行为尚未执行；Windows 的 rename fallback 仍是非原子兜底，真实 SMB/NAS 多机
行为也仍未执行。因此 `Serpent-08a344` 继续保持待人类验收，不将 D7 或 0032 整体标记完成。
