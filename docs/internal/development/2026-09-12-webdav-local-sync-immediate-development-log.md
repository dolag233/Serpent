# 本地改动立即同步（2026-09-12）

## 范围

轮询间隔（默认 5 秒）只检查云端。本地改标签等在最后一次改动后再等 5 秒上传（产品 2026-09-12：由 10 秒改为 5 秒）。工单 `Serpent-7ddcaf`。同步状态条不在本单。

## 根因

`localChangeDebounceMs` 原默认 10 秒。同步进行中到达的 `asset.changed` 被 `#running` 直接丢掉，只能等下次远端轮询。

## 实现摘要

- 本地变更默认 5 秒合并窗口，与轮询间隔独立。
- 进行中再收到本地变更记 pending，本轮结束后再跑一次。

## 验证

- `npx vitest run --config vitest.config.ts tests/unit/sync-auto-scheduler.test.ts`：1 file / 11 passed（默认 5 秒防抖后才 `sync.run`；进行中变更会尾随一次）。