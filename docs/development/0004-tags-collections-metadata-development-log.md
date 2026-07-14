# 切片 0004 开发日志：标签、合集与资产元数据

> 状态：macOS 开发态有条件通过；packaged smoke 与 Windows QA 待补
> 日期：2026-07-13

## 依据

- 规格：`docs/implementation/0004-tags-collections-metadata-vertical-slice.md`
- 分支：`codex/slice-002-asset-ingestion`
- 实现提交：`3179fe4`、`b8bc0b7`、`ca49d57`
- 固定复审范围：`8dc2470...cdc2247`

## 实现摘要

- schema v5 引入标签、人工/AI 标签关系、资产元数据、树状合集、合集成员和智能合集定义。
- Worker 实现标签/合集/元数据 CRUD、递归合集汇总、成员排序和 `entity_version` 乐观锁。
- Renderer 提供标签与合集创建、资产分配、元数据 Label/评分/喜欢编辑和版本冲突反馈。
- 当前工作树补齐右键分配标签、加入合集、标签/合集重命名与删除、从合集移除资产的公共 UI
  入口，并新增跨切片 E2E。
- `AssetSummary.locationKind` 作为公共事实随列表、合集和搜索结果返回；Renderer 按资产本身
  判断托管/链接删除语义，不再按当前侧栏范围推断。
- 首次元数据写入必须使用 `expectedVersion = 0`；本轮 E2E 发现共享请求/响应 schema
  错误限制为 1，现已统一为允许 0。

## 2026-07-14 验收收口

- 修复合集递归开关读取旧闭包值；切换“包含子合集”后立即按新值查询，恢复会话时通过 ref 读取当前值。
- Label、描述和源链接允许显式空字符串清除，Worker 统一归一化为 `NULL`；Label 清空后卡片立即回退文件名。
- 人工色卡限定最多 20 个 `#RRGGBB`；源链接限定为无账号密码、无首尾空白的 HTTP(S) URL。Renderer 给出可操作中文原因，协议和 Worker 服务层再次验证。
- 新增 `INVALID_ASSET_METADATA`；`VERSION_CONFLICT` 跨 Worker → Main → Preload 保留 `currentEntityVersion`；错误映射自身异常时安全降级 `INTERNAL_ERROR`。
- 元数据保存改为本地串行队列，每笔使用上一笔成功返回的版本；快速“描述失焦 + 点击评分”不再与本客户端自身冲突。真正外部冲突仍停止该资产后续排队写入，等待用户刷新。
- 批量移除当前标签后立即刷新标签范围；从递归父合集批量移除时只处理直接成员，间接成员明确跳过，零直接成员不再显示虚假成功。
- 新增完整退出/重启 E2E：标签、父子合集及成员关系、Label、描述、评分、喜欢、人工色卡、源链接全部恢复；另用公共 API 制造竞争写入，证明陈旧 UI 不覆盖最新值并可刷新恢复。
- Computer Use 在真实 Electron 中创建独立资源库、导入图片、创建标签/合集、分配资产、编辑并清空元数据、验证非法色卡原因；截图见 `docs/qa/evidence/0004-organization-metadata/`。
- 全量 E2E 首轮发现未指定 profile 的进程会争用开发者 `userData/SingletonLock`。Main 在 `SERPENT_E2E=1` 时改用按 PID 唯一的临时 profile；显式重启/单实例用例仍可传入同一隔离路径。流程规则已写入 `docs/development-process.md`。

## 流程偏差与重建证据

本切片由另一 agent 在未逐步维护开发日志、审查和 QA 文档的情况下分批提交。本文不是
实时开发记录，而是根据上述提交、当前实现、Worker 测试及本轮公共 UI E2E 重建。该偏差
不影响代码事实，但降低了过程证据的可追溯性，因此结论只能是条件性通过。

## 验证

- 公共 UI E2E `organization-search-trash`：1/1 通过，覆盖标签创建/分配、合集创建/加入、
  Label/评分/喜欢编辑及三次版本递增。
- 最终全局自动门禁：unit 141/141、Worker 418/418、Electron E2E 10/10；lint、typecheck、
  package/verify 通过。
- Windows 未验证；macOS 人工视觉 QA 待执行。

## 遗留风险

- 公共 UI E2E 已覆盖标签/合集重命名删除、直接/间接成员移除、完整退出重启持久化和真实竞争写入冲突；合集树拖拽/重排尚未提供用户交互。
- 标签重命名与删除会在同一事务内重建受影响资产的 FTS 内容，旧标签词不会残留。
- packaged app 元数据编辑 smoke 与 Windows 平台仍未执行，不能写成通过。
- Computer Use 截图确认当前顶部批量条遮挡画布、右键菜单视觉和关闭机制不统一；该跨领域 UX 已进入 0014，不作为 0004 数据语义的隐藏遗留项。

## 2026-07-14 最终门禁

- `npm run verify:mainline`：lint、typecheck、extension verify 通过。
- Unit + Worker：51 个文件，810 passed，1 skipped（平台回收站真实测试）。
- 搜索性能：4/4 通过。
- 真实 Electron E2E：22/22 通过。
