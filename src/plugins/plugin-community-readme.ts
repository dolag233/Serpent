import type { PluginLocaleId } from './plugin-localized-copy';
import { toOpenableExternalUrl } from '../shared/external-url';

export const PLUGIN_README_MAX_BYTES = 256 * 1024;

export const PLUGIN_README_FILE_NAMES = [
  'README.zh-CN.md',
  'README.zh.md',
  'README.en.md',
  'README.md',
] as const;

export type PluginReadmeFileName = (typeof PLUGIN_README_FILE_NAMES)[number];

export type PluginReadmeInline =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'strong'; readonly children: readonly PluginReadmeInline[] }
  | { readonly type: 'em'; readonly children: readonly PluginReadmeInline[] }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly PluginReadmeInline[] }
  | { readonly type: 'image'; readonly href: string; readonly alt: string };

export type PluginReadmeBlock =
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly children: readonly PluginReadmeInline[] }
  | { readonly type: 'paragraph'; readonly children: readonly PluginReadmeInline[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly (readonly PluginReadmeInline[])[] }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'blockquote'; readonly children: readonly PluginReadmeInline[] }
  | { readonly type: 'hr' };

export type PluginReadmeResolveContext = {
  readonly repositoryUrl: string;
  readonly releaseTag: string;
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

export function pluginReadmeCandidates(locale: PluginLocaleId): readonly PluginReadmeFileName[] {
  return locale === 'zh-CN'
    ? ['README.zh-CN.md', 'README.zh.md', 'README.md']
    : ['README.en.md', 'README.md'];
}

export function pluginReadmeRawUrl(repositoryUrl: string, releaseTag: string, fileName: PluginReadmeFileName): string {
  const parsed = new URL(repositoryUrl);
  const [owner, name] = parsed.pathname.split('/').filter(Boolean);
  if (owner === undefined || name === undefined) {
    throw new Error('README fetch requires an HTTPS GitHub owner/repository URL.');
  }
  return `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(releaseTag)}/${fileName}`;
}

export function communityPluginAuthor(input: {
  readonly author?: string;
  readonly repo: string;
}): string {
  const named = input.author?.trim();
  if (named !== undefined && named !== '') return named;
  const owner = input.repo.split('/')[0];
  return owner !== undefined && owner !== '' ? owner : input.repo;
}

export function resolveReadmeHref(href: string, context: PluginReadmeResolveContext): string | undefined {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('mailto:')) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
    return toOpenableExternalUrl(trimmed) ?? undefined;
  }
  const parsedRepo = new URL(context.repositoryUrl);
  const [owner, name] = parsedRepo.pathname.split('/').filter(Boolean);
  if (owner === undefined || name === undefined) return undefined;
  const relative = trimmed.replace(/^\.\//u, '').replace(/^\/+/u, '');
  if (relative.startsWith('../') || relative.includes('..')) return undefined;
  const extension = pathExtension(relative);
  const kind = IMAGE_EXTENSIONS.has(extension) ? 'raw' : 'blob';
  const host = kind === 'raw' ? 'https://raw.githubusercontent.com' : 'https://github.com';
  const middle = kind === 'raw' ? `${owner}/${name}/${encodeURIComponent(context.releaseTag)}` : `${owner}/${name}/blob/${encodeURIComponent(context.releaseTag)}`;
  return `${host}/${middle}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

export function parsePluginReadmeMarkdown(
  markdown: string,
  context: PluginReadmeResolveContext,
): readonly PluginReadmeBlock[] {
  const source = markdown.replace(/\r\n/gu, '\n').replace(/\0/gu, '');
  const lines = source.split('\n');
  const blocks: PluginReadmeBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (/^```/u.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/u.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', value: body.join('\n') });
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line.trim())) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: 'heading',
        level,
        children: parseInlines(heading[2], context),
      });
      index += 1;
      continue;
    }
    if (/^>\s?/u.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/u.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^>\s?/u, ''));
        index += 1;
      }
      blocks.push({
        type: 'blockquote',
        children: parseInlines(quoted.join(' '), context),
      });
      continue;
    }
    const unordered = /^[-*+]\s+/u.test(line);
    const ordered = /^\d+[.)]\s+/u.test(line);
    if (unordered || ordered) {
      const items: PluginReadmeInline[][] = [];
      while (index < lines.length) {
        const itemLine = lines[index] ?? '';
        const match = unordered
          ? /^[-*+]\s+(.+)$/u.exec(itemLine)
          : /^\d+[.)]\s+(.+)$/u.exec(itemLine);
        if (match?.[1] === undefined) break;
        items.push([...parseInlines(match[1], context)]);
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (next.trim() === '' || /^```/u.test(next) || /^(#{1,6})\s+/u.test(next) || /^[-*+]\s+/u.test(next) || /^\d+[.)]\s+/u.test(next) || /^>\s?/u.test(next)) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push({
      type: 'paragraph',
      children: parseInlines(paragraph.join(' '), context),
    });
  }
  return blocks;
}

function pathExtension(relative: string): string {
  const base = relative.split('/').at(-1) ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

function parseInlines(input: string, context: PluginReadmeResolveContext): PluginReadmeInline[] {
  const nodes: PluginReadmeInline[] = [];
  let remaining = stripRawHtml(input);
  while (remaining !== '') {
    const image = /^!\[([^\]]*)\]\(([^)]+)\)/u.exec(remaining);
    if (image?.[2] !== undefined) {
      const href = resolveReadmeHref(image[2], context);
      if (href !== undefined) {
        nodes.push({ type: 'image', href, alt: image[1] ?? '' });
      } else if ((image[1] ?? '') !== '') {
        nodes.push({ type: 'text', value: image[1] ?? '' });
      }
      remaining = remaining.slice(image[0].length);
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)/u.exec(remaining);
    if (link?.[1] !== undefined && link[2] !== undefined) {
      const href = resolveReadmeHref(link[2], context);
      const children = parseInlines(link[1], context);
      if (href !== undefined) nodes.push({ type: 'link', href, children });
      else nodes.push(...children);
      remaining = remaining.slice(link[0].length);
      continue;
    }
    const code = /^`([^`]+)`/u.exec(remaining);
    if (code?.[1] !== undefined) {
      nodes.push({ type: 'code', value: code[1] });
      remaining = remaining.slice(code[0].length);
      continue;
    }
    const strong = /^\*\*(.+?)\*\*/u.exec(remaining) ?? /^__(.+?)__/u.exec(remaining);
    if (strong?.[1] !== undefined) {
      nodes.push({ type: 'strong', children: parseInlines(strong[1], context) });
      remaining = remaining.slice(strong[0].length);
      continue;
    }
    const em = /^\*(.+?)\*/u.exec(remaining) ?? /^_(.+?)_/u.exec(remaining);
    if (em?.[1] !== undefined) {
      nodes.push({ type: 'em', children: parseInlines(em[1], context) });
      remaining = remaining.slice(em[0].length);
      continue;
    }
    const nextSpecial = remaining.search(/!?\[|`|\*\*|__|\*|_/u);
    const take = nextSpecial === -1 ? remaining.length : Math.max(nextSpecial, 1);
    const chunk = remaining.slice(0, take);
    const last = nodes.at(-1);
    if (last?.type === 'text') {
      nodes[nodes.length - 1] = { type: 'text', value: `${last.value}${chunk}` };
    } else {
      nodes.push({ type: 'text', value: chunk });
    }
    remaining = remaining.slice(take);
  }
  return nodes;
}

function stripRawHtml(value: string): string {
  return value.replace(/<[^>]*>/gu, '');
}
