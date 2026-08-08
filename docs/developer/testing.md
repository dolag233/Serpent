# 测试

## 分层

| 层 | 目录 | 运行环境 | 命令 |
| --- | --- | --- | --- |
| 单元 | `tests/unit/` | Node ABI | `npm run test:unit` |
| Worker 集成 | `tests/worker/` | Electron ABI | `npm run test:worker` |
| E2E | `tests/e2e/` | Playwright + Electron | `npm run test:e2e` |
| Packaged E2E | `tests/e2e/packaged-startup.test.ts` | 打包产物 | `npm run test:e2e:packaged`（需先 package） |

全量：`npm run test`（单元 + Worker 集成，Electron 内运行，排除性能测试）。

## 常用

```bash
npm run test                 # 全量（单元 + Worker）
npm run test:worker -- tests/worker/<file>   # 跑单个 Worker 测试文件
npm run test:e2e             # Playwright E2E（dev 模式）
npm run release:e2e:packaged # 打包产物启动测试（pipeline e2e 阶段）
npm run verify:mainline      # 发布门禁组合（test + perf + e2e）
```

## 关键约定

- **数据兼容测试**（`tests/worker/schema-*`）：宽容读取（缺列/多列/改列名）、迁移原子性、失败注入、升级/降级链、迁移纪律静态检查——改动 `MIGRATIONS` 或读路径必须保持全绿
- **打包门禁**：`prepackage`/`premake` 校验媒体组件与 ufbx；`verify:package` 校验产物
- **E2E 隔离**：packaged E2E 用临时 `SERPENT_E2E_USER_DATA_PATH`，不碰真实配置；对话框用 mock（注意匹配双语标题）
- **测试环境**：`SERPENT_E2E=1` 开启隔离模式（隔离 userData、E2E 对话框路径等）

## 新增测试指引

- 纯逻辑（无 Electron/DB）放 `tests/unit/`；涉及 Worker/DB 放 `tests/worker/`；完整旅程放 `tests/e2e/`
- Worker 测试用 vitest（Electron 内运行），建库用 `LibraryService.createLibrary` + 临时目录
- 性能敏感/长时测试放 `tests/worker/search-performance.test.ts`（全量 `test` 排除）
