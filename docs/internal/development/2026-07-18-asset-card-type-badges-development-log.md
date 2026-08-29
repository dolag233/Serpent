# 2026-07-18 网格类型与时长角标（Serpent-lrt）

## 范围

CU-D1：网格卡片区分静图 / 视频 / 动图，并显示时长。

## 实现

- `src/renderer/asset-card-badges.ts`：类型标签（GIF / VIDEO）与时长显示条件
- `App.tsx` 卡片预览：左下时长、右下类型；丢失/回收站时隐藏类型角标以免与 banner 重叠
- `styles.css`：`.asset-type-badge`
- 单元测试：`tests/unit/asset-card-badges.test.ts`

## 验收

- CANVAS-012

## 未执行

- Computer Use；真实 GIF 时长依赖元数据是否写入 `durationMs`
