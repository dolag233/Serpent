import path from 'node:path';

import { pluginIdSchema, pluginPackagePathSchema } from '../plugins/plugin-manifest';

const pluginUiProtocol = 'serpent-plugin:';

export type PluginUiAssetRequest = {
  pluginId: string;
  instanceId: string;
  contributionId: string;
  libraryId: string;
  relativePath: string;
};

export function createPluginUiUrl(input: {
  pluginId: string;
  instanceId: string;
  contributionId: string;
  libraryId: string;
  entryPath: string;
}): string {
  const pluginId = pluginIdSchema.parse(input.pluginId);
  const entryPath = pluginPackagePathSchema.parse(input.entryPath);
  const url = new URL(`${pluginUiProtocol}//${pluginId}/${encodeURIComponent(input.instanceId)}/`);
  for (const segment of entryPath.split('/')) {
    url.pathname += `${encodeURIComponent(segment)}/`;
  }
  url.pathname = url.pathname.replace(/\/$/u, '');
  url.searchParams.set('libraryId', input.libraryId);
  url.searchParams.set('contributionId', input.contributionId);
  return url.toString();
}

export function parsePluginUiAssetRequest(input: string): PluginUiAssetRequest | undefined {
  const rawPath = input.split(/[?#]/u, 1)[0] ?? '';
  if (/(?:^|\/)(?:\.{1,2}|%2e|%2e%2e)(?:\/|$)/iu.test(rawPath)) return undefined;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.protocol !== pluginUiProtocol) return undefined;
  if (!pluginIdSchema.safeParse(url.hostname).success) return undefined;

  const segments = url.pathname.replace(/^\/+/u, '').split('/');
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) return undefined;
  let decodedSegments: string[];
  try {
    decodedSegments = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
  const [instanceId, ...pathSegments] = decodedSegments;
  if (instanceId === undefined || pathSegments.length === 0 || instanceId.includes('/')) return undefined;
  const relativePath = pathSegments.join('/');
  if (!pluginPackagePathSchema.safeParse(relativePath).success) return undefined;

  const libraryId = url.searchParams.get('libraryId');
  const contributionId = url.searchParams.get('contributionId');
  if (!libraryId
    || !contributionId
    || libraryId.length > 255
    || contributionId.length > 255
    || !contributionId.startsWith(`${url.hostname}.`)
    || contributionId.includes('/')
    || contributionId.includes('..')) {
    return undefined;
  }
  return {
    pluginId: url.hostname,
    instanceId,
    contributionId,
    libraryId,
    relativePath,
  };
}

export function resolvePluginUiAssetPath(
  packageDirectory: string,
  relativePath: string,
): string | undefined {
  if (!pluginPackagePathSchema.safeParse(relativePath).success) return undefined;
  const absolutePath = path.resolve(packageDirectory, relativePath);
  const relative = path.relative(packageDirectory, absolutePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  return absolutePath;
}

export function pluginUiMimeType(relativePath: string): string {
  switch (path.extname(relativePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}
