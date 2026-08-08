# 2026-07-29 插件 Phase A 契约开发日志

- 对应工单：`Serpent-upsn.1`
- 对应规格：[0024 脚本—插件扩展平台](../implementation/0024-script-plugin-platform.md)
- 范围：只实现无副作用的插件包与 SDK 契约；不读取插件目录、不下载、不安装、更不加载或执行第三方代码。

## 变更

- 新增 `src/plugins/plugin-manifest.ts`：Plugin API/Manifest v1、严格 ID、SemVer、Engine、路径、权限、运行模式、声明式 Contribution 与平台兼容性校验；Schema 同时是 JSON Schema 的唯一来源。
- 新增 `src/plugins/plugin-package.ts`：Package、安装、资源库 lock、设备本地信任与 Resolution 模型；包目录约定；归档/文件/解压限制、路径穿越、符号链接与文件摘要的无副作用验证；确定性 lock 生成和复验。
- 新增 `src/plugins/plugin-contributions.ts`：稳定命名空间 Contribution ID，以及按 Plugin Instance 完整注册/撤销的纯内存注册表。
- 新增 `src/plugins/plugin-sdk.ts`：基于上述公共 Schema 枚举生成的 Plugin SDK 声明和传输安全 API 描述。
- 新增独立 JSON fixture `tests/fixtures/plugin-manifests/palette-tools.serpent-plugin.json`，避免示例、Schema 和测试各自维护一份不同的清单。

## 可追溯性

| 需求条目 | 实现位置 | 自动化测试 | 人工/平台证据 |
| --- | --- | --- | --- |
| Manifest、Plugin API、Engine、平台和路径契约 | `src/plugins/plugin-manifest.ts` | `tests/unit/plugin-contract.test.ts` 的 manifest 组 | 非 UI、非安装行为；无需人类验收 |
| Package/Installation/Trust/Resolution/lock 数据模型 | `src/plugins/plugin-package.ts` | 同测试的 package 组 | 同上 |
| 穿越路径、符号链接、归档/文件/解压大小和摘要篡改 fail-closed | `src/plugins/plugin-package.ts` | 同测试的 package 限制与完整性断言 | 同上 |
| Contribution 命名空间和停用撤销 | `src/plugins/plugin-contributions.ts` | 同测试的 contribution 组 | 同上 |
| SDK 类型、JSON Schema、示例 fixture 同源 | `src/plugins/plugin-sdk.ts`、`tests/fixtures/plugin-manifests/` | 同测试的 SDK 组 | 同上 |

## 本次验证

- `npm run test:unit -- tests/unit/plugin-contract.test.ts`：202 个测试文件通过，1,607 个测试通过，1 个跳过。
- `npm run typecheck`：通过。
- `npm run lint -- src/plugins tests/unit/plugin-contract.test.ts`：通过；仅输出仓库既有巨型 `library-service.ts` 的 Babel 代码生成提示。

## 后续范围

- Phase B 才实现本地/目录/GitHub 安装、原子切换、资源库同步、信任和版本选择 UI；该阶段必须以本模块验证器读取真实文件并在加载前复验 lock。
- 本阶段不应进入人类验收清单：用户尚无可操作的插件安装/管理界面。
