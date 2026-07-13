import { closeSync, constants, createReadStream, fstatSync, openSync } from 'node:fs';
import { Readable } from 'node:stream';

function responseBody(
  stream: ReturnType<typeof createReadStream>,
  onStreamError?: (error: Error) => void,
): BodyInit {
  if (onStreamError) stream.on('error', onStreamError);
  // Node and DOM currently publish structurally equivalent ReadableStream types
  // from separate declarations; Electron's Response consumes the Node stream.
  return Readable.toWeb(stream) as unknown as BodyInit;
}

export interface ByteRange {
  start: number;
  end: number;
}

/** Parse a single RFC 7233 byte range. Multi-range responses are not needed by Chromium media playback. */
export function parseByteRange(value: string, size: number): ByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0 || !value.startsWith('bytes=')) return null;
  const specification = value.slice('bytes='.length).trim();
  if (!specification || specification.includes(',')) return null;
  const match = /^(\d*)-(\d*)$/.exec(specification);
  if (!match) return null;

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) return null;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= size
  ) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

/** Build a seekable protocol response while reading only the requested video byte range. */
export function createArtifactResponse(
  absolutePath: string,
  mimeType: string,
  rangeHeader?: string | null,
  onStreamError?: (error: Error) => void,
): Response {
  const flags = process.platform === 'win32'
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
  const descriptor = openSync(absolutePath, flags);
  const fileStat = fstatSync(descriptor);
  if (!fileStat.isFile()) {
    closeSync(descriptor);
    throw new Error('Artifact is not a regular file.');
  }
  const size = fileStat.size;
  const commonHeaders = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Type': mimeType,
  };

  if (!rangeHeader) {
    return new Response(responseBody(createReadStream(absolutePath, {
      fd: descriptor,
      autoClose: true,
    }), onStreamError), {
      status: 200,
      headers: { ...commonHeaders, 'Content-Length': String(size) },
    });
  }

  const range = parseByteRange(rangeHeader, size);
  if (!range) {
    closeSync(descriptor);
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` },
    });
  }

  const length = range.end - range.start + 1;
  return new Response(responseBody(createReadStream(absolutePath, {
    fd: descriptor,
    autoClose: true,
    start: range.start,
    end: range.end,
  }), onStreamError), {
    status: 206,
    headers: {
      ...commonHeaders,
      'Content-Length': String(length),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}
