# 2026-07-18 文案正式化（Serpent-c1p / Serpent-rxx）

## 范围

- **Serpent-c1p / REQ-SHELL-014**：清理「中文 + 括注英文/术语」标签；书面语。
- **Serpent-rxx / REQ-SHELL-012**：创建资源库起始页与对话框文案正式化。

## 实现

全部改动在 `src/renderer/i18n/catalogs/zh-CN.ts`：

| key | 变更摘要 |
| --- | --- |
| `aiConfig.title` / `tags` / `languagePlaceholder` | 去掉 BYOK/Tags/auto 叠注 |
| `inspector.sourceUrl` / `paletteLabel` | 去掉 URL/Palette 叠注 |
| `filter.widthPx` 等 | 去掉 `(px)` / `(秒)` |
| `empty.noLibrary*` / `dialog.createLibrary.help` | 口语 → 书面 |
| `empty.folder*` | 同屏空态一并书面化 |

E2E 中硬编码中文断言已同步（library-lifecycle / recent / packaged / organization / media-preview）。

## 验收

- SHELL-016、SHELL-017（人类验收清单）

## 未执行

- Computer Use / 视觉截图 QA
