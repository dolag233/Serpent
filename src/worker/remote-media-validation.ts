import path from 'node:path';

export type RemoteMediaValidationFailure =
  | 'MIME_TYPE_MISSING'
  | 'MIME_TYPE_UNSUPPORTED'
  | 'MIME_EXTENSION_MISMATCH'
  | 'MAGIC_BYTES_MISMATCH';

interface RemoteMediaDefinition {
  extensions: readonly string[];
  minimumMagicBytes: number;
  preferredExtension: string;
  matchesMagic(bytes: Buffer): boolean;
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Buffer, offset: number, text: string): boolean {
  return bytes.length >= offset + text.length &&
    bytes.subarray(offset, offset + text.length).toString('ascii') === text;
}

function isIsoBaseMedia(bytes: Buffer): boolean {
  return bytes.length >= 12 && asciiAt(bytes, 4, 'ftyp');
}

const ASF_HEADER = [
  0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11,
  0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c,
] as const;

const MEDIA_BY_CONTENT_TYPE: Readonly<Record<string, RemoteMediaDefinition>> = {
  'image/png': {
    extensions: ['.png'], minimumMagicBytes: 8, preferredExtension: '.png',
    matchesMagic: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  'image/jpeg': {
    extensions: ['.jpg', '.jpeg'], minimumMagicBytes: 3, preferredExtension: '.jpg',
    matchesMagic: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  },
  'image/gif': {
    extensions: ['.gif'], minimumMagicBytes: 6, preferredExtension: '.gif',
    matchesMagic: (bytes) => asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a'),
  },
  'image/tiff': {
    extensions: ['.tif', '.tiff'], minimumMagicBytes: 4, preferredExtension: '.tiff',
    matchesMagic: (bytes) => startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
      startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]),
  },
  'image/webp': {
    extensions: ['.webp'], minimumMagicBytes: 12, preferredExtension: '.webp',
    matchesMagic: (bytes) => asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP'),
  },
  'image/bmp': {
    extensions: ['.bmp'], minimumMagicBytes: 2, preferredExtension: '.bmp',
    matchesMagic: (bytes) => asciiAt(bytes, 0, 'BM'),
  },
  'video/mp4': {
    extensions: ['.mp4', '.m4v'], minimumMagicBytes: 12, preferredExtension: '.mp4',
    matchesMagic: isIsoBaseMedia,
  },
  'video/quicktime': {
    extensions: ['.mov'], minimumMagicBytes: 12, preferredExtension: '.mov',
    matchesMagic: isIsoBaseMedia,
  },
  'video/webm': {
    extensions: ['.webm'], minimumMagicBytes: 4, preferredExtension: '.webm',
    matchesMagic: (bytes) => startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]),
  },
  // These two legacy containers are already MVP inputs. They remain accepted
  // only because their container signatures are deterministic.
  'video/x-msvideo': {
    extensions: ['.avi'], minimumMagicBytes: 12, preferredExtension: '.avi',
    matchesMagic: (bytes) => asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'AVI '),
  },
  'video/x-ms-wmv': {
    extensions: ['.wmv'], minimumMagicBytes: 16, preferredExtension: '.wmv',
    matchesMagic: (bytes) => startsWith(bytes, ASF_HEADER),
  },
};

export function normalizeRemoteContentType(header: string | null): string {
  return header?.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function remoteMediaValidationFailure(
  contentType: string,
): 'MIME_TYPE_MISSING' | 'MIME_TYPE_UNSUPPORTED' | undefined {
  if (!contentType) return 'MIME_TYPE_MISSING';
  if (!MEDIA_BY_CONTENT_TYPE[contentType]) return 'MIME_TYPE_UNSUPPORTED';
  return undefined;
}

export function extensionForRemoteContentType(contentType: string): string | undefined {
  return MEDIA_BY_CONTENT_TYPE[contentType]?.preferredExtension;
}

export function filenameMatchesRemoteContentType(filename: string, contentType: string): boolean {
  const extension = path.posix.extname(filename).toLowerCase();
  return extension === '' || extension === '.' ||
    Boolean(MEDIA_BY_CONTENT_TYPE[contentType]?.extensions.includes(extension));
}

export class RemoteMediaMagicProbe {
  private prefix = Buffer.alloc(0);

  add(chunk: Uint8Array): void {
    if (this.prefix.length >= 32) return;
    const remaining = 32 - this.prefix.length;
    this.prefix = Buffer.concat([
      this.prefix,
      Buffer.from(chunk.buffer, chunk.byteOffset, Math.min(chunk.byteLength, remaining)),
    ]);
  }

  matches(contentType: string): boolean {
    return MEDIA_BY_CONTENT_TYPE[contentType]?.matchesMagic(this.prefix) ?? false;
  }

  canValidate(contentType: string): boolean {
    const definition = MEDIA_BY_CONTENT_TYPE[contentType];
    return Boolean(definition && this.prefix.length >= definition.minimumMagicBytes);
  }
}
