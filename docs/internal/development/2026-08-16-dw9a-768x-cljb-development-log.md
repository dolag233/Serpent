# 2026-08-16 `dw9a` / `768x` / `cljb` 实施日志

关联工单：`Serpent-dw9a`、`Serpent-768x`、`Serpent-cljb`。代码已提交 `996cb3dd`。

## 这次收口的产品决定

`Serpent-cljb` 的策略按用户澄清执行：视频不再按“所有资源”预生成 proxy。导入、缩略图波次、打开查看器和普通预览只保留原视频路径；只有原视频在真实媒体元素上报告 codec/decode 错误（`MEDIA_ERR_DECODE` / `MEDIA_ERR_SRC_NOT_SUPPORTED`）后，才为这一项视频显式请求或复用 `webm_proxy`。已有可用 proxy 会先做路径校验并直接复用。代理播放成功后显示可隐藏、可恢复的弱提示。

`Serpent-768x` 的 Eagle“打开”不是把 Eagle 目录当作可写的 Serpent 库，而是读取 Eagle 后转换成新的 Serpent 库。2026-08-16 `Serpent-768x.1`：打开时连续两个目录选择器（Eagle 源 → Serpent 保存位置），不再默认写到 Eagle 同级 `<名称> (Serpent)`。源 Eagle 目录不修改。资源库根目录文件通过一个独立的“资源库根目录”虚拟节点浏览，和“所有资产”及真实文件夹分开。详见 [打开目的地开发日志](./2026-08-16-eagle-open-destination-development-log.md)。

`Serpent-dw9a` 实现了 Phase 1 和行级损坏可见性/重定位的主要 Phase 2 路径。抢救报告由 Worker 写入受保护的 `.serpent/corrupt-backup/`，Renderer 只收到安全摘要（源文件数量、元数据损失类别和报告可用标志），查看报告目录仍由 Main 执行。Inspector 选中缺失资产时只探测已知原路径、链接根路径和回收区；未知位置继续要求用户选择恢复根目录，不把未知位置误判成不可恢复。

## 本轮追加回归修复

恢复候选探测接入 Inspector 后，真实 Electron 启动 E2E 暴露了一个首帧空白回归：没有选中资产时，`null` 探测状态被错误地当作有效匹配，Renderer 访问了不存在的 `probe` 并停止挂载。修复为显式检查探测状态非空；这不是协议或 Worker 启动失败。修复后，链接文件夹 3 项和批量重定位 1 项启动/恢复旅程全部复跑通过。

## 四列证据

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| `dw9a`：主库损坏恢复梯度、只读降级、Assets 抢救重建 | `src/worker/library-service.ts:31426-31764`；`src/main/index.ts:1490-1497,4321-4340`；`src/renderer/App.tsx:8519-8562` | `tests/worker/database-recovery.test.ts:57-184` 覆盖 backup-1、缺失主库、双备份损坏→只读、Assets 重建报告；协议测试拒绝把绝对报告路径发给 Renderer | 当次 Worker 损坏注入测试通过；没有在 packaged 应用或 Windows 执行物理损坏/重启验收 |
| `dw9a`：至多两份轮换备份、quick-check 与 24 小时节流 | `src/worker/library-service.ts:5121-5238` 及打开/关闭/破坏性操作调用点；`src/worker/index.ts:701-727` | `tests/worker/database-recovery.test.ts:57-74,274-305` | 当次 macOS Worker 通过；packaged、Windows、真实用户库未执行 |
| `dw9a`：行级 revision 损坏不消失并自动修复 | `src/worker/library-service.ts:12704-12745,22267-22288`；`src/renderer/availability-affordance.ts:32-66`；`src/renderer/InspectorPanel.tsx:965-1012` | `tests/worker/database-recovery.test.ts:186-229` 验证 list/search 可见、`corrupt:<assetId>` 标志和 refresh 后重建；`tests/unit/availability-affordance.test.ts` 验证裂开图标 | Worker 注入测试通过；真实窗口中的完整损坏报告/恢复操作仍待人工 |
| `dw9a`：missing 文件重定位不猜测 | `src/worker/library-service.ts:22683-22810`：已知位置候选与内容指纹消歧；Inspector 入口为 `src/renderer/App.tsx:6463-6505` | `tests/worker/database-recovery.test.ts:231-272`、`tests/worker/trash-relink.test.ts` 覆盖候选探测、目录重命名、重复文件名指纹匹配和字节校验；`tests/e2e/trash-relink-flow.test.ts` 覆盖 Inspector 找不到已知位置时的提示与 relink 入口 | 当次 Worker/Electron 通过；当前 UI 需要用户选择恢复根目录，未执行真实外部目录/Windows |
| `768x`：Eagle 导入/打开与源目录隔离 | `src/worker/library-service.ts:30056-30097`；`src/main/index.ts:1735-1747,4321-4340`；`src/renderer/App.tsx:3321-3407` | `tests/worker/eagle-open.test.ts:26-98` 验证同级 Serpent 库、根文件/嵌套项、合集/标签和源 metadata 不变；`tests/unit/library-switcher.test.ts:20-108` 覆盖二级菜单 | Computer Use 已检查当前 macOS 开发态菜单并成功打开根目录节点；没有发现可供一次性验收的真实 Eagle 小库，未把临时 fixture 当作真实平台证据 |
| `768x`：唯一虚拟根节点与根目录计数 | `src/renderer/NavigationSidebar.tsx:1295-1330`；`src/renderer/App.tsx:2738-2831` | `tests/unit/navigation-sidebar.test.ts:23-257` 覆盖唯一根节点、直接计数及多层文件夹/合集的缩进、长名称、数量列、选中态；Eagle Worker 测试验证根项和嵌套项 | 当前 macOS 开发态检查根节点可选中并显示根文件；packaged/Windows 未执行 |
| `cljb`：视频 source-first、无导入/浏览 proxy 波次 | `src/worker/library-service.ts:19704-19803`；`src/worker/derived-artifact-repair.ts:55-130`；`src/renderer/AssetPreviewModal.tsx:224-249,380-396` | `tests/worker/real-common-av-formats.test.ts:102-156`、`tests/worker/real-media-bundle.test.ts:191-228`、`tests/worker/thumbnails.test.ts:682-763`、`tests/worker/video-exr.test.ts:687-773`；`tests/e2e/media-video-playback.test.ts:290-416` | 当前 macOS 开发态 MP4 查看器检查为 source URL；真实 FFmpeg 矩阵按环境变量决定，未把跳过写成通过 |
| `cljb`：真实失败后单项 proxy、复用、弱提示 hide/restore | `src/renderer/AssetPreviewModal.tsx:325-377,606-619,769-933`；`src/renderer/VideoPlayerControls.tsx:384-396`；`src/renderer/ProxyPlaybackNotice.tsx`；`src/renderer/proxy-fallback-run.ts` | `tests/e2e/media-video-playback.test.ts:387-454` 先断言 source，再注入确定性的媒体错误并验证 proxy 成功；`tests/unit/proxy-playback-notice.test.ts:20-66` 验证隐藏/恢复；`tests/unit/proxy-fallback.test.ts:5-22` 验证旧轮询在新运行、卸载和手动重试后失效；Worker 测试验证 ready proxy 复用和失败状态 | 当次定向 Electron E2E 通过；真实打包视频矩阵、Windows 播放器未执行 |

## 关键实现说明

### `dw9a`

- 备份路径固定为 `<库>/.serpent/backups/library.db.1` 和 `.2`，临时快照不会进入轮换；每次替换前用 SQLite Online Backup 和 `quick_check` 验证。
- 打开路径按主库、backup-1、backup-2、只读、Assets 抢救顺序降级；主库损坏文件移到 `.serpent/corrupt-backup/`，绝对报告路径不跨 Renderer 边界。
- `listAssets` 和 `searchAssets` 对悬空 revision 使用 LEFT JOIN，行保留为 `missing` 并以 `corrupt:<assetId>` 区分；重扫在源文件存在时重建 revision、缩略图与搜索索引。
- 重定位只在用户明确选择恢复根目录后递归索引；同名冲突必须由内容指纹唯一消歧，符号链接不参与候选。Inspector 的轻量候选探测不递归未知目录，只对已知位置做指纹确认。
- 抢救报告记录从 `Assets/` 找到的源文件数量与未恢复元数据类别；“查看恢复报告”通过 `library.recovery-report` 由 Main 打开报告所在目录，绝对路径不进入 Renderer。

### `768x`

- 当前资源库名称菜单的“打开外部资源库”保留 Serpent/Eagle 二级扩展位；应用菜单已有“导入外部资源库 → 导入 Eagle 资源库”路径。
- Eagle 打开成功前不关闭旧库；转换失败会关闭并删除未完成的同级转换库，避免半成品污染最近库。
- 资源库根目录节点使用 `scope: { kind: "folder", folderId: null, recursive: false }`，不会把真实文件夹伪装成根节点。

### `cljb`

- 删除了视频 direct-play capability 的预热式 proxy 请求；MIME/container hint 只用于 source URL，不作为“可播放”证明。
- 只有 `<video>` 的 decode/source-not-supported 错误进入 `retryArtifact(webm_proxy)`；网络/拖动产生的 transient error 不触发编码。
- fallback 请求会等待已存在的有效 proxy 或本次任务完成；失败不会被自动修复波次无限重试。

## 当次验证

- `npm run lint`：通过。
- `npm run typecheck`：通过（主工程与 extension 两个 tsconfig）。
- 定向恢复/导航/fallback Worker/单元：6 个文件，99 passed。
- 相关 Electron E2E：27 passed、1 skipped；`browsing-preferences` 与 `library-recent` 复跑 6 passed。
- 启动回归复跑：`node scripts/run-e2e.mjs tests/e2e/trash-relink-flow.test.ts tests/e2e/linked-folders.test.ts`，4 passed（11.9s）；覆盖无库首帧、链接库完整重启恢复和批量重新定位。
- 生命周期修复后的定向 Electron E2E：`node scripts/run-e2e.mjs tests/e2e/media-video-playback.test.ts tests/e2e/trash-relink-flow.test.ts tests/e2e/linked-folders.test.ts`，5 passed（21.1s）。
- 最终主线门禁（当前工作树，含 guard 修复）：`npm run verify:mainline` 通过；单元/Worker 421 files passed、9 skipped，3709 passed、16 skipped；搜索性能 5/5；主线 Electron E2E 80 passed、3 skipped、0 failed（4.3m）。
- 主线门禁之后仅增强了 `cljb` 的提示断言：相关 5 个单元/Worker 文件 143/143 passed，视频 Electron E2E 1/1 passed，并实际覆盖“隐藏提示→显示代理提示→恢复”。

## 独立审查与追加覆盖

- 2026-08-16 使用 `gpt-5.6-luna` 完成一次独立双轴审查（Standards + Spec），详见[独立审查报告](../reviews/2026-08-16-dw9a-768x-cljb-code-review.md)。审查发现开发日志行号已落后于当前 HEAD，以及视频 fallback 的异步轮询在切换资产、手动重试或卸载后仍可能回写旧查看器；已分别更新证据行号，并以 `createProxyFallbackRunGuard` + `resolvePreview` 运行判定和 2 个单测使旧运行失效。审查指出的 `library-service.ts` 职责偏多属于架构演进建议，本轮不扩大范围。
- Spec 审查仍保留真实 Eagle 小库、真实物理损坏完整退出/重启、packaged/Windows 和真实不支持编码矩阵未验证；这些限制继续明确记录，未把 synthetic fixture 或注入 `MediaError` 误写成平台通过。
- 768x 追加了多层文件夹/合集的长名称、层级缩进、disclosure、数量列、选中态和点击回调单测；dw9a 追加了 Inspector“已知位置找不到→选择恢复位置”的 Electron E2E 断言。

## 未验证与后续

- 没有真实 Eagle 小库可供一次性本地验收；仓库只保留自动化自清理 fixture，不保留本地路径。
- Windows、当前 HEAD packaged、真实外部目录搬迁和真实物理损坏重启旅程未执行。
- `dw9a` 仍缺真实物理损坏完整退出/重启、packaged/Windows 证据；未知外部位置仍需用户选择恢复根目录，未实现全库自动递归扫描。真实 Electron 启动空白回归已修复并由上述 4 项 E2E 覆盖。
- 代码审查已由独立 `gpt-5.6-luna` 角色完成；最终工单仍因真实 Eagle、物理损坏重启、packaged/Windows 等外部证据未齐而保持 `IN_PROGRESS`，`cljb` 按既定范围保持 `CLOSED`。
