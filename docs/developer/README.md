# 开发者文档

开发者文档分两部分：

## 第一部分：软件开发

面向参与 Serpent 本身开发的开发者：架构、源码构建、测试规范。

- [环境搭建](setup.md)——依赖、首次构建、开发环境
- [构建与打包](build-packaging.md)——package / make / 发布流水线 / 签名
- [架构](architecture.md)——进程模型、目录结构、关键设计
- [测试](testing.md)——测试体系与运行方式

其他软件文档：

- [开发流程](../internal/development-process.md)——切片流程与质量门禁
- [领域模型](../internal/domain-model.md) / [术语表](../glossary.md)
- [架构决策记录](../internal/adr/)——ADR-0000 起
- [实施规格](../internal/implementation/)——切片规格

## 第二部分：扩展开发

面向编写插件、脚本、MCP 适配器的开发者。**不需要了解软件架构**，直接看[扩展作者手册](../manual/README.md)：

- [插件开发指南](../manual/plugins/development.md) + [最佳实践](../manual/plugins/best-practices.md) + [API 参考](../manual/plugins/api-reference.md)
- [插件分发与更新](../manual/plugins/distribution-and-updates.md)
- 完整参考实现：[Serpent-Plugin-ImageUpscaler](https://github.com/dolag233/Serpent-Plugin-ImageUpscaler)
- [脚本开发指南](../manual/scripts/development.md) + [API 参考](../manual/scripts/api-reference.md)
- [MCP 开发指南](../manual/mcp/development.md) + [API 参考](../manual/mcp/api-reference.md)

最终用户使用扩展的方法见[使用手册：插件、脚本与 MCP](../user-guide/extensions.md)。
