# 2026-07-19 App 拆分与 exhaustive-deps 清零开发日志

工单：`Serpent-uye`（Wave 1，未关单） / `Serpent-zhh`

## 范围

1. 从 `App.tsx` 抽出壳层文件操作与画布 DnD 执行器，满足「新增交互先拆模块」门禁。
2. 清零 Renderer `react-hooks/exhaustive-deps`（App + Inspector），禁止 eslint-disable。

## 实现

1. `use-shell-file-actions.ts`：`openExternal` / `revealInFolder` / `copyFilePath` / 文件夹 shell 动作；`locale`/`t` 留在 hook 内。
2. `use-asset-drag-drop-handlers.ts`：文件夹/集合/回收站 drop 执行；纯决策仍在 `asset-drag-drop.ts`。
3. App 剩余订阅/回调补齐 `locale`/`t` 依赖（restore、缩略图失败文案、AI 通知、剪贴板导入、批量取消重链、磁盘同步、进度、Escape 放弃导入）。
4. Inspector 视频/GIF 元数据 effect 改为依赖完整 `selectedAsset`；文本 hero 摘要改为按 `assetId` 对齐缓存，去掉 effect 内同步 `setState(null)`（消除 `set-state-in-effect`）。

## 度量

| 项 | 前 | 后 |
| --- | --- | --- |
| `App.tsx` 行数 | ~7429 | 7235 |
| App `exhaustive-deps` | 16 | 0 |
| Inspector `exhaustive-deps` | 1 | 0 |

## 测试

```bash
npm run typecheck
npx eslint src/renderer/App.tsx src/renderer/InspectorPanel.tsx \
  src/renderer/use-shell-file-actions.ts \
  src/renderer/use-asset-drag-drop-handlers.ts --max-warnings 0
```

Computer Use：未执行（架构/lint，无新用户可见路径）。

## 人类验收

无新增 HA 项（非用户可见功能增量）。`Serpent-uye` 仍有 restore/metadata/Escape/导入等大块待拆。

## 残留

- `Serpent-uye` 保持 `in_progress`：后续 Wave 继续拆 App。
- `Serpent-vpk`（真隔离 E2E）仍 open；澄清队列 `hrw`/`w3b` 跳过。
