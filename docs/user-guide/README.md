# 使用手册

面向最终用户的 Serpent 使用指南。英文版：[README.en.md](README.en.md)

- [安装](installation.md)——macOS / Windows 安装、浏览器扩展、升级
- [基本使用](basics.md)——资源库、导入、浏览、标签、合集、文件操作和查看器
- [搜索与过滤](search-and-filters.md)——高级搜索语法、过滤维度和 Shift 多选
- [AI 分析](ai.md)——配置 BYOK 云端模型、自动/手动分析、队列和隐私边界
- [插件、脚本与 MCP](extensions.md)——安装、启用、卸载和外部客户端接入
- [故障排查](troubleshooting.md)——常见问题与解决

## 快速开始

1. 安装 Serpent（见[安装](installation.md)）
2. 启动应用，创建本地资源库
3. 把图片、视频、音频、3D 模型或文本拖入窗口，或点击「导入文件」
4. 资产出现在画布中。双击打开查看器，右键查看更多操作；缩略图、元数据和 AI 分析会在后台渐进完成

数据全部保存在本机资源库目录，无云端同步。

## 界面速览

典型工作区由左侧资源库导航、中部资产画布和右侧 Inspector 组成。Windows 使用左上角「主菜单」承载文件、编辑、窗口、资源库和设置；macOS 还提供同内容的系统菜单。导入、搜索、过滤和排序集中在顶部工具栏。

![Serpent 资源库总览](../assets/ui/Serpent-Preview.png)

完整流程见[基本使用](basics.md)。

```mermaid
flowchart LR
    A[创建资源库] --> B[导入文件或文件夹]
    B --> C[浏览瀑布流]
    C --> D{组织资产}
    D --> E[标签与合集]
    D --> F[文件夹与元数据]
    C --> G[搜索与过滤]
    C --> H[打开查看器]
    H --> I[检查或编辑元数据]
    C --> J[回收站与恢复]
    C --> K[AI 分析]
```

## 功能状态说明

本目录是面向用户的当前功能说明；`docs/internal/` 下的实施规格、开发日志和旧 QA 快照保留历史证据，不能当作当前操作步骤。涉及平台差异时，以当前安装包和[项目状态](../internal/project-status.md)为准。
