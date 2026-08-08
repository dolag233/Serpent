# 插件 Guest API 统一开发日志

> 日期：2026-08-01  
> 工单：`Serpent-029r`  
> 状态：Gateway 命令面已同源；运行时适配器仍分 Host

## 目标

Standard QuickJS 与 Trusted Node 的 `serpent.*` **Gateway 命令面**只允许一份定义（表驱动）。差异仅限如何把调用送进 Gateway / storage 等适配器。

## 共享表覆盖（`src/scripting/serpent-guest-api.ts`）

| Namespace | Methods |
| --- | --- |
| `assets` | search/list/metadata/AI/rating/paths/trash/content read·replace/move/rename… |
| `library` | inspect/changeSequence/create |
| `folders` | list/create |
| `tags` | list/create/assign/remove |
| `collections` | list/create/getMemberships/addAssets/removeAssets |
| `smartCollections` | list |
| `linkedFolders` | list（脱敏，无绝对路径） |
| `files` | import |
| `trash` | list/restoreIfOriginalVacant |
| `palettes` | mostFrequent |

Trusted：`createSerpentGuestApi` 一次获得全部命名空间。  
QuickJS：按 namespace 绑定同一 `SERPENT_GUEST_COMMANDS`；仅 **`jobs.media` / `jobs.ai`** 仍为脚本侧本地挂载（避免与插件 `jobs.registerHandler` 冲突）。

## 刻意未并入同一实现的表面

storage / data / events / hooks / plugin jobs / providers / commands / input / console：两端签名对齐，但 QuickJS 需 pull-bridge（guest-realm），Trusted 用原生回调——继续分 Host 适配。

## 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/plugin-trusted-host.test.ts tests/unit/quickjs-sandbox-prototype.test.ts
# Test Files  2 passed · Tests  23 passed
```

未执行 Electron E2E / packaged / Windows / Computer Use。
