# 2026-08-21 大型库随机滑动缩略图与删除性能插桩排查

> 工单:`Serpent-sa65`(随机跳转 0.5s 门限)/ `Serpent-onch`(插桩)/ `Serpent-688714`(缩略图定尺寸,暂缓)/ `Serpent-a711e8`(删除 3–11s,新开)/ `Serpent-x710` / `Serpent-tz35`
>
> 分支:`dev`;平台:Windows 11 真机;测试对象为用户本机真实资源库的本地副本(路径不进仓库)。

## 背景与口径

- sa65 硬性门槛:≥1 万资产、第四档卡片(index 3)、滚动条随机跳转,**500ms 内可见预览全部真实解码**(`complete && naturalWidth>0`),禁止空占位。
- 用户要求(2026-08-17 起):所有性能测试必须先插桩分阶段计时,禁止盲优化。
- 测试库:`绘画资源库`(原生 Serpent 库,7,162 资产/360MB/自产缩略图)与 `设计-Eagle`(转换库副本,28,971 资产/25GB)。两者均以 robocopy 副本 + 隔离 userData 运行,不触碰原库。

## 插桩基建(tests/e2e/large-library-scroll-benchmark.test.ts)

- **真实库模式**:无 generator manifest 时经 `ELECTRON_RUN_AS_NODE` 只读数 `assets`(dev node_modules 为 Electron ABI,Playwright runner 不能直接 require better-sqlite3);`SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS` 允许 <1 万资产的真实库。
- **Windows 支持**:win32 用 robocopy(退出码 0–7 视为成功),其余平台保留 APFS `cp -cR`。
- **副本复用**:`SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY` 跳过每轮克隆并免删,保证优化前后同一暖状态可比。
- **分阶段埋点**(零应用代码侵入):
  - `pageTimeline`:每次跳转内翻页请求/解决时刻(`serpent:e2e-browse-page/-result` 加时间戳);
  - `fetchStages`:Chromium Resource Timing 的 `serpent://preview` 条目(**实测该自定义协议不产生任何条目,此通道对 serpent:// 无效**,已留档避免后人再踩);
  - `doneTimeline`:rAF 每帧记录 `visibleCards/decodedImages/placeholders/uncoveredLayoutIds`,直接看 done 条件何时翻转;
  - 结果 JSON 落盘(`_RESULT_PATH`)防管道截断。
- **CPU 剖析**:`_PROFILE_DIR` 经 CDP Profiler(100µs)输出每跳 .cpuprofile;`bench:jump-start/done` user_timing 锚点用于 CDP trace 定框;`_TRACE_DIR` 输出 devtools.timeline JSON。
- **独立探针脚本**(未入库,存于本地 bench 目录):img-churn(MutationObserver 数挂载/请求)、fetch-probe(Playwright network 事件逐请求时间线)、delete-probe 系列(删除相位测量)。

## 根因链(实测)

1. **瀑布流跑道一次挂载 ~196 张卡**(视口仅 875px 高;runway = max(1200, 5×视口高, 12×卡高))。img-churn 探针:liveSlots=196,196 个不同 artifact 各发 1 个请求,无 URL 重复。
2. **布局占位图 `loading="eager"` 强制立即抓取**所有屏外跑道图 → 每次跳转爆发 ~196 并发请求;fetch-probe 显示全部 ~25ms 内发出、~285ms 后一起完成(Main 单线程同步 openSync/fstatSync 串行消化)。
3. 可见 ~23 张图与 170+ 屏外图争抢协议处理与解码预算 → **优先级反转**,done 条件等到最后。
4. 次要放大器(Eagle 库):转换拷贝的源缩略图未按 512 策略定尺寸(PNG 均 206KB、最宽 10443px),视口总像素与耗时强相关(9.8MP≈616–705ms vs 5MP≈430ms)。

## 修复(一行)与验证

`src/renderer/BrowseLayoutPreview.tsx`:占位 img `loading="eager"` → `"lazy"`。

| 库 | 修复前 | 修复后 |
|---|---|---|
| 绘画资源库(原生) | p50=1411ms,p95=1701ms,**0/10** | **p50=239.4ms,p95=367.2ms,10/10** |
| 设计-Eagle 副本(暖) | p50=531ms,0–4/10 | p50=469.3ms,p95=613.6ms,**7/10** |

- Eagle 副本先行做了缩略图定尺寸实验(28,087 张重编码 512 webp,省 1.61GB):含大图跳转 705→536ms、616→580ms,证明大图是放大器;lazy 是结构性主修复。
- Eagle 剩余差距在**翻页请求延迟**(resolve 112–373ms,数据就绪后仍晚发),记为下一优化点(sa65 继续跟进);解码尾巴已压至 100–250ms。
- 运行间方差大(NTFS 缓存温度),对比须用同副本同轮次。

## 门禁

- `npm run test:library-availability`:9 files / 190 passed | 1 skipped ✓
- `npx vitest run tests/unit/browse-layout-preview.test.ts`:5 passed ✓
- E2E 子集:asset-pagination 2/2、browsing-preferences 3/4、thumbnail-scroll-regression 1/1(1 video poster skipped)。`browsing-preferences:404「maintains consistent preferences…」`失败(缩放后最顶卡 y=79 < canvas 上沿 124):经 stash 对照实验,**无 lazy 改动同样失败**,属既有滚动恢复竞态(Windows 稳定复现),与本修复无关;按验收纪律记为未关闭的既有问题,不归因本修复。
- typecheck / eslint:通过。

## 删除 3–11 秒问题(Serpent-a711e8)

用户报告删 2 文件 ≥8s;delete-probe 复现:按键→卡片消失 3.0/3.1/3.2s,会话首次 11.6–11.7s。

- 实际请求类型是 `selection.trash.request`(worker/index.ts:953,acquireWriteLease → trashSelectionAsync),不是 `asset.trash.request`。
- 渲染端无责:RPC 返回后通知/collection 刷新/局部移除均毫秒级;卡片滞留 = 等 RPC。
- 已排除:幽灵布局占位、写租约 vs 任务租约表争用(`library_write_leases` ≠ `library_job_leases`)、SQLite 同连接并发。
- 待办:Worker 侧分段计时(排队 vs acquire vs trashSelectionAsync 内部),首次 11.6s 与后续 3s 差异来源。

## 未验证 / 后续

- lazy 修复的 macOS/packaged 证据未执行。
- Eagle 翻页请求延迟优化、`revision_artifacts.width` 失真修正、动图缩略图策略(495 个失败样本)归 `Serpent-688714`/sa65。
- 删除问题 Worker 插桩与修复归 `Serpent-a711e8`。
