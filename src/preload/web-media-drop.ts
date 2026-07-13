export interface WebMediaDropPayload {
  html: string;
  uriList: string;
}

export interface ExtractedWebMediaDrop {
  mediaUrl: string;
  mediaType?: 'image' | 'video';
}

const MAX_DRAG_FIELD_BYTES = 256 * 1024;
const MAX_URL_LENGTH = 8_192;

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);/g, (_match, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)));
}

function attributeValue(attributes: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeHtmlAttribute(value.trim());
}

function validHttpUrl(value: string): string | undefined {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return undefined;
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.href;
  } catch {
    return undefined;
  }
}

/**
 * Extracts a single remote media intent from browser DataTransfer strings.
 * Local File handles are deliberately handled before this function by the
 * preload bridge. This parser never fetches data and never turns a URL into a
 * filesystem path.
 */
export function extractWebMediaDrop(input: WebMediaDropPayload): ExtractedWebMediaDrop {
  if (input.html.length > MAX_DRAG_FIELD_BYTES || input.uriList.length > MAX_DRAG_FIELD_BYTES) {
    throw new Error('WEB_MEDIA_DROP_TOO_LARGE');
  }

  let sawInvalidCandidate = false;
  const tagPattern = /<(img|video|source)\b([^>]*)>/gi;
  for (const match of input.html.matchAll(tagPattern)) {
    const rawUrl = attributeValue(match[2] ?? '', 'src');
    if (!rawUrl) continue;
    const mediaUrl = validHttpUrl(rawUrl);
    if (!mediaUrl) {
      sawInvalidCandidate = true;
      continue;
    }
    const mediaType = match[1]?.toLowerCase() === 'img' ? 'image' : 'video';
    return {
      mediaUrl,
      mediaType,
    };
  }

  for (const line of input.uriList.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate === '' || candidate.startsWith('#')) continue;
    const mediaUrl = validHttpUrl(candidate);
    if (mediaUrl) return { mediaUrl };
    sawInvalidCandidate = true;
  }

  throw new Error(sawInvalidCandidate ? 'WEB_MEDIA_URL_INVALID' : 'WEB_MEDIA_NOT_FOUND');
}
