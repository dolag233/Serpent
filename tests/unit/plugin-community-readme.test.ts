import { describe, expect, it } from 'vitest';

import {
  communityPluginAuthor,
  parsePluginReadmeMarkdown,
  pluginReadmeCandidates,
  pluginReadmeRawUrl,
  resolveReadmeHref,
} from '../../src/plugins/plugin-community-readme';

const context = {
  repositoryUrl: 'https://github.com/example/serpent-palette-tools',
  releaseTag: 'v1.2.0',
};

describe('plugin community readme', () => {
  it('picks locale-specific README candidates before the generic file', () => {
    expect(pluginReadmeCandidates('zh-CN')).toEqual([
      'README.zh-CN.md',
      'README.zh.md',
      'README.md',
    ]);
    expect(pluginReadmeCandidates('en')).toEqual(['README.en.md', 'README.md']);
  });

  it('builds a raw.githubusercontent.com URL for the pinned release tag', () => {
    expect(pluginReadmeRawUrl(context.repositoryUrl, context.releaseTag, 'README.zh-CN.md')).toBe(
      'https://raw.githubusercontent.com/example/serpent-palette-tools/v1.2.0/README.zh-CN.md',
    );
  });

  it('uses catalog author when present and otherwise the GitHub owner', () => {
    expect(communityPluginAuthor({ author: 'Ada', repo: 'example/serpent-palette-tools' })).toBe('Ada');
    expect(communityPluginAuthor({ repo: 'example/serpent-palette-tools' })).toBe('example');
  });

  it('resolves relative markdown to blob URLs and images to raw URLs', () => {
    expect(resolveReadmeHref('docs/guide.md', context)).toBe(
      'https://github.com/example/serpent-palette-tools/blob/v1.2.0/docs/guide.md',
    );
    expect(resolveReadmeHref('./preview.png', context)).toBe(
      'https://raw.githubusercontent.com/example/serpent-palette-tools/v1.2.0/preview.png',
    );
  });

  it('drops javascript: links, traversal, and raw HTML', () => {
    expect(resolveReadmeHref('javascript:alert(1)', context)).toBeUndefined();
    expect(resolveReadmeHref('../secret.md', context)).toBeUndefined();
    const blocks = parsePluginReadmeMarkdown(
      [
        '# Title <script>alert(1)</script>',
        '',
        'See [docs](javascript:evil) and [safe](https://example.test/a).',
        '',
        '<img src=x onerror=alert(1)> leftover',
      ].join('\n'),
      context,
    );
    expect(blocks).toEqual([
      {
        type: 'heading',
        level: 1,
        children: [{ type: 'text', value: 'Title alert(1)' }],
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'See ' },
          { type: 'text', value: 'docs and ' },
          {
            type: 'link',
            href: 'https://example.test/a',
            children: [{ type: 'text', value: 'safe' }],
          },
          { type: 'text', value: '.' },
        ],
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', value: ' leftover' }],
      },
    ]);
  });
});
