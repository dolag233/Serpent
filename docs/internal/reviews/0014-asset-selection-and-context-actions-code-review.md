# 切片 0014 双轴代码审查：资产选择与上下文操作

> 状态：功能审查通过；平台与最终全量证据有条件保留
>
> 固定基线：`0cce59b`
>
> 实现候选：`f1330a7`
>
> 最后校准：2026-07-16

## Standards 轴

### 已关闭

- 先前 24 个未跟踪 Renderer 模块已全部纳入 `f1330a7`，干净检出不再缺模块。
- Renderer 仍只接收语义命令；数据库与文件所有权仍属于 Library Worker。
- E2E 使用独立 `SERPENT_E2E_USER_DATA_PATH`，组合键按 macOS/Windows 平台选择。
- `useBatchActions` 保留 `UiState` 的合法状态联合，不再强转任意 `string`。
- relink 恢复改为 v3 immutable journal；归属不明时保留而非删除。

### 判断项

- `AssetContextMenu` 仍承担 asset / multi-asset / organization / smart-collection 四类菜单且 props 较多。这是后续可拆分的 Divergent Change / Data Clumps，但当前动作矩阵集中、测试覆盖明确，不作为阻断。
- 本轮拆出约 20 个 Dialog/Sidebar/Hook，范围大于 0014 最小菜单改动；其目的是降低 8,000+ 行 `App.tsx` 的共享修改风险。定向 E2E 与静态检查覆盖了受影响入口。

## Spec 轴

### 已满足

- 平铺/瀑布流框选与跨视口累计选择。
- Shift、Ctrl/Command、Ctrl/Command+Shift 选择语义。
- 外点、Esc、滚动、resize、失焦、范围切换关闭；viewport clamp 与单菜单实例。
- 顶部选择动作移除；单项/批量/回收站/链接/找回动作迁入右键菜单。
- 单项与批量均显示“已选择 N 项”；mixed selection 显示处理和跳过原因。
- 菜单动作固定使用打开时的 `assetIds` 快照。
- unavailable 资产的文件动作禁用并提供可见及可访问原因。

### 有条件保留

- Windows 真实输入与文件语义未验证。
- 最后一组顶部动作迁移后的完整 `verify:mainline` 未完成；已有静态检查与相关 E2E 26/26。
- 真实 UtilityProcess kill/restart 属于 0007 的发布级恢复证据，不冒充 0014 已覆盖。

## 双轴结论

- Standards：0 个未关闭 HARD；2 个非阻断结构判断项。
- Spec：macOS 开发态功能满足；最严重保留项为 Windows 与最终集中全量门禁。
