# 2026-08-16 Eagle 导入渐进加载、分阶段错误与编码器探测

关联工单：`Serpent-9imk.1`。真实 Eagle 库只用于本机一次性回归，路径不进测试、脚本默认值或提交内容。

「从资源库名称菜单打开 Eagle / 外部库」归 `Serpent-768x`，本工单不改该菜单语义。

## 本轮增量

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| 先读根 metadata / 枚举 `.info` 名，再按批解析条目 | `src/worker/eagle-library.ts` `readEagleLibraryRoot` / `readEagleAssetCandidate` | `tests/unit/eagle-library.test.ts` | 本机一次性点算：735 个 `.info` |
| 合集在首批资产复制前可查询 | `importEagleLibrary`：先 `ensureEagleCollections` 再分批 copy | `tests/worker/eagle-import.test.ts` 在 `validate` 且已有总数时断言 collections≥1 且 assets=0 | 真实应用旅程未跑 |
| 导入不把主窗口打成 `busy` | `App.tsx` Eagle 导入不再 `setUiState("importing")`；`importProgress` 期间静默刷新 | 无 UI E2E | 待真实导入时点验侧栏/画布可点 |
| 批次间可取消 | `activeImports` + `cancelable: true` | worker 取消测试：40 项中途 CANCELLED，已导入数介于 0 与 40 之间 | 未跑真实取消 |
| 进度条区分读取条目与复制 | `progress.readingSourceItems` | i18n 双目录键 | 待人眼看进度文案 |
| 失败可区分解析 / 复制 / 登记 | `EAGLE_METADATA_UNREADABLE`、`IMPORT_COPY_FAILED`、`IMPORT_REGISTER_FAILED`；Renderer `error.withReason` 附加原因 | `eagle-import.test.ts` 对非 Eagle 目录、`crash-during-prepare-stage`、`after-stage` 分别断言 code+reason；`clipboard-paste-feedback.test.ts` 断言中文 `toMessage` 含 metadata.json / 复制 / 登记 | 真实失败提示待人眼 |
| Eagle 导入不自动跑 AI | `suppressAutoAnalysisForAssets` → `asset_auto_analysis_suppression`；`shouldAutoAnalyzeAsset` 为 false | worker：导入后图片/视频均抑制 | Main 侧 `asset.import-eagle` 不入自动分析队列（既有） |
| 「导入外部资源库 > 导入 Eagle 资源库」 | `main-menu-items.ts` 与 macOS `application-menu.ts` 二级菜单 | `main-menu-items.test.ts`；`application-menu.test.ts` 断言嵌套在 `toolbar.importExternalLibrary` 下 | 「打开外部资源库 > 打开 Eagle」归 `Serpent-768x` |
| 用 Eagle 静态缩略图，不预生成整库 video proxy | `persistEagleThumbnailArtifact`：图片 `thumbnail`、视频 `video_poster`，`eagle-thumbnail@1` | worker：图片 thumbnail、视频 poster ready；`webm_proxy` 为 null | 本机 Eagle 库抽查：735 `.info`，0 个条目含 `proxy` 或 `.webm`；170 个视频条目中 165 个旁有 `*_thumbnail` 静态海报。结论：该库没有视频转码 proxy，导入必须沿用静态封面 |
| 一次性真实 Eagle 小样本导入 | Worker `importEagleLibrary` | 未进仓库：从真实库拷 2 张图 + 1 个小于 8 MiB 的视频到本机临时 `.library` 后导入 | 当次 Electron vitest 1 passed（92ms）：合集在 validate 可见、importedCount=3、AI 抑制、静态封面、无 `webm_proxy`。临时目录已删，仓库无源路径 |
| ffmpeg 不以「名字出现在 `-encoders`」当作可用 | `probeVideoProxyEncoder`：1 帧 lavfi 写出非空文件才选用；诊断 `video-proxy.encoder-probe-result`（encoder / encodeOk / hardwareNamed） | `tests/unit/video-proxy-encoder.test.ts`；`tests/worker/video-exr.test.ts` 列出硬件名但探测失败则改用 `libopenh264`，正式 encode 不含该硬件名 | 并发仍为物理核−3；proxy encode `-threads 1`；`tests/unit/media-process-lifecycle.test.ts` 覆盖 shutdown 杀子进程。Windows GPU 未测 |

## 命令与结果

```text
npx vitest run --config vitest.config.ts tests/unit/eagle-library.test.ts tests/unit/video-proxy-encoder.test.ts tests/unit/large-library-mix.test.ts
# 3 files / 9 passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/worker/eagle-import.test.ts tests/worker/video-exr.test.ts -t "Eagle library import|H.264/MP4 webm_proxy|listed hardware encoder|realtime VP9|selected H.264 encoder fails"
# 2 files / 8 passed / 43 skipped

npx tsc --noEmit
# exit 0

npx vitest run --config vitest.config.ts tests/unit/clipboard-paste-feedback.test.ts tests/unit/application-menu.test.ts tests/unit/main-menu-items.test.ts
# 3 files / 19 passed
```

交叉审查（composer-2.5，对照 `dev` + 未提交工作区）：No findings。审查 agent 本机未跑 worker（ABI）；本 worktree 已用 Electron vitest 跑通上列 8 项。一次性真实小样本导入 1 passed 后已删除临时测试与临时 `.library`。

## 明确不做

- 不在导入时为整库排队 `generate_webm_proxy`
- 不把本机 Eagle 路径写进测试
- 不实现 `Serpent-768x` 的「打开外部资源库 / 打开 Eagle」菜单

## 合入 `dev` 与 beads

- 代码快进：`70b8bb6e`。
- 合并时本地 Dolt 导出 885 条；当时 Git 镜像 884 条且缺 `Serpent-3kfe.1`。按工单 ID 并集、比较 `updated_at`，增量 `bd import` / `bd export`，不用 ours/theirs，也不重建 Dolt。
- 结果：`Serpent-3kfe.1` closed（20k 夹具）；`Serpent-9imk` / `Serpent-9imk.1` / `Serpent-3kfe` 保持 in_progress。`Serpent-9imk.1` 验收第 6 条菜单仍归 `Serpent-768x`；`EAGLE-IMPORT-001` 待人类验收。
- 并集保留其他会话已有状态：`Serpent-768x` / `Serpent-dw9a` in_progress，`Serpent-cljb` closed，`Serpent-bx15` open。
- 远端 Dolt：`bd dolt push` 已成功；Git 镜像随本提交推到 `origin/dev`。
