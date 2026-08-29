# Serpent MVP 完成地图

> 状态：执行中
> 建立日期：2026-07-13
> 当前基线：待本次进度提交写入；审计工作树基于 `d8ca46f`

## Destination

产品简报定义的 Windows + macOS MVP 工作流全部可达、可用且有自动化/人工/平台证据；
0001–0010 的包含项完成双轴审查与 QA，最终完成审计能够逐项证明，不以“已有实现”代替验收。

## Notes

- 以 `docs/product-brief.md` 为产品范围，以 `docs/internal/development-process.md` 为完成定义。
- 用户明确要求地图同时承载执行，不在完成规划后停下；每个切片仍按规格 → 实现 → 自动验证 →
  双轴审查 → QA → 提交流转。
- 优先级按 MVP 用户主线、数据安全和依赖排序；2026-07-28 产品负责人将脚本化 + MCP 列为高于 3D/PBR 预览的后续能力。
- 通用 CLI 已撤回。0023 的 Registry/Gateway、脚本沙箱与 MCP（与脚本同一 Action 面）可在 v0.1.0 收口期间前置实施；写入、导入/建库批准和打包仍需按依赖分阶段推进。
- Windows QA 需要真实 Windows runner；本地不能把未执行写成通过。

## Decisions so far

- [桌面壳与资源库生命周期](0001-library-shell-vertical-slice.md) — 架构基线保留，Windows 打包 QA 是发布门禁。
- [托管文件夹、资产导入与外部变化](0002-asset-ingestion-vertical-slice.md) — 核心导入事务与错误观测已实现，先补齐证据而非重写。
- [链接文件夹与默认过滤](0003-linked-folders-vertical-slice.md) — 链接/刷新/重定位、可编辑规则、复制与 linked→managed 已有实现；剩余规格偏差处置和平台证据。
- [标签、合集与资产元数据](0004-tags-collections-metadata-vertical-slice.md) — 批量标签、子合集、树/成员排序、详情/封面和人工色卡均已进入当前树；剩余重启/冲突证据与复审。
- [回收站、手动找回与批量重新定位](0007-trash-relink-batch-relocate-vertical-slice.md) — 链接源系统回收站删除、恢复位置/冲突策略、多选恢复和 `keepMetadata=false` 已实现；剩余公共 E2E 与平台证据。
- [资源库导入导出](0010-library-import-export-vertical-slice.md) — 自动化安全主线已实现，仍需大库/打包 UI/跨平台证据。
- [脚本自动化与 Agent MCP](0023-automation-scripting-mcp-framework.md) — 当前自动化主线；CLI 0011 已撤回，不作为 v0.1.0 发布阻断。
- [资产画布视图与卡片信息配置](0012-asset-canvas-views-and-card-display-vertical-slice.md) — 核心浏览 UX 进入 v0.1.0；字段开关在 0006 正确性后、最终 QA 前实施。
- [资产查看页面导航与手势体验](0013-asset-viewer-navigation-and-gestures-vertical-slice.md) — 已记录默认适配、返回语义、精简控件、灵敏缩放、平移和范围切换规则；暂不实施，0006 稳定后先做竞品研究与原型。

## Execution frontier

1. **P0 发布阻断**：[0006](0006-thumbnails-preview-format-decoding-vertical-slice.md) 的不可变媒体
   二进制发布来源/receipt 与 packaged playback；建立真实 Windows runner 并执行平台矩阵。
2. **P1 下一本地切片**：[0012](0012-asset-canvas-views-and-card-display-vertical-slice.md)
   的版本化偏好、字段开关、重启/全范围/无障碍/10 万规模证据及真实 UX 截图验收。
3. **P1 核心旅程收口**：按当前树复审 [0004](0004-tags-collections-metadata-vertical-slice.md)
   与 [0007](0007-trash-relink-batch-relocate-vertical-slice.md)，补重启、冲突、公共 E2E、
   packaged 和人工证据；随后完成 [0005](0005-search-filter-sort-smart-collections-vertical-slice.md)
   的 packaged 搜索冒烟。
4. **P2 外部/后台旅程**：[0009](0009-cloud-ai-auto-classification-vertical-slice.md) 补范围分析/
   清空 UI 与密钥边界决定；[0008](0008-browser-extension-collection-vertical-slice.md) 完成真实
   Chrome/Edge 往返；[0010](0010-library-import-export-vertical-slice.md) 完成大库和跨平台往返。
5. **最终审计**：跨资源库复制、视频/GIF 悬停预览、NAS 断线只读、10 万资产冷启动 3 秒，
   以及跨切片 packaged/Windows 用户主线。

v0.1.0 收口期间可先启动 [0023](0023-automation-scripting-mcp-framework.md) 的 Registry/Gateway 与沙箱前置层；v0.1.0 验收后按其写入、打包依赖继续实施。

## Cross-slice completion items

- 已进入当前树、待复审与验收：桌面拖拽导入、剪贴板粘贴、托管资产移动/撤销、链接规则
  图形编辑、linked→managed 转换。
- 仍需实现或明确切片：跨资源库复制、视频/GIF 悬停预览。
- 仍需专项性能/故障注入：NAS/同步目录断线只读状态与 10 万资产 3 秒可交互指标。
- 仍需外部环境：Windows runner 的建立方式及真实平台测试；本地结果不能替代。

## Out of scope

- 团队协作、跨设备并发、版本管理 UI、3D 预览、创作软件集成、对外插件市场、PureRef 白板、
  本地 AI 模型与官方云服务：产品简报明确推迟到 MVP 后。
