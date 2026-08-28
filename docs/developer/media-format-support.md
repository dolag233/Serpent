# 新增媒体格式支持指南

本文面向参与 Serpent 软件开发的开发者。把扩展名加入一个列表，只代表某个入口“看见”了它；只有导入、缩略图、查看器、过滤和相关协议都验证过，才能称为支持。

## 1. 从共享注册表开始

先查看并修改 `src/shared/media-formats.ts`，必要时同步修改 `src/shared/audio-media.ts`：

- 图像加入 `IMAGE_EXTENSIONS` 的对应解码器集合；RAW 与普通图像不要混在错误的解码路径中。
- 视频、模型、文档加入对应注册表。
- 同一种 bitstream 的别名扩展名应共用 MIME 和解码策略。例如 JFIF 是 JPEG bitstream，`.jfif` 使用 `image/jpeg`，不是另造一种图像格式。
- 扩展名判断必须大小写不敏感；注册表函数应接收文件名和扩展名两种输入。

修改注册表后，不要在 UI 或 Worker 中再维护一份平行的硬编码扩展名列表。

## 2. 逐项检查消费者

用 `rg` 搜索旧扩展名、MIME、`endsWith`、`includes` 和格式分派点，然后按实际能力检查：

| 路径 | 重点位置 | 要确认的内容 |
| --- | --- | --- |
| 导入识别 | `src/worker/library-service.ts`、导入策略 | 文件能被识别、索引、重扫和删除；不支持或损坏时有明确结果 |
| 格式过滤 | `src/renderer/format-filter-presets.ts` | 从共享注册表生成，不遗漏新扩展名；补过滤单测 |
| 缩略图 | Worker thumbnail/媒体解码模块 | 解码器、尺寸上限、动画/多帧和损坏文件行为明确 |
| 查看器 | `src/shared/preview-policy.ts`、查看器组件 | 区分源文件直出与全分辨率派生图；不能把缩略图冒充原图 |
| MIME/协议 | `src/main/index.ts`、preload 和共享协议 | 主进程 artifact、远程资源、插件上下文使用正确 MIME，并通过运行时校验 |
| 序列帧/色彩 | sequence、image color space 相关模块 | 只有真正适用的图像格式进入序列帧和色彩管理路径 |
| 外部生态 | Eagle/Billfish、插件、远程导入 | 候选扩展名、URL MIME 和保存后的预览行为一致 |

图像格式是否能被 Chromium 原生显示只是优化条件，不是产品支持的充分条件。Chromium 不认识的容器应使用有界缩略图和独立的全分辨率解码路径。

## 3. 实现顺序

1. 判断新增的是编码格式、容器格式还是扩展名别名，记录 MIME、解码器和降级语义。
2. 更新共享注册表及其纯函数测试。
3. 逐个修正导入、Worker 解码、预览策略、格式过滤、主进程协议和插件/远程入口。
4. 若是动画、多帧、RAW、HDR 或 3D，先写清楚查看器语义：播放、首帧、帧控制、色彩空间、材质缺失等分别如何处理。
5. 更新开发者文档和人类验收清单；不要用“后端库理论上能读”代替真实证据。

## 4. 测试矩阵

至少准备以下 fixture，路径使用临时目录，不提交个人绝对路径或真实用户素材：

- 有效文件、扩展名大写/混合大小写、非 ASCII 路径和较长文件名；
- 损坏/截断文件，以及格式声明和内容不一致的文件；
- 透明度、动画、多帧、RAW 或 HDR 等格式特有能力（适用时）；
- 导入后缩略图可解码，查看器原图可解码；图片检查 `complete && naturalWidth > 0`，视频检查元数据和非零尺寸；
- 搜索与格式过滤、重扫、删除/恢复、远程导入和插件入口（适用时）；
- macOS 与 Windows 的 packaged app；缺少平台证据时明确写“未验证”。

最小验证命令：

```bash
npm run typecheck
npx vitest run --config vitest.config.ts tests/unit/<相关测试>.test.ts
npm run test:unit
```

只要改动资源库打开、导入、Worker、schema 或媒体存储路径，还必须运行：

```bash
npm run test:library-availability
```

跨 Renderer / preload / Main / Worker 或自定义媒体协议的改动还要运行对应 Electron E2E。每次测试结束清理本次创建且能确认归属的临时数据库、媒体、截图和导出包。

## 5. 完成标准

开发日志和验收清单按四列记录：需求条目、实现位置（`file:line`）、自动化测试（`test:line`）、人工/平台证据。任意一列缺失，只能写“部分完成”或“未验证”。

相关调研：[媒体格式支持调研](research-media-format-support.md)。
