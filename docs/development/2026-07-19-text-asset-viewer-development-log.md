# 2026-07-19 文本资产预览/查看/编辑开发日志

工单：`Serpent-sh7`

## 范围

文本类资产：网格 TEXT 角标、Inspector 摘要、双击带行号查看、托管路径简单编辑保存；链接资产只读。

## 实现

1. `mediaType: 'text'` + `text-media.ts` 扩展名白名单。
2. Worker `readTextAsset` / `saveTextAsset`（UTF-8、硬 cap、原子写盘）；linked 保存返回 `LIBRARY_NOT_WRITABLE`。
3. Protocol / preload / Main 映射 `asset.text.read|save`。
4. `TextViewerControls`：行号 gutter + textarea；Cmd/Ctrl+S 保存。
5. Inspector hero 截断摘要；`getPreviewArtifact` 对 text 直接 ready（无 thumbnail job）。

## 测试

```bash
node scripts/run-vitest-with-electron.mjs tests/unit/text-media.test.ts tests/unit/asset-card-badges.test.ts
npm run typecheck
```

Computer Use：未执行。

## 人类验收

- TEXT-001
