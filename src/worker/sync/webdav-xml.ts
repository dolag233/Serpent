/**
 * 最小 WebDAV multistatus XML 解析（Serpent-xffq）。
 *
 * 只为解析 PROPFIND 的 207 响应：response 块 + href + 200 propstat 内的
 * 常用属性（getetag/getcontentlength/getlastmodified/resourcetype/
 * quota-available-bytes/quota-used-bytes）。不引入 XML 依赖，用正则块
 * 解析；属性名取 local name（忽略命名空间前缀）。
 */

export interface WebDAVPropStat {
  etag?: string;
  contentLength?: number;
  lastModified?: string;
  isCollection: boolean;
  quotaAvailableBytes?: number;
  quotaUsedBytes?: number;
}

export interface WebDAVMultistatusEntry {
  /** 原始 href（未解码前的 URL 路径，可能含转义）。 */
  href: string;
  /** HTTP 状态组；404 表示该资源属性不存在。 */
  statusGroup: number;
  props: WebDAVPropStat;
}

/** 解码 XML 文本实体与常见数字实体。 */
function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function childText(block: string, tagLocalName: string): string | undefined {
  const match = block.match(
    new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tagLocalName}[^>]*>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tagLocalName}>`, 'i'),
  );
  if (!match) return undefined;
  return decodeXmlText(match[1] ?? '').trim();
}

export function parseWebDAVMultistatus(xml: string): WebDAVMultistatusEntry[] {
  const entries: WebDAVMultistatusEntry[] = [];
  const responsePattern = /<(?:[A-Za-z_][\w.-]*:)?response[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?response>/gi;
  let match: RegExpExecArray | null;
  while ((match = responsePattern.exec(xml)) !== null) {
    const block = match[1] ?? '';
    const hrefMatch = block.match(/<(?:[A-Za-z_][\w.-]*:)?href[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?href>/i);
    if (!hrefMatch) continue;
    const href = decodeXmlText(hrefMatch[1] ?? '').trim();
    // 每个 response 里可能有多个 propstat；取第一个成功（2xx）组。
    const propstatPattern = /<(?:[A-Za-z_][\w.-]*:)?propstat[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?propstat>/gi;
    let stat: RegExpExecArray | null;
    let chosen: { statusGroup: number; props: WebDAVPropStat } | null = null;
    while ((stat = propstatPattern.exec(block)) !== null) {
      const statBlock = stat[1] ?? '';
      const statusMatch = statBlock.match(/<(?:[A-Za-z_][\w.-]*:)?status[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?status>/i);
      const statusGroup = statusMatch ? Number(statusMatch[1]?.trim().split(/\s+/)[1]) : 0;
      const collectionMatch = statBlock.match(/<(?:[A-Za-z_][\w.-]*:)?resourcetype[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?resourcetype>/i);
      // collection 标签可能带属性（如 <D:collection xmlns:D="DAV:"/>），
      // 只要求标签名 + 可选的 /> 结尾即可判定。
      const isCollection = collectionMatch
        ? /<(?:[A-Za-z_][\w.-]*:)?collection\b[^>]*\/?>/i.test(collectionMatch[1] ?? '')
        : false;
      const contentLength = childText(statBlock, 'getcontentlength');
      const quotaAvailable = childText(statBlock, 'quota-available-bytes');
      const quotaUsed = childText(statBlock, 'quota-used-bytes');
      if (statusGroup >= 200 && statusGroup < 300) {
        chosen = {
          statusGroup,
          props: {
            etag: childText(statBlock, 'getetag'),
            contentLength: contentLength !== undefined ? Number(contentLength) : undefined,
            lastModified: childText(statBlock, 'getlastmodified'),
            isCollection,
            quotaAvailableBytes: quotaAvailable !== undefined ? Number(quotaAvailable) : undefined,
            quotaUsedBytes: quotaUsed !== undefined ? Number(quotaUsed) : undefined,
          },
        };
        break;
      }
      if (!chosen) {
        chosen = {
          statusGroup,
          props: {
            isCollection,
            contentLength: contentLength !== undefined ? Number(contentLength) : undefined,
            lastModified: childText(statBlock, 'getlastmodified'),
            etag: childText(statBlock, 'getetag'),
          },
        };
      }
    }
    entries.push({ href, statusGroup: chosen?.statusGroup ?? 0, props: chosen?.props ?? { isCollection: false } });
  }
  return entries;
}
