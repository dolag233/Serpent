/** True for a browser-created blob URL whose creator origin is this HTTP(S) page. */
export function isSameOriginBlobMediaUrl(
  mediaUrl: string,
  sourcePageUrl: string | undefined,
): boolean {
  if (mediaUrl.length > 8_192 || !sourcePageUrl || !isValidExtensionUploadSourcePageUrl(sourcePageUrl)) {
    return false;
  }
  try {
    const media = new URL(mediaUrl);
    if (media.protocol !== 'blob:' || media.origin === 'null') return false;

    return media.origin === new URL(sourcePageUrl).origin;
  } catch {
    return false;
  }
}

/** Main and Worker contract for metadata attached to bytes already fetched by the extension. */
export function isValidExtensionUploadMediaUrl(
  mediaUrl: string,
  sourcePageUrl: string | undefined,
): boolean {
  if (!mediaUrl || mediaUrl.length > 8_192) return false;
  try {
    const media = new URL(mediaUrl);
    if (media.protocol === 'http:' || media.protocol === 'https:') {
      return !media.username && !media.password;
    }
    return isSameOriginBlobMediaUrl(mediaUrl, sourcePageUrl);
  } catch {
    return false;
  }
}

/** Mirrors the Worker protocol's source-page URL shape for browser uploads. */
export function isValidExtensionUploadSourcePageUrl(sourcePageUrl: string): boolean {
  if (!sourcePageUrl || sourcePageUrl.length > 8_192) return false;
  try {
    const page = new URL(sourcePageUrl);
    return (page.protocol === 'http:' || page.protocol === 'https:')
      && !page.username
      && !page.password;
  } catch {
    return false;
  }
}
