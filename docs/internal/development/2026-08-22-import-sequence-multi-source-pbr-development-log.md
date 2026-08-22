# 2026-08-22：序列帧设置、多源导入与 PBR 提示收口

## 范围

- `Serpent-cfa2f6`：在「设置 → 资产」增加“导入时自动检测序列帧”，并补充中英文用户文档。
- `Serpent-c48b00`：让系统资源管理器的多文件、多文件夹和混合选择可通过拖拽或复制粘贴进入同一导入管线。
- `Serpent-3a6750`：移除 PBR 贴图查看器中常驻的通道说明 Info，保留只读显示滤镜。

## 实现要点

- 单个文件夹仍使用递归文件夹导入；其他有效选择统一标记为多源导入，Worker 对每个目录源递归枚举，并拒绝符号链接、特殊文件和文件系统根目录。
- 序列帧偏好保存在 Renderer 的版本化 localStorage 项中，默认开启；关闭时 Main 跳过序列帧探测并向导入命令传递 `createImageSequence: false`。
- PBR 通道识别与显示滤镜不变，只删除查看器的常驻说明卡片、对应 CSS 和 UI 断言。

## 验证

```text
node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/desktop-ingestion.test.ts tests/unit/image-sequence-preferences.test.ts tests/worker/image-sequence.test.ts
22 passed

node scripts/run-vitest-with-electron.mjs run --config vitest.config.ts tests/unit/protocol.test.ts tests/unit/pbr-texture-channel.test.ts
106 passed

npm run test:library-availability
9 files / 190 passed / 1 skipped

npm run typecheck
passed

node scripts/run-e2e.mjs tests/e2e/pbr-texture-preview.test.ts
1 passed (5.5s)
```

定向 ESLint 无 error；`App.tsx` 保留一个既有的 Hook 依赖 warning。Windows Explorer 的真实多选拖拽/粘贴、packaged 应用和 PBR 人工观感仍待用户验收。
