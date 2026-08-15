import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: '使用手册',
      collapsible: false,
      items: [
        { type: 'doc', id: 'user-guide/installation', label: '安装' },
        { type: 'doc', id: 'user-guide/basics', label: '基本使用' },
        { type: 'doc', id: 'user-guide/extensions', label: '插件、脚本与 MCP' },
        { type: 'doc', id: 'user-guide/troubleshooting', label: '故障排查' },
      ],
    },
    {
      type: 'category',
      label: '开发者文档',
      collapsible: false,
      items: [
        { type: 'doc', id: 'developer/setup', label: '环境搭建' },
        { type: 'doc', id: 'developer/architecture', label: '架构' },
        { type: 'doc', id: 'developer/build-packaging', label: '构建与打包' },
        { type: 'doc', id: 'developer/testing', label: '测试' },
      ],
    },
    {
      type: 'category',
      label: '扩展作者手册',
      collapsible: false,
      items: [
        { type: 'doc', id: 'manual/README', label: '插件 / 脚本 / MCP' },
      ],
    },
    'product-brief',
    'glossary',
  ],
};

export default sidebars;
