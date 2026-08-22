import { constants, type ReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';

function responseBody(
  stream: ReadStream,
  onStreamError?: (error: Error) => void,
  signal?: AbortSignal | null,
): BodyInit {
  if (onStreamError) {
    stream.on('error', (error: Error) => {
      // Aborts during seek cancel the consumer; do not treat as a protocol fault.
      if (signal?.aborted) return;
      if (error.name === 'AbortError') return;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ERR_STREAM_DESTROYED') {
        return;
      }
      onStreamError(error);
    });
  }

  if (signal) {
    const destroyOnAbort = () => {
      stream.destroy();
    };
    if (signal.aborted) {
      stream.destroy();
    } else {
      signal.addEventListener('abort', destroyOnAbort, { once: true });
      stream.once('close', () => {
        signal.removeEventListener('abort', destroyOnAbort);
      });
    }
  }

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

export interface CreateArtifactResponseOptions {
  rangeHeader?: string | null;
  onStreamError?: (error: Error) => void;
  /** When Chromium cancels a Range fetch (seek), destroy the file stream promptly. */
  signal?: AbortSignal | null;
}

/**
 * Build a seekable protocol response while reading only the requested video byte range.
 *
 * Serpent-140fe2 follow-up: opened asynchronously on the libuv threadpool.
 * The previous synchronous openSync/fstatSync ran on the Main thread and
 * serialized entire thumbnail bursts behind cold metadata reads — visible as
 * multi-second asset.search resolution delays during fast scrolling on large
 * libraries.
 */
export async function createArtifactResponse(
  absolutePath: string,
  mimeType: string,
  rangeHeaderOrOptions?: string | null | CreateArtifactResponseOptions,
  onStreamError?: (error: Error) => void,
  signal?: AbortSignal | null,
): Promise<Response> {
  const options: CreateArtifactResponseOptions =
    rangeHeaderOrOptions && typeof rangeHeaderOrOptions === 'object'
      ? rangeHeaderOrOptions
      : {
          rangeHeader: rangeHeaderOrOptions as string | null | undefined,
          onStreamError,
          signal,
        };
  const rangeHeader = options.rangeHeader;
  const streamError = options.onStreamError;
  const abortSignal = options.signal ?? null;

  const flags = process.platform === 'win32'
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
  const handle = await open(absolutePath, flags);
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      await handle.close();
      throw new Error('Artifact is not a regular file.');
    }
    const size = fileStat.size;
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': mimeType,
    };

    if (!rangeHeader) {
      // FileHandle.createReadStream closes the HANDLE itself on close — never
      // build a raw-fd stream from an open FileHandle, or the handle's GC
      // finalizer later re-closes the descriptor and crashes Main with EBADF.
      return new Response(responseBody(handle.createReadStream(), streamError, abortSignal), {
        status: 200,
        headers: { ...commonHeaders, 'Content-Length': String(size) },
      });
    }

    const range = parseByteRange(rangeHeader, size);
    if (!range) {
      await handle.close();
      return new Response(null, {
        status: 416,
        headers: { ...commonHeaders, 'Content-Range': `bytes */${size}` },
      });
    }

    const length = range.end - range.start + 1;
    return new Response(responseBody(handle.createReadStream({
      start: range.start,
      end: range.end,
    }), streamError, abortSignal), {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Length': String(length),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  } catch (error) {
    // Failure before the stream owns the handle: release it. Once handed off,
    // handle.createReadStream auto-closes it and this path is unreachable.
    await handle.close().catch(() => undefined);
    throw error;
  }
}
