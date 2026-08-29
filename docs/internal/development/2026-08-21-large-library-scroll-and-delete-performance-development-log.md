# 2026-08-21 大型库随机滑动缩略图与删除性能插桩排查

> 工单:`Serpent-sa65`(随机跳转 0.5s 门限)/ `Serpent-onch`(插桩)/ `Serpent-688714`(缩略图定尺寸,暂缓)/ `Serpent-a711e8`(删除 3–11s,新开)/ `Serpent-x710` / `Serpent-tz35`
>
> 分支:`dev`;平台:Windows 11 真机;测试对象为用户本机真实资源库的本地副本(路径不进仓库)。

## 背景与口径

- sa65 硬性门槛:≥1 万资产、第四档卡片(index 3)、滚动条随机跳转,**500ms 内可见预览全部真实解码**(`complete && naturalWidth>0`),禁止空占位。
- 用户要求(2026-08-17 起):所有性能测试必须先插桩分阶段计时,禁止盲优化。
- 测试库:`图像测试库`(原生 Serpent 库,7,162 资产/360MB/自产缩略图)与 `外部导入样本库`(转换库副本,28,971 资产/25GB)。两者均以隔离副本 + 隔离 userData 运行,不触碰原库。

## 插桩基建(tests/e2e/large-library-scroll-benchmark.test.ts)

- **真实库模式**:无 generator manifest 时经 `ELECTRON_RUN_AS_NODE` 只读数 `assets`(dev node_modules 为 Electron ABI,Playwright runner 不能直接 require better-sqlite3);`SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS` 允许小于基线数量的隔离测试库。
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
| 图像测试库(原生) | p50=1411ms,p95=1701ms,**0/10** | **p50=239.4ms,p95=367.2ms,10/10** |
| 外部导入样本库副本(暖) | p50=531ms,0–4/10 | p50=469.3ms,p95=613.6ms,**7/10** |

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

# 2026-08-22 全天续:真实库逐一定位(用户驱动)

用户全天以真实体感驱动排查,每个报告均先取证再动手。按发现顺序:

## 混合内容测试库(包含多种媒体类型的链接测试库)

链接根为隔离的混合媒体测试目录，8,843 资产中约 5,500+ 是代码/文本、
数百个 Chrome 配置文件二进制、node_modules 内容;真正媒体约 2,100。三层叠加:

1. 非媒体文件被排缩略图 → 必然失败(932 资产 × ~31 次 = 28,887 行失败,全部当天产生);
2. retryFailed 对此类永久不可能成功仅 30 分钟退避即重试 → 每开一次库滚一轮雪球;
3. 用户当天隐藏 8 文件夹后,后台调度完全无视 ignore——排队任务照跑,且
   `resolveAssetPath` 对忽略资产抛 ASSET_NOT_FOUND → 失败→重排无限循环。

已立案:`Serpent-4bc4ac`(ignore 调度尊重,P1)、`Serpent-778aab`(诊断修正后关闭:
扩展名门禁本就有效)、`Serpent-43d32f`(GIF proxy 移除评估,P2)。

## 视频素材库:交付链路异步化 + EBADF 崩溃根治(`77cf8fe`)

- 用户报告的「GC 错误」弹窗实为今日异步化引入的 FileHandle 句柄生命周期 bug
  (流 autoClose 关 fd 后,句柄 GC 终结器再次 close → EBADF 主进程未捕获异常,
  每个 GC 周期复现)。改用 `handle.createReadStream()` 句柄自管理生命周期。
- 同批将 Main 线程 openSync/fstatSync 改为 libuv 线程池异步 open/stat:
  此前整批缩略图请求在冷元数据读取上串行排队。实测同库对比
  imgCardsAllDecodedAt:1903→261ms、3107→2362ms、2189→1731ms、NEVER×2→444/403ms。

## 开库回填模型重构(用户拍板:「懒生成是完全错误的」)

由「仅生成可见区域」改为「**全量入队 + 队列优先级排序**」:打开库 1s 后一次性
入队全库缺失缩略图(低优先级),可见窗口 wave 继续高优先级为当前视口插队;
删除交互空闲门控对启动回填的无限推迟(持续浏览时回填永远无法开始)。

## sync.poll-remote 空转(WebDAV 绑定库未打开仍轮询,`26c3cb2`)

WebDAV 绑定的目标库未打开时,自动轮询每 ~1s 仍执行一轮真实网络请求后才抛
LIBRARY_NOT_OPEN——慢速远端时每次占用单线程 Worker 数秒。已修:isLibraryOpen
快速跳过,零网络 IO。用户会话日志实测 120+ 次该错误。

## 媒体任务租约 15s→60s(Serpent-308675)

满载解码时 Worker 单线程停顿曾致 lease-lost×13 失败重试;媒体任务租约独立
放宽至 60s(心跳 20s),写租约崩溃回收语义不变。

## hover 播放防误触(0f2a307)

防抖 200ms→500ms:快速滑动掠过卡片不再触发视频/音频源加载。

## 未来可优化方向(按价值排序,均已具备测量手段)

1. **缩略图尺寸治理全面落地**(688714 扩展):PDF/GIF 路径已有 512 上限,但
   外部转换(Eagle/Billfish)与历史大图仍需后台重编码;存量修复工具 +
   revision_artifacts 宽高失真修正。
2. **启动回填分块让出**:当前 startup 扫描单次同步 ~278ms(实测),开库/刷新
   各冻结一次;若要彻底消除,需把扫描拆为可让出的分批(async 化改造,
   影响所有调用方,需专项)。
3. **删除后视图锚点恢复**:数值化 scrollTop 恢复在重排后会丢位置,应改为
   「最顶可见资产 id」锚定(用户已报告视图跳走)。
4. **sync.poll-remote 的调度器侧过滤**:Worker 快速跳过已实现;Main 调度器
   仍每周期发一条命令(零网络但仍有 IPC),可选在 readBindings 后直接跳过。
5. **dev 模式渲染开销**:用户 npm start 与生产式构建体感差异待 A/B 结论;
   若显著,文档化「体验评估请用打包版」。
6. macOS/packaged 证据:今日全部修复仅有 Windows 证据。

## 2026-08-22 第二轮:预览镜像缓存落地与翻页延迟归因

### Serpent-1e3d4f:serpent:// 跨会话缓存验证与 PreviewCache 实现(9fc5182)

- 双会话探针(同一 userData):74 请求/2256KB 每会话完全重复——**自定义协议响应不进 Chromium 磁盘缓存**,immutable 头无效。
- 实现 `PreviewCache`(src/main/preview-cache.ts):图片预览首访后台镜像到 `userData/preview-cache/<libraryId>/`,后续会话本地直出;LRU 字节预算(默认 2GB,`SERPENT_PREVIEW_CACHE_BUDGET_BYTES`);仅缓存 image/*;E2E 默认禁用(`SERPENT_PREVIEW_CACHE_FORCE=1` 显式启用)防测试幻影命中。
- 端到端证据:会话1 241 store(7.1MB 落盘);会话2 **241 hit 零回源**;二三跳 285/237ms(冷 568/518ms)。单测 7 passed;library-availability 190 passed。
- 待办:SMB 真机计时、macOS/packaged。

### Serpent-9e1d8d:issue 时刻测量修正归因

- 新增 `serpent:e2e-browse-request` 发出时刻事件 + `SERPENT_WORKER_CMD_LOG=1` 命令级日志(waitMs/runMs)。
- 重测:issue 距跳转仅 3.4–16.6ms——渲染端决策链路无罪;此前「719ms 才发出」是旧埋点把解决时刻误标为发出的误读。真实方差在 resolved−issue=80–1018ms(worker/IPC 段)。
- 观测到一次**间歇性慢窗口**(p50=961ms;零请求跳转卡 1.7s,23 张图同时完成=单点串行阻塞签名),随后同库同操作复测 277–385ms 且 worker 全命令 wait<20/run<40 健康。判定为间歇环境窗口,保持工单开放,复发时用新探针取证。
- media-preview 2 项失败经 stash 对照为既有媒体生成管线问题(归 Serpent-140fe2),与 lazy/缓存无关。

### Eagle 本机解剖结论(支撑 1e3d4f/90ff52/04ba9d)

设计.library(29,079 资产)+ %APPDATA%/Eagle:普通 jpg/png 不生成缩略图直接源图作预览(源宽 p50=1606px/p50≈102KB);自产缩略图 p50 宽 564px≈88KB;元数据目录本地缓存(library-caches 28MB)+ Chromium 缓存 195MB 是其 NAS 快的核心。GPU 解码/BC7 分析:512² BC7 固定 256KB(比 JPEG 大 8–16 倍)、`<img>` 不支持需 WebGPU/WebGL 重写、编码慢——对网格缩略图是反优化,已向产品负责人说明。
