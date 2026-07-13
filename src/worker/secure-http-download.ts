import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type DnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export interface PinnedHttpResponse {
  body: AsyncIterable<Uint8Array> | null;
  cancel(): void;
  headers: Headers;
  status: number;
}

export interface PinnedHttpRequest {
  address: string;
  family: number;
  headers: Record<string, string>;
  signal: AbortSignal;
  url: URL;
}

export type PinnedHttpTransport = (
  request: PinnedHttpRequest,
) => Promise<PinnedHttpResponse>;

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

/**
 * Opens one HTTP(S) hop while retaining the URL hostname for Host and TLS SNI.
 * The custom lookup never performs DNS: it returns the already validated IP.
 */
export const defaultPinnedHttpTransport: PinnedHttpTransport = ({
  address,
  family,
  headers,
  signal,
  url,
}) => new Promise((resolve, reject) => {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
  const requester = url.protocol === 'https:' ? https : http;
  const tlsHostname = url.hostname.replace(/^\[|\]$/gu, '');
  const request = requester.request(url, {
    agent: false,
    headers,
    lookup,
    signal,
    ...(url.protocol === 'https:' && isIP(tlsHostname) === 0
      ? { servername: tlsHostname }
      : {}),
  }, (response: IncomingMessage) => {
    resolve({
      body: response,
      cancel: () => response.destroy(),
      headers: responseHeaders(response.headers),
      status: response.statusCode ?? 0,
    });
  });
  request.once('error', reject);
  request.end();
});
