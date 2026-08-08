# 2026-08-01 插件 runtime.mode 枚举迁移

工单：`Serpent-s0gf`（跟进 `Serpent-n34b`）· 清单：`PLUGIN-036`

## 变更

- 主标识：`restricted` / `unrestricted`（对用户仍显示受限 / 无限制）。
- 读入兼容：`standard` → `restricted`，`trusted` → `unrestricted`（manifest preprocess + `pluginRuntimeModeSchema`）。
- 设备态 `trustDecisions.runtimeMode` 经同一 schema 规范化；信任决策值仍为 `trusted`/`denied`（与档位无关）。
- 夹具与测试代码改为写出新枚举；契约单测覆盖旧别名映射。

## 自动化证据

```text
npx tsc --noEmit
# exit 0

npx vitest run tests/unit/plugin-*.test.ts
# Test Files  33 passed · Tests  152 passed
```

未执行：真实 Electron、packaged、Windows、Computer Use。
